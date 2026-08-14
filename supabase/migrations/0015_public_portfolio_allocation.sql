-- Portfolio.io — replaces 0013's per-security/per-account public
-- functions with aggregate-only ones.
--
-- Context: 0013 gave anon real security_name/weight (public_portfolio_
-- snapshot()) and real account name (public_accounts()) - a genuine,
-- deliberate decision at the time ("Vera now wants signed-out visitors
-- to see her REAL portfolio structure... with only monetary values held
-- back"). Vera has since reversed that decision: signed-out visitors
-- may see her portfolio's high-level structure (asset-class %,
-- geographic %, the value curve/TWR) but must never be able to
-- determine WHICH securities she holds, their individual weights, or
-- which broker/account holds what - the distinction is "public research
-- catalogue" vs "public aggregate insight" vs "private personal
-- holdings" (three layers), and per-security/per-account identity
-- belongs only to the third.
--
-- 1. Revoke anon on the two functions that leak identity. Both stay
--    defined (still used nowhere, kept for history/reference) - nothing
--    else in this schema depends on their grants.
-- 2. Add public_portfolio_value_history(): the same scaled-ratio trick
--    0013 used, but summed to ONE portfolio-level series before it ever
--    leaves the database - no security_id, no security_name, no
--    account_id. Feeds the exact same chainLinkedPortfolioReturn()/
--    annualReturns() client-side, just given a single-entry
--    securityHistories map instead of many (see js/analytics.js) -
--    those functions only ever need *a* history to sum over, and summing
--    one already-total series is identical to summing many partial ones.
-- 3. Add public_portfolio_allocation(): asset-class and geography %,
--    computed server-side by weighting each currently-held security's
--    OWN real fund composition (security_details.alloc_*_pct/
--    exposure_*_pct, from 0005 - real product research data, already
--    public since 0014) by that security's real portfolio weight
--    (from valuations, private). The output is 8 rows of
--    (dimension, category, weight_pct) - never a security_id, security
--    name, or account - so the weighting computation happens entirely
--    inside this SECURITY DEFINER function and only the final aggregate
--    crosses the boundary.
--
-- Known limitation, stated honestly rather than hidden: this computes
-- FROM security_details, so it will not exactly match the equivalent
-- signed-in Overview figures today, which still come from repository.js's
-- hand-maintained static numbers (see analytics.js's own header comment -
-- that migration is still Phase 4/5, not done). This function is
-- genuinely DB-derived from real data; it simply isn't the same
-- computation as the not-yet-migrated signed-in one. Once Phase 4/5
-- lands, both should read from the same source and agree.

revoke execute on function public_portfolio_snapshot() from anon;
revoke execute on function public_accounts() from anon;

-- =========================================================================
-- 1. Portfolio-level scaled value history - no security or account
--    identity, just (date, scaled_value) summed across every holding.
-- =========================================================================
create or replace function public_portfolio_value_history()
returns table(date date, scaled_value numeric)
language sql
security definer
set search_path = public
stable
as $$
  with base as (
    select coalesce(sum(v.value_eur), 1) as total
    from valuations v
    where v.date = (select min(date) from valuations)
  )
  select v.date, round(sum(v.value_eur) / nullif(b.total, 0), 8) as scaled_value
  from valuations v
  cross join base b
  group by v.date, b.total
  order by v.date;
$$;

comment on function public_portfolio_value_history() is
  'Public (anon-callable) portfolio-level value history, scaled - never €, never per-security. Replaces public_portfolio_snapshot() for the public path: same scaling trick, but summed to one series before leaving the database so no security identity or per-security weight is ever returned.';

revoke all on function public_portfolio_value_history() from public;
grant execute on function public_portfolio_value_history() to anon;

-- =========================================================================
-- 2. Aggregated asset-class + geographic allocation - Layer 2 "Public
--    Portfolio Insights": category-level %s only, computed from each
--    held security's own public research data weighted by its real
--    (private) portfolio weight. No per-security or per-account row is
--    ever selected into the return shape.
-- =========================================================================
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
      sd.alloc_stocks_pct, sd.alloc_bonds_pct, sd.alloc_other_pct,
      sd.exposure_us_pct, sd.exposure_eu_pct, sd.exposure_em_pct,
      (sd.security_id is not null) as has_composition
    from latest_valuations lv
    cross join total t
    join securities s on s.id = lv.security_id
    left join security_details sd on sd.security_id = lv.security_id
  ),
  asset_class as (
    select
      sum(case when security_type = 'Cash' then weight_pct else 0 end) as cash,
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

-- =========================================================================
-- Verification query - confirm by introspection that neither new
-- function's signature contains a security/account identity column, and
-- that anon execute really is gone from the two revoked functions.
-- =========================================================================
select
  p.proname as function_name,
  pg_get_function_result(p.oid) as return_columns,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
where p.proname in (
  'public_portfolio_snapshot', 'public_accounts',
  'public_portfolio_value_history', 'public_portfolio_allocation', 'public_cash_flow_dates'
);
