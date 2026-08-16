-- Portfolio.io — Performance & Benchmark Engine: benchmark + FX history.
-- See the feature's plan doc (section D) for the full architecture.
--
-- Same "observation table, not a calculated one" discipline as
-- daily_prices (0004): every column here is either raw data received
-- from a provider or bookkeeping about the fetch itself. No performance
-- number is ever stored - portfolio/benchmark returns are computed at
-- read time from valuations/transactions/benchmark_history/fx_rates
-- (js/calculations.js), exactly like today's TWR/XIRR.
--
-- Deliberately provider-agnostic at the table level, even though the
-- Edge Functions this feeds happen to use Alpha Vantage: nothing in
-- calculations.js or the UI ever references "Alpha Vantage" - they only
-- read benchmark_history/fx_rates, so swapping the provider later means
-- rewriting the Edge Function only.

-- Small reference table, not hardcoded into JS - id is a stable slug so
-- application code can say benchmark_id = 'sp500' rather than a UUID.
create table benchmarks (
  id               text primary key,
  name             text not null,
  provider         text not null,
  provider_symbol  text not null,
  currency         text not null default 'USD',
  -- Honesty flag, never silently 'total_return': Alpha Vantage's free
  -- TIME_SERIES_DAILY is splits-adjusted but NOT dividend-adjusted (the
  -- adjusted/total-return-style endpoint sits behind a premium plan).
  -- Every place a benchmark is shown must read this and label
  -- accordingly - see plan doc's Alpha Vantage limitation note.
  data_type        text not null default 'price_return' check (data_type in ('price_return', 'total_return')),
  description      text,
  created_at       timestamptz not null default now()
);

insert into benchmarks (id, name, provider, provider_symbol, currency, data_type, description) values
  ('sp500',     'S&P 500',     'alpha_vantage', 'SPY', 'USD', 'price_return', 'SPDR S&P 500 ETF Trust (SPY) as a proxy for the S&P 500 index - Alpha Vantage''s free tier has no raw index symbol.'),
  ('nasdaq100', 'Nasdaq-100',  'alpha_vantage', 'QQQ', 'USD', 'price_return', 'Invesco QQQ Trust (QQQ) as a proxy for the Nasdaq-100 index - Alpha Vantage''s free tier has no raw index symbol.');

create table benchmark_history (
  id            uuid primary key default gen_random_uuid(),
  benchmark_id  text not null references benchmarks(id) on delete cascade,
  date          date not null,
  close         numeric not null,
  source        text not null default 'alpha_vantage',
  fetched_at    timestamptz not null default now(),
  unique (benchmark_id, date)
);

alter table benchmark_history enable row level security;
create policy "authenticated read" on benchmark_history for select using (auth.role() = 'authenticated');
create policy "anon read" on benchmark_history for select to anon using (true);

-- USD/EUR (and room for other pairs later) so a benchmark's native-
-- currency close can be converted to EUR at comparison time without
-- ever mutating the raw stored close - see plan doc section I (FX).
create table fx_rates (
  id              uuid primary key default gen_random_uuid(),
  base_currency   text not null,
  quote_currency  text not null,
  date            date not null,
  rate            numeric not null,
  source          text not null default 'alpha_vantage',
  fetched_at      timestamptz not null default now(),
  unique (base_currency, quote_currency, date)
);

alter table fx_rates enable row level security;
create policy "authenticated read" on fx_rates for select using (auth.role() = 'authenticated');
create policy "anon read" on fx_rates for select to anon using (true);

-- Kept separate from price_fetch_log (0004) rather than overloading it -
-- that table is scoped to the paused EODHD security-price feature and
-- keyed to security_id; this one covers both benchmarks and FX pairs,
-- keyed generically, so a fetch failure here never gets mixed into that
-- feature's own audit trail (or vice versa).
create table benchmark_fetch_log (
  id             uuid primary key default gen_random_uuid(),
  run_at         timestamptz not null default now(),
  entity_type    text not null check (entity_type in ('benchmark', 'fx')),
  entity_id      text not null, -- benchmarks.id, or 'USD/EUR' for FX
  symbol_used    text,
  provider       text not null default 'alpha_vantage',
  status         text not null check (status in ('ok', 'error', 'missing')),
  error_message  text,
  http_status    int
);

alter table benchmark_fetch_log enable row level security;
create policy "authenticated read" on benchmark_fetch_log for select using (auth.role() = 'authenticated');

-- No RLS write policy for anon/authenticated on any of the four tables
-- above, by design - only the Edge Functions write here, using the
-- service_role key (never shipped to the browser), same discipline as
-- daily_prices/price_fetch_log (0004).
