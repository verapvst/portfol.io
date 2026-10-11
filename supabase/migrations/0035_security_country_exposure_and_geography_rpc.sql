-- Portfol.io - geographic exposure from real, current data (not a frozen
-- hard-coded snapshot).
--
-- Before: the Geographic Exposure card on every page (signed in AND out)
-- read a hand-typed list in js/repository.js dated 2026-08-09, so it never
-- moved when holdings, weights or the monthly BPI reports did.
--
-- Now: ONE function, public_portfolio_geography(), blends each invested
-- security's own country composition by its CURRENT portfolio weight
-- (cash excluded - cash has no geography):
--   * BPI funds   -> their latest detailed_portfolio_holdings snapshot
--                    (share of market value per exposure_country/region)
--   * ETFs        -> security_country_exposure (below): the index's
--                    published country weights, with the un-itemised
--                    remainder kept as its own honest row, never spread
--   * anything else with no composition -> 'Unknown'
-- Only category-level percentages leave the database - no security name,
-- account, share count or euro amount - so it is safe for anon, same
-- privacy boundary as public_portfolio_allocation().
--
-- Sources for the seed rows: justETF.com fund profiles fetched 2026-10-06
-- (MSCI index country weights as of 2026-08-31; top countries only, the
-- rest is the 'Other (not itemised)' row). AVWS (Avantis) has no country
-- table there, so only its US share (security_details.exposure_us_pct,
-- from its factsheet) is itemised and the rest is un-itemised.
--
-- Idempotent. Run once in the Supabase SQL Editor.

create table if not exists security_country_exposure (
  id          uuid primary key default gen_random_uuid(),
  security_id uuid not null references securities(id) on delete cascade,
  as_of       date not null,
  country     text not null,
  region      text not null,
  weight_pct  numeric not null check (weight_pct >= 0),
  source      text,
  unique (security_id, as_of, country)
);

alter table security_country_exposure enable row level security;
drop policy if exists "anon read" on security_country_exposure;
drop policy if exists "authenticated read" on security_country_exposure;
create policy "anon read" on security_country_exposure for select to anon using (true);
create policy "authenticated read" on security_country_exposure for select to authenticated using (true);

insert into security_country_exposure (security_id, as_of, country, region, weight_pct, source)
select s.id, v.as_of::date, v.country, v.region, v.weight_pct, v.source
from (values
  ('IE00BD4TXV59','2026-08-31','United States','North America',70.55,'justETF.com, MSCI World country weights, fetched 2026-10-06'),
  ('IE00BD4TXV59','2026-08-31','Japan','Asia',5.70,'justETF.com, MSCI World country weights, fetched 2026-10-06'),
  ('IE00BD4TXV59','2026-08-31','United Kingdom','Europe',3.68,'justETF.com, MSCI World country weights, fetched 2026-10-06'),
  ('IE00BD4TXV59','2026-08-31','Canada','North America',3.45,'justETF.com, MSCI World country weights, fetched 2026-10-06'),
  ('IE00BD4TXV59','2026-08-31','Other (not itemised)','World',16.62,'justETF.com, MSCI World country weights, fetched 2026-10-06'),

  ('IE00BL25JL35','2026-08-31','United States','North America',69.74,'justETF.com, MSCI World Quality country weights, fetched 2026-10-06'),
  ('IE00BL25JL35','2026-08-31','United Kingdom','Europe',4.88,'justETF.com, MSCI World Quality country weights, fetched 2026-10-06'),
  ('IE00BL25JL35','2026-08-31','Switzerland','Europe',4.23,'justETF.com, MSCI World Quality country weights, fetched 2026-10-06'),
  ('IE00BL25JL35','2026-08-31','Netherlands','Europe',3.30,'justETF.com, MSCI World Quality country weights, fetched 2026-10-06'),
  ('IE00BL25JL35','2026-08-31','Other (not itemised)','World',17.85,'justETF.com, MSCI World Quality country weights, fetched 2026-10-06'),

  ('IE00B469F816','2026-08-31','Taiwan','Emerging Markets',27.57,'justETF.com, MSCI Emerging Markets country weights, fetched 2026-10-06'),
  ('IE00B469F816','2026-08-31','South Korea','Emerging Markets',20.72,'justETF.com, MSCI Emerging Markets country weights, fetched 2026-10-06'),
  ('IE00B469F816','2026-08-31','China','Emerging Markets',18.51,'justETF.com, MSCI Emerging Markets country weights, fetched 2026-10-06'),
  ('IE00B469F816','2026-08-31','India','Emerging Markets',11.39,'justETF.com, MSCI Emerging Markets country weights, fetched 2026-10-06'),
  ('IE00B469F816','2026-08-31','Other (not itemised)','Emerging Markets',21.81,'justETF.com, MSCI Emerging Markets country weights, fetched 2026-10-06'),

  ('IE0003R87OG3','2026-08-09','United States','North America',70.7,'security_details.exposure_us_pct (Avantis factsheet); no country table on justETF'),
  ('IE0003R87OG3','2026-08-09','Other (not itemised)','World',29.3,'remainder of the Avantis factsheet US share')
) as v(isin, as_of, country, region, weight_pct, source)
join securities s on s.isin = v.isin
where not exists (
  select 1 from security_country_exposure e
  where e.security_id = s.id and e.as_of = v.as_of::date and e.country = v.country
);

