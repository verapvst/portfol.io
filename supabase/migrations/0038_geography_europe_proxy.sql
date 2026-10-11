-- Portfol.io - better proxy for "Europe"-labelled weight.
--
-- 0036 spread Europe-labelled positions (euro bond funds, European funds)
-- over whatever European countries the BPI reports happened to itemise,
-- which made Spain ~10% of the portfolio (Spanish T-bills + deposits are
-- the biggest itemised European line). Europe is now spread by the MSCI
-- Europe country mix instead (MSCI Europe Index factsheet, 2026-08-31:
-- UK 22.38, France 14.93, Switzerland 14.29, Germany 13.99, Netherlands
-- 8.79, all other European countries 25.61 together). That "other"
-- slice is spread over the remaining European countries the portfolio is
-- actually reported in, pro rata - the factsheet doesn't split it.
-- Everything else (Emerging Markets, Asia, World/Global/Unknown) is
-- unchanged. Still tagged 'proxy' so the app shows it as estimated.
--
-- Idempotent. Run once in the Supabase SQL Editor.

create table if not exists geography_proxy_weights (
  label      text not null,
  country    text,            -- null = "all other countries in this label"
  weight_pct numeric not null,
  source     text,
  unique (label, country)
);
alter table geography_proxy_weights enable row level security;
drop policy if exists "anon read" on geography_proxy_weights;
drop policy if exists "authenticated read" on geography_proxy_weights;
create policy "anon read" on geography_proxy_weights for select to anon using (true);
create policy "authenticated read" on geography_proxy_weights for select to authenticated using (true);

delete from geography_proxy_weights where label = 'Europe';
insert into geography_proxy_weights (label, country, weight_pct, source) values
  ('Europe', 'United Kingdom', 22.38, 'MSCI Europe Index factsheet, 2026-08-31'),
  ('Europe', 'France',         14.93, 'MSCI Europe Index factsheet, 2026-08-31'),
  ('Europe', 'Switzerland',    14.29, 'MSCI Europe Index factsheet, 2026-08-31'),
  ('Europe', 'Germany',        13.99, 'MSCI Europe Index factsheet, 2026-08-31'),
  ('Europe', 'Netherlands',     8.79, 'MSCI Europe Index factsheet, 2026-08-31'),
  ('Europe', null,             25.61, 'MSCI Europe Index factsheet, 2026-08-31: all other countries');

-- Internal: per-security rows. Not callable by anon/authenticated directly.
create or replace function geography_contributions()
returns table(security_id uuid, country text, region text, contribution numeric, method text)
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
    select distinct on (h.security_id) h.security_id, h.report_date
    from detailed_portfolio_holdings h
    order by h.security_id, h.report_date desc
  ),
  bpi as (
    select h.security_id,
           coalesce(h.exposure_country, 'Unknown') as label,
           sum(h.market_value) as mv,
           sum(sum(h.market_value)) over (partition by h.security_id) as tot
    from detailed_portfolio_holdings h
    join bpi_latest b on b.security_id = h.security_id and b.report_date = h.report_date
    group by h.security_id, h.exposure_country
  ),
  etf_latest as (
    select distinct on (e.security_id) e.security_id, e.as_of
    from security_country_exposure e
    order by e.security_id, e.as_of desc
  ),
  etf as (
    select e.security_id, e.country as label, e.weight_pct / 100.0 as share
    from security_country_exposure e
    join etf_latest l on l.security_id = e.security_id and l.as_of = e.as_of
  ),
  shares as (
    select b.security_id, b.label, b.mv / nullif(b.tot, 0) as share, 'bpi'::text as src from bpi b
    union all
    select e.security_id, e.label, e.share, 'index'::text from etf e
    union all
    select w.security_id, 'Unknown', 1.0, 'none'::text
    from weights w
    where w.security_id not in (select security_id from bpi)
      and w.security_id not in (select security_id from etf)
  ),
  raw as (
    select s.security_id, s.label, s.src, w.w * s.share as amt, (g.country is not null) as is_real
    from weights w
    join shares s on s.security_id = w.security_id
    left join geo_countries g on g.country = s.label
    where w.w * s.share > 0
  ),
  direct as (
    select r.security_id, r.label as country, r.src, sum(r.amt) as contribution
    from raw r where r.is_real
    group by r.security_id, r.label, r.src
  ),
  pool as (
    select d.country, sum(d.contribution) as p, g.groups
    from direct d join geo_countries g on g.country = d.country
    group by d.country, g.groups
  ),
  pool_index as (
    select d.country, sum(d.contribution) as p, g.groups
    from direct d join geo_countries g on g.country = d.country
    where d.src = 'index'
    group by d.country, g.groups
  ),
  global_pool as (
    select * from pool_index
    union all
    select * from pool where not exists (select 1 from pool_index)
  ),
  pending as (
    select r.security_id, r.label, sum(r.amt) as amt
    from raw r where not r.is_real
    group by r.security_id, r.label
  ),
  europe_reported as (
    -- reported European countries NOT itemised in the proxy table: they share
    -- the proxy's own "other European countries" slice, pro rata
    select pl.country, pl.p
    from pool pl
    where 'Europe' = any(pl.groups)
      and pl.country not in (select country from geography_proxy_weights where label = 'Europe' and country is not null)
  ),
  spread as (
    -- Europe: the MSCI Europe country mix (itemised countries) + its
    -- un-itemised remainder spread over the other reported European countries
    select pe.security_id, wp.country, pe.amt * wp.weight_pct / 100.0 as contribution
    from pending pe
    join geography_proxy_weights wp on wp.label = 'Europe' and wp.country is not null
    where pe.label = 'Europe'
    union all
    select pe.security_id, er.country,
           pe.amt * (select weight_pct from geography_proxy_weights where label = 'Europe' and country is null) / 100.0
             * er.p / sum(er.p) over (partition by pe.security_id)
    from pending pe
    join europe_reported er on true
    where pe.label = 'Europe'
    union all
    -- Emerging Markets / Asia: reported countries of that group, pro rata
    select pe.security_id, pl.country,
           pe.amt * pl.p / sum(pl.p) over (partition by pe.security_id, pe.label) as contribution
    from pending pe
    join pool pl on pe.label in ('Emerging Markets', 'Asia')
                and case
                      when exists (select 1 from pool p2 where pe.label = any(p2.groups))
                        then pe.label = any(pl.groups)
                      else true
                    end
    union all
    -- World / Global / Unknown / un-itemised remainder: the index-ETF mix
    select pe.security_id, gp.country,
           pe.amt * gp.p / sum(gp.p) over (partition by pe.security_id, pe.label) as contribution
    from pending pe
    join global_pool gp on pe.label not in ('Europe', 'Emerging Markets', 'Asia')
  )
  select d.security_id, d.country, g.region, sum(d.contribution), 'reported'::text
  from direct d join geo_countries g on g.country = d.country
  group by d.security_id, d.country, g.region
  union all
  select s.security_id, s.country, g.region, s.contribution, 'proxy'::text
  from spread s join geo_countries g on g.country = s.country;
$$;


revoke all on function geography_contributions() from public, anon, authenticated;
