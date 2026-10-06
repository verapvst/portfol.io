-- Portfol.io - public asset-class allocation now shows Cash that sits
-- INSIDE a fund (e.g. BPI Dinâmico's "Liquidez"), not only standalone
-- Cash-type holdings - so signed-out visitors see the same Cash slice the
-- signed-in Overview does (analytics.js SECURITY_ASSET_CLASS_SPLIT).
--
-- 1. security_details.alloc_cash_pct: liquidity held inside the fund.
-- 2. BPI Dinâmico's composition set from its own June 2026 BPI Ficha
--    Mensal (the same real figures already cited in analytics.js):
--    Ações 37.77 / Obrigações 36.04 / Outros Investimentos 20.53 /
--    Liquidez 5.67. Only touches an EXISTING row - if BPI Dinâmico has no
--    security_details row yet, this does nothing (an honest gap, same as
--    0006).
-- 3. public_portfolio_allocation() re-created with Cash = Cash-type
--    holdings + each fund's own cash share. Same return shape, same
--    privacy boundary (category-level % only, no security/account rows).
--
-- Run once in the Supabase SQL Editor.

alter table security_details add column if not exists alloc_cash_pct numeric;

update security_details
set alloc_stocks_pct = 37.77, alloc_bonds_pct = 36.04, alloc_other_pct = 20.53, alloc_cash_pct = 5.67
where security_id = (select id from securities where name = 'BPI Dinâmico');

create or replace function public_portfolio_allocation()
returns table(dimension text, category text, weight_pct numeric)
language sql
security definer
set search_path = public
stable
as $$
  with latest_valuations as (
    select distinct on (v.security_id) v.security_id, v.value_eur
    from valuations v
    order by v.security_id, v.date desc
  ),
  total as (
    select coalesce(sum(value_eur), 0) as total_value from latest_valuations
  ),
  weighted as (
    select
      s.type as security_type,
      case when t.total_value > 0 then lv.value_eur / t.total_value * 100 else 0 end as weight_pct,
      sd.alloc_stocks_pct, sd.alloc_bonds_pct, sd.alloc_other_pct, sd.alloc_cash_pct,
      sd.exposure_us_pct, sd.exposure_eu_pct, sd.exposure_em_pct,
      (sd.security_id is not null) as has_composition
    from latest_valuations lv
    cross join total t
    join securities s on s.id = lv.security_id
    left join security_details sd on sd.security_id = lv.security_id
  ),
  asset_class as (
    select
      sum(case
            when security_type = 'Cash' then weight_pct
            else weight_pct * coalesce(alloc_cash_pct, 0) / 100
          end) as cash,
      sum(case when security_type <> 'Cash' then weight_pct * coalesce(alloc_stocks_pct, 0) / 100 else 0 end) as equities,
      sum(case when security_type <> 'Cash' then weight_pct * coalesce(alloc_bonds_pct, 0) / 100 else 0 end) as bonds,
      sum(case
            when security_type = 'Cash' then 0
            when has_composition then weight_pct * coalesce(alloc_other_pct, 0) / 100
            else weight_pct
          end) as other
    from weighted
  ),
  geography as (
    select
      sum(case when security_type <> 'Cash' then weight_pct * coalesce(exposure_us_pct, 0) / 100 else 0 end) as us,
      sum(case when security_type <> 'Cash' then weight_pct * coalesce(exposure_eu_pct, 0) / 100 else 0 end) as eu,
      sum(case when security_type <> 'Cash' then weight_pct * coalesce(exposure_em_pct, 0) / 100 else 0 end) as em,
      sum(case
            when security_type = 'Cash' then weight_pct
            when has_composition then weight_pct * (1 - (coalesce(exposure_us_pct, 0) + coalesce(exposure_eu_pct, 0) + coalesce(exposure_em_pct, 0)) / 100)
            else weight_pct
          end) as other
    from weighted
  )
  select 'asset_class', 'Equities', round(equities::numeric, 2) from asset_class
  union all
  select 'asset_class', 'Bonds', round(bonds::numeric, 2) from asset_class
  union all
  select 'asset_class', 'Cash', round(cash::numeric, 2) from asset_class
  union all
  select 'asset_class', 'Other', round(other::numeric, 2) from asset_class
  union all
  select 'geography', 'United States', round(us::numeric, 2) from geography
  union all
  select 'geography', 'Europe', round(eu::numeric, 2) from geography
  union all
  select 'geography', 'Emerging Markets', round(em::numeric, 2) from geography
  union all
  select 'geography', 'Other', round(other::numeric, 2) from geography;
$$;

comment on function public_portfolio_allocation() is
  'Public (anon-callable) aggregate-only allocation: 8 rows of (dimension, category, weight_pct). Weighting happens entirely inside this function - no security_id, security name, account, or per-security weight is ever part of the return shape. See this migration''s own header comment for the full reasoning.';

revoke all on function public_portfolio_allocation() from public;
grant execute on function public_portfolio_allocation() to anon;
