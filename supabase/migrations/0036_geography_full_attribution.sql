-- Portfol.io - every euro of invested weight ends up in a real country.
--
-- 0035 left whatever had no single country (a "World" or "Europe" fund
-- position, an ETF's un-itemised remainder, an Unknown) in a "not
-- attributable" bucket. This replaces that with an explicit, documented
-- PROXY, tagged so the app can always say how much is estimated:
--
--   reported : the security's own country composition (a BPI report row
--              whose country is a real country, or an index country weight)
--   proxy    : weight that only has a region-level label is spread, pro
--              rata, over the countries the rest of the portfolio is
--              ACTUALLY reported in for that region:
--                'Europe'            -> the European countries reported
--                'Emerging Markets'  -> the EM countries reported
--                'Asia'              -> the Asian countries reported
--                World / Global / Unknown / un-itemised remainder
--                                    -> the country mix of the INDEX ETFs
--                   (a global-equity composition), not of the bond/cash
--                   positions - otherwise a few Spanish T-bills would
--                   "represent" the whole world.
--              (If a pool is empty it falls back to every attributed
--              country.)
-- No outside numbers are invented: the proxy is the portfolio's own
-- reported geography, so it can be inspected, and it never moves weight
-- between securities - each security keeps its own proxied share, which
-- is what lets the app answer "which securities are exposed to Portugal".
--
-- Replaces public_portfolio_geography() (signature gains proxy_pct) and adds
-- portfolio_geography_detail() (per-security rows, signed-in owner only).
-- Idempotent. Run once in the Supabase SQL Editor.

-- Country catalog: the countries geography can resolve to. A label that is
-- NOT in here (Europe, World, Global, Unknown, ...) is a region-level label
-- and gets proxied. `groups` drives the pro-rata pools above.
create table if not exists geo_countries (
  country text primary key,
  iso     int  not null,
  region  text not null,
  groups  text[] not null default '{}'
);
alter table geo_countries enable row level security;
drop policy if exists "anon read" on geo_countries;
drop policy if exists "authenticated read" on geo_countries;
create policy "anon read" on geo_countries for select to anon using (true);
create policy "authenticated read" on geo_countries for select to authenticated using (true);

insert into geo_countries (country, iso, region, groups) values
  ('United States', 840, 'North America',    '{North America}'),
  ('Canada',        124, 'North America',    '{North America}'),
  ('United Kingdom',826, 'Europe',           '{Europe}'),
  ('Germany',       276, 'Europe',           '{Europe}'),
  ('France',        250, 'Europe',           '{Europe}'),
  ('Spain',         724, 'Europe',           '{Europe}'),
  ('Portugal',      620, 'Europe',           '{Europe}'),
  ('Italy',         380, 'Europe',           '{Europe}'),
  ('Netherlands',   528, 'Europe',           '{Europe}'),
  ('Switzerland',   756, 'Europe',           '{Europe}'),
  ('Sweden',        752, 'Europe',           '{Europe}'),
  ('Belgium',        56, 'Europe',           '{Europe}'),
  ('Denmark',       208, 'Europe',           '{Europe}'),
  ('Finland',       246, 'Europe',           '{Europe}'),
  ('Ireland',       372, 'Europe',           '{Europe}'),
  ('Norway',        578, 'Europe',           '{Europe}'),
  ('Japan',         392, 'Asia',             '{Asia}'),
  ('China',         156, 'Emerging Markets', '{Asia,"Emerging Markets"}'),
  ('Taiwan',        158, 'Emerging Markets', '{Asia,"Emerging Markets"}'),
  ('South Korea',   410, 'Emerging Markets', '{Asia,"Emerging Markets"}'),
  ('India',         356, 'Emerging Markets', '{Asia,"Emerging Markets"}'),
  ('Brazil',         76, 'Emerging Markets', '{"Emerging Markets"}'),
  ('Mexico',        484, 'Emerging Markets', '{"Emerging Markets"}'),
  ('Australia',      36, 'World',            '{}')
on conflict (country) do nothing;

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
  spread as (
    select pe.security_id, pl.country,
           pe.amt * pl.p / sum(pl.p) over (partition by pe.security_id, pe.label) as contribution
    from pending pe
    join pool pl on pe.label in ('Europe', 'Emerging Markets', 'Asia')
                and case
                      when exists (select 1 from pool p2 where pe.label = any(p2.groups))
                        then pe.label = any(pl.groups)
                      else true
                    end
    union all
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

-- Public aggregate (no security identity): (country, region, weight, how much
-- of it is a proxy), as % of the invested (non-cash) portfolio.
drop function if exists public_portfolio_geography();
create function public_portfolio_geography()
returns table(country text, region text, weight_pct numeric, proxy_pct numeric)
language sql
security definer
set search_path = public
stable
as $$
  select c.country, c.region,
         round((sum(c.contribution) * 100)::numeric, 2) as weight_pct,
         round((sum(case when c.method = 'proxy' then c.contribution else 0 end) * 100)::numeric, 2) as proxy_pct
  from geography_contributions() c
  group by c.country, c.region
  having sum(c.contribution) > 0
  order by 3 desc;
$$;
revoke all on function public_portfolio_geography() from public;
grant execute on function public_portfolio_geography() to anon, authenticated;

-- Per-security detail ("which securities are exposed to Portugal"): the
-- owner only. Returns nothing unless the caller is a signed-in portfolio owner.
create or replace function portfolio_geography_detail()
returns table(security_id uuid, country text, region text, weight_pct numeric, method text)
language sql
security definer
set search_path = public
stable
as $$
  select c.security_id, c.country, c.region,
         round((c.contribution * 100)::numeric, 3) as weight_pct, c.method
  from geography_contributions() c
  where auth.uid() is not null
    and exists (select 1 from portfolios p where p.user_id = auth.uid());
$$;
revoke all on function portfolio_geography_detail() from public, anon;
grant execute on function portfolio_geography_detail() to authenticated;
