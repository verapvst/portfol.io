-- Portfolio.io — daily_prices: automated market data for publicly-traded
-- securities. Deliberately separate from `valuations` (see Feature
-- Backlog, Market Data section, and docs/production-architecture.md's
-- Data/Intelligence split): this table only ever holds an external
-- market observation ("what did this trade at on this date"), never a
-- fact about what YOU hold or what your position is worth. Nothing in
-- this migration writes to valuations/transactions/holdings, and nothing
-- ever will from this table directly - only future read-side analytics
-- (Performance/Risk/Simulator, not built yet) will join across the two.
--
-- Verify pg_cron/pg_net BEFORE assuming this works - run this first in
-- the SQL Editor:
--   select extname, extversion from pg_extension where extname in ('pg_cron','pg_net');
-- The two `create extension if not exists` lines below make the migration
-- self-sufficient either way (a no-op if already enabled, real if not) -
-- but check the query above first so you know which case you're in.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Explicit, per-security, human-confirmed provider symbol - deliberately
-- NOT auto-derived from ticker+a guessed exchange suffix. Refinement #2:
-- every symbol gets tested and cross-checked by ISIN before the collector
-- ever runs for that security. Stays null for anything not yet verified
-- (or not exchange-traded at all, e.g. BPI funds) - the collector skips
-- null rows rather than guessing.
--
-- Real story of what "verify, don't assume" caught here: Alpha Vantage's
-- free GLOBAL_QUOTE returned empty for 3 of these 4 ETFs, and the one
-- that "worked" (plain ticker SPYM) turned out to be a same-ticker US S&P
-- 500 fund, not the SPDR Emerging Markets UCITS ETF actually held.
-- Twelve Data's free tier explicitly paywalls all 3 non-SPYM symbols, and
-- its own "SPYM" match was the same wrong US instrument again. EODHD is
-- the one that actually covers these - confirmed below by matching each
-- result's ISIN against securities.isin, not just the name.
alter table securities add column data_provider_symbol text;

update securities set data_provider_symbol = 'UETW.XETRA' where isin = 'IE00BD4TXV59'; -- UBS Core MSCI World
update securities set data_provider_symbol = 'AVWS.XETRA' where isin = 'IE0003R87OG3'; -- Avantis Global Small Cap Value
update securities set data_provider_symbol = 'XDEQ.XETRA' where isin = 'IE00BL25JL35'; -- Xtrackers MSCI World Quality
update securities set data_provider_symbol = 'SPYM.XETRA' where isin = 'IE00B469F816'; -- SPDR MSCI Emerging Markets (NOT the US SPYM - same ticker, different fund, verified by ISIN)

-- Observation table, not a calculated one: every column is either raw
-- data received from the provider, or bookkeeping about the fetch itself
-- (source/fetched_at). No derived field lives here - change_pct is
-- deliberately NOT a column (compute it from consecutive `close` values
-- on read, per your refinement #6 - nothing here should need a backfill
-- if the derivation logic ever changes).
create table daily_prices (
  id              uuid primary key default gen_random_uuid(),
  security_id     uuid not null references securities(id),
  date            date not null,
  open            numeric,
  high            numeric,
  low             numeric,
  close           numeric not null,
  adjusted_close  numeric,
  volume          bigint,
  source          text not null default 'eodhd',
  fetched_at      timestamptz not null default now(),
  unique (security_id, date)
);

alter table daily_prices enable row level security;

-- Read: same owner-scoping pattern as everything else, via the security's
-- reachability rather than a direct user_id (daily_prices has none - it's
-- market data, not portfolio-scoped data. Any authenticated owner can
-- read all of it; nobody but the Edge Function, via service_role, ever
-- writes to it).
create policy "authenticated read" on daily_prices for select
  using (auth.role() = 'authenticated');

-- One row per fetch attempt per security, success or failure - this is
-- what makes the collector auditable (refinement #9), not just "does the
-- table have today's row or not".
create table price_fetch_log (
  id             uuid primary key default gen_random_uuid(),
  run_at         timestamptz not null default now(),
  security_id    uuid references securities(id),
  symbol_used    text,
  provider       text not null default 'eodhd',
  status         text not null check (status in ('ok', 'error', 'missing')),
  error_message  text,
  http_status    int
);

alter table price_fetch_log enable row level security;

create policy "authenticated read" on price_fetch_log for select
  using (auth.role() = 'authenticated');

-- No RLS write policy for anon/authenticated on either table, by design -
-- only the Edge Function writes here, using the service_role key (never
-- shipped to the browser), exactly per refinement #10.
