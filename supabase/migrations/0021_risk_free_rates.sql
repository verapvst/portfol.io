-- Portfolio.io — risk-free rate history, for Phase 3's Sharpe/Alpha
-- work (Performance & Benchmark Engine plan, §12 - "no risk-free rate
-- anywhere in the data model" was flagged as a blocker before that
-- phase could start). Same "observation table, not a calculated one"
-- discipline as benchmark_history/fx_rates: raw rate observations only,
-- Sharpe/Alpha themselves are computed at read time in calculations.js,
-- never stored here.
--
-- Provider-agnostic at the table level, same as benchmark_history - the
-- Edge Functions this feeds happen to use Alpha Vantage's
-- TREASURY_YIELD endpoint (US Treasury yield, a standard risk-free
-- proxy), but nothing in calculations.js or the UI will ever reference
-- "Alpha Vantage" - they only read risk_free_rates.
--
-- USD-denominated by nature (a US Treasury yield) - this is a
-- deliberate, consistent choice: the two benchmarks already in this app
-- (S&P 500/Nasdaq-100, 0018) are raw USD index levels too, so a USD
-- risk-free rate lines up correctly for Beta/Alpha computed against
-- those specific benchmarks. A Euro-area rate would be the right choice
-- only if/when a Euro-denominated benchmark is added - not assumed here.
--
-- maturity is kept as an explicit column (not assumed) even though only
-- '3month' is fetched initially (the standard Sharpe-ratio proxy for
-- this kind of horizon) - adding '10year' later is a new provider_symbol
-- in the Edge Function, not a schema change.

create table risk_free_rates (
  id          uuid primary key default gen_random_uuid(),
  maturity    text not null,
  date        date not null,
  rate_pct    numeric not null,
  source      text not null default 'alpha_vantage',
  fetched_at  timestamptz not null default now(),
  unique (maturity, date)
);

alter table risk_free_rates enable row level security;
create policy "authenticated read" on risk_free_rates for select using (auth.role() = 'authenticated');
create policy "anon read" on risk_free_rates for select to anon using (true);

-- No write policy for anon/authenticated, by design - only the Edge
-- Functions write here, using the service_role key, same discipline as
-- every other market-data table in this app.

-- benchmark_fetch_log's entity_type check (0016) only knew 'benchmark'/
-- 'fx' - widening it properly for this new collector rather than
-- overloading 'fx' for something that isn't an FX rate.
alter table benchmark_fetch_log drop constraint benchmark_fetch_log_entity_type_check;
alter table benchmark_fetch_log add constraint benchmark_fetch_log_entity_type_check
  check (entity_type in ('benchmark', 'fx', 'risk_free'));