create or replace function public_portfolio_geography()
returns table(country text, region text, weight_pct numeric)
language sql
security definer
set search_path = public
stable
as $$
  with latest_val as (
    select distinct on (v.security_id) v.security_id, v.value_eur
    from valuations v
    order by v.security_id, v.date desc, v.created_at desc
  ),
  invested as (
    select lv.security_id, lv.value_eur
    from latest_val lv join securities s on s.id = lv.security_id
    where s.type <> 'Cash' and lv.value_eur > 0
  ),
  total as (select coalesce(sum(value_eur), 0) as t from invested),
  weights as (
    select i.security_id, i.value_eur / nullif(t.t, 0) as w
    from invested i cross join total t
  ),
  bpi_latest as (
    select distinct on (security_id) security_id, report_date
    from detailed_portfolio_holdings
    order by security_id, report_date desc
  ),
  bpi as (
    select h.security_id,
           coalesce(h.exposure_country, 'Unknown') as country,
           coalesce(h.exposure_region, 'Unknown') as region,
           sum(h.market_value) as mv,
           sum(sum(h.market_value)) over (partition by h.security_id) as tot
    from detailed_portfolio_holdings h
    join bpi_latest b on b.security_id = h.security_id and b.report_date = h.report_date
    group by h.security_id, h.exposure_country, h.exposure_region
  ),
  etf_latest as (
    select distinct on (security_id) security_id, as_of
    from security_country_exposure
    order by security_id, as_of desc
  ),
  etf as (
    select e.security_id, e.country, e.region, e.weight_pct / 100.0 as share
    from security_country_exposure e
    join etf_latest l on l.security_id = e.security_id and l.as_of = e.as_of
  ),
  shares as (
    select security_id, country, region, mv / nullif(tot, 0) as share from bpi
    union all
    select security_id, country, region, share from etf
    union all
    select w.security_id, 'Unknown', 'Unknown', 1.0
    from weights w
    where w.security_id not in (select security_id from bpi)
      and w.security_id not in (select security_id from etf)
  )
  select s.country, s.region, round((sum(w.w * s.share) * 100)::numeric, 2) as weight_pct
  from weights w join shares s on s.security_id = w.security_id
  group by s.country, s.region
  having sum(w.w * s.share) > 0
  order by 3 desc;
$$;

comment on function public_portfolio_geography() is
  'Aggregate-only geographic exposure of the invested (non-cash) portfolio: (country, region, weight_pct). Blends each security''s own country composition by its current weight. No security, account or euro amount in the return shape.';

revoke all on function public_portfolio_geography() from public;
grant execute on function public_portfolio_geography() to anon, authenticated;
