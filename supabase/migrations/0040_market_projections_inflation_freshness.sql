-- Portfol.io - what the Simulator needs besides prices:
--   1. market_projections: sourced, dated forecasts about a market (robotics
--      first). Each row names its source, URL, publication date and whether
--      the figure was read from the primary publication or only from
--      secondary coverage - a projection is an opinion, never a fact.
--   2. inflation_rates: US CPI index observations (Alpha Vantage CPI,
--      monthly), so real (inflation-adjusted) returns can be shown. Year-
--      on-year inflation is computed at read time, never stored.
--   3. market_data_freshness: ONE view answering "how old is each input?"
--      (Treasury yields by maturity, benchmark levels, ETF prices,
--      inflation, fund facts) - the Simulator shows it so no result is
--      ever based on stale data without saying so.
--
-- Projection rows below were gathered 2026-10-12 from public web sources;
-- where only secondary coverage was available that is stated in `confidence`.
-- Idempotent. Run once in the Supabase SQL Editor.

create table if not exists market_projections (
  id             uuid primary key default gen_random_uuid(),
  topic          text not null,           -- e.g. 'Industrial robots', 'Humanoid robots'
  metric         text not null,           -- what is being projected
  value_text     text not null,           -- the figure as published (units included)
  horizon        text,                    -- year or period the figure refers to
  scope_note     text,                    -- what it does and doesn't cover
  source_name    text not null,
  source_url     text,
  published_date date,
  confidence     text not null check (confidence in ('primary', 'secondary')),
  retrieved_at   date not null default current_date,
  unique (topic, metric, source_name, published_date)
);
alter table market_projections enable row level security;
drop policy if exists "anon read" on market_projections;
drop policy if exists "authenticated read" on market_projections;
create policy "anon read" on market_projections for select to anon using (true);
create policy "authenticated read" on market_projections for select to authenticated using (true);

insert into market_projections (topic, metric, value_text, horizon, scope_note, source_name, source_url, published_date, confidence, retrieved_at) values
  ('Industrial robots', 'Operational stock of industrial robots, end of year', 'about 5.0 million units (+9% year on year; record)', '2025', 'Industrial robots only - not service, humanoid or other robot types.', 'International Federation of Robotics (IFR), World Robotics 2026', 'https://ifr.org/ifr-press-releases/news/five-million-robots-now-operate-in-factories-globally', '2026-09-24', 'primary', '2026-10-12'),
  ('Industrial robots', 'Annual installations of industrial robots', 'about 603,000 units (+11% year on year); China about 59% of installations', '2025', 'Exact unit counts were read from secondary summaries of the IFR report; the press release rounds to "over 600,000".', 'International Federation of Robotics (IFR), World Robotics 2026', 'https://ifr.org/ifr-press-releases/news/five-million-robots-now-operate-in-factories-globally', '2026-09-24', 'primary', '2026-10-12'),
  ('Industrial robots', 'Forecast annual installations', '655,000 units in 2026 (+9%), rising to 806,000 units in 2029', '2026-2029', 'A forecast, not an observed result. Industrial robots only.', 'International Federation of Robotics (IFR), World Robotics 2026', 'https://ifr.org/ifr-press-releases/news/five-million-robots-now-operate-in-factories-globally', '2026-09-24', 'primary', '2026-10-12'),
  ('Humanoid robots', 'Market size (total addressable market)', 'USD 38 billion', '2035', 'Goldman Sachs Research original forecast (Feb 2024), about 6x its previous estimate.', 'Goldman Sachs Research', 'https://www.goldmansachs.com/insights/articles/the-global-market-for-robots-could-reach-38-billion-by-2035', '2024-02-01', 'primary', '2026-10-12'),
  ('Humanoid robots', 'Market size and unit shipments (revised)', 'about 6.5 million units and roughly USD 138 billion (shipments up from about 1.4 million in the earlier forecast)', '2035', 'September 2026 update to the Goldman Sachs forecast, reported by financial media; NOT confirmed against Goldman Sachs'' own publication. Another outlet cites USD 154 billion as a blue-sky scenario.', 'Goldman Sachs Research, as reported by 24/7 Wall St. and others', 'https://247wallst.com/investing/2026/09/14/goldman-sachs-just-supercharged-its-humanoid-robot-prediction-5x-to-6-5-million-by-2035/', '2026-09-14', 'secondary', '2026-10-12'),
  ('Humanoid robots', 'Global humanoid revenue', 'about USD 4.7 trillion (often rounded to "USD 5 trillion"); roughly 1 billion units', '2050', 'Morgan Stanley expects adoption to stay relatively slow until the mid-2030s before accelerating. Includes the wider ecosystem.', 'Morgan Stanley Research, as reported by CNBC', 'https://www.cnbc.com/2025/04/29/how-to-play-a-5-trillion-market-for-humanoid-robots-by-2050.html', '2025-04-29', 'secondary', '2026-10-12'),
  ('Humanoid robots', 'Market size, conservative scenario', 'about USD 15 billion (commercial hardware)', '2035', 'Interact Analysis estimate; inflection point only after 2032. Hardware only, so not comparable with ecosystem-wide figures.', 'Interact Analysis, as summarised by Physical AI Journal', 'https://www.physicalaijournal.org/post/humanoid-market-forecast-2030-2035', null, 'secondary', '2026-10-12'),
  ('Humanoid robots', 'Disclosed company revenue today', 'under USD 1 billion', '2025', 'Shows how far current revenue is below the projections above.', 'Summary reported by Physical AI Journal', 'https://www.physicalaijournal.org/post/humanoid-market-forecast-2030-2035', null, 'secondary', '2026-10-12')
on conflict (topic, metric, source_name, published_date) do nothing;

create table if not exists inflation_rates (
  id         uuid primary key default gen_random_uuid(),
  series     text not null default 'cpi_us',
  date       date not null,
  value      numeric not null,            -- CPI index level
  source     text not null default 'alpha_vantage',
  fetched_at timestamptz not null default now(),
  unique (series, date)
);
alter table inflation_rates enable row level security;
drop policy if exists "anon read" on inflation_rates;
drop policy if exists "authenticated read" on inflation_rates;
create policy "anon read" on inflation_rates for select to anon using (true);
create policy "authenticated read" on inflation_rates for select to authenticated using (true);

create or replace view market_data_freshness as
  select ('US Treasury yield ' || maturity)::text as dataset, max(date) as latest_date, max(fetched_at) as fetched_at
  from risk_free_rates group by maturity
  union all
  select ('Benchmark ' || b.name)::text, max(h.date), max(h.fetched_at)
  from benchmark_history h join benchmarks b on b.id = h.benchmark_id group by b.name
  union all
  select 'ETF prices'::text, max(date), max(fetched_at) from daily_prices
  union all
  select 'US inflation (CPI)'::text, max(date), max(fetched_at) from inflation_rates
  union all
  select 'Fund facts (TER, size, holdings)'::text, max(last_verified), max(updated_at) from security_details;

grant select on market_data_freshness to anon, authenticated;

-- The fetch log's entity_type check (0016/0021) needs to know the new
-- 'inflation' collector (supabase/functions/fetch-inflation).
alter table benchmark_fetch_log drop constraint if exists benchmark_fetch_log_entity_type_check;
alter table benchmark_fetch_log add constraint benchmark_fetch_log_entity_type_check
  check (entity_type in ('benchmark', 'fx', 'risk_free', 'inflation'));
