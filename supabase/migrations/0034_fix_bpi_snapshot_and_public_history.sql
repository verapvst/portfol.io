-- Portfol.io - fixes found auditing the data after the 2026-10 monthly update.
--
-- 1. detailed_portfolio_holdings.weight_pct was NULL on every row of every
--    snapshot: the Carteira Detalhada lists positions for a reference
--    amount (~EUR 10,000) with no weight column, and the importer stored
--    the empty cell. A position's weight is its share of its own report's
--    total market value - backfilled here (and the importer now does the
--    same), so Product Detail / drawers stop showing "—".
-- 2. BPI Universal's ETFs that were classified Unknown (47% of the fund)
--    get a country/region from each instrument's OWN mandate/index (same
--    rules added to js/importer/geoClassifier.js). Alternative funds in
--    BPI Dinamico stay Unknown on purpose - no honest basis to guess.
-- 3. public_portfolio_value_history() summed only the valuations dated
--    EXACTLY on each date, so a date where just some securities were
--    updated (e.g. 2026-08-30) looked like a crash/spike on the public
--    Capital chart. It now carries each security's latest value forward
--    to every date - the same rule the signed-in app uses
--    (calculations.js valueOfSecurityAsOf). Same scaling, same shape.
--
-- Idempotent. Run once in the Supabase SQL Editor.

-- 1. weights ---------------------------------------------------------------
update detailed_portfolio_holdings d
set weight_pct = round((d.market_value / nullif(t.total, 0) * 100)::numeric, 4)
from (
  select security_id, report_date, sum(market_value) as total
  from detailed_portfolio_holdings
  group by security_id, report_date
) t
where t.security_id = d.security_id
  and t.report_date = d.report_date
  and d.weight_pct is null
  and d.market_value is not null;

-- 2. geography proxies -----------------------------------------------------
update detailed_portfolio_holdings d
set exposure_country = r.country, exposure_region = r.region
from (values
  ('XTRACKERS RUSSELL 2000%',            'United States', 'North America'),
  ('ISHARES MSCI MEXICO%',               'Mexico',        'Emerging Markets'),
  ('ISHARES USD TREASURY BOND%',         'United States', 'North America'),
  ('ISHARES USD TIPS%',                  'United States', 'North America'),
  ('UBS LUX MONEY MARKET USD%',          'United States', 'North America'),
  ('ISHARES DIVERSIFIED COMMODITY%',     'Global',        'Global'),
  ('XTRACKERS II EUR HIGH YIELD%',       'Europe',        'Europe'),
  ('ISHARES DIGITAL SECURITY%',          'World',         'World'),
  ('INVESCO USD AT1%',                   'World',         'World')
) as r(pattern, country, region)
where d.exposure_country = 'Unknown'
  and d.holding_name ilike r.pattern;

-- 3. public value history, carried forward ---------------------------------
create or replace function public_portfolio_value_history()
returns table(date date, scaled_value numeric)
language sql
security definer
set search_path = public
stable
as $$
  with dates as (
    select distinct v.date from valuations v
  ),
  base as (
    select coalesce(sum(v.value_eur), 1) as total
    from valuations v
    where v.date = (select min(date) from valuations)
  ),
  carried as (
    select d.date, sum(lv.value_eur) as total_value
    from dates d
    cross join lateral (
      select distinct on (v.security_id) v.value_eur
      from valuations v
      where v.date <= d.date
      order by v.security_id, v.date desc, v.created_at desc
    ) lv
    group by d.date
  )
  select c.date, round(c.total_value / nullif(b.total, 0), 8) as scaled_value
  from carried c cross join base b
  order by c.date;
$$;

revoke all on function public_portfolio_value_history() from public;
grant execute on function public_portfolio_value_history() to anon;
