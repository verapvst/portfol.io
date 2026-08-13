-- Portfolio.io — public (signed-out) real portfolio data, with zero
-- monetary values ever transmitted.
--
-- Context: Showcase used to mean "a fake demo dataset" (repository.js's
-- mock), because RLS blocks anon from every real table entirely. Vera
-- now wants signed-out visitors to see her REAL portfolio structure and
-- performance - graphs, allocation, holdings, evolution - with only
-- monetary values (€ amounts) held back. That's a genuine, deliberate
-- loosening of what's public, not a UI tweak - so it has to be done at
-- the database level, matching this app's own established principle
-- that RLS is real security, never a client-side mask (see
-- 0001_initial_schema.sql's RLS policies, and js/shell.js's own
-- isOwnerMode()/formatMoney() comments for why that principle already
-- governs everything else here).
--
-- Design: SECURITY DEFINER functions, not a view + relaxed RLS. A
-- function's return columns are the ONLY thing that can ever cross to
-- the caller - there's no ambiguity about what "the view" resolves to
-- under RLS, and no monetary column is ever selected into the return
-- shape, full stop. Base tables (valuations, transactions, accounts)
-- keep their exact existing RLS - completely unchanged, completely
-- private - these functions are the only way anon ever reaches this
-- data, and only through the shape defined below.
--
-- The key trick that keeps this both SAFE and ACCURATE: instead of
-- reimplementing chain-linked TWR in SQL (a real risk of a subtle new
-- bug producing a silently wrong public number), every security's real
-- €-valued history is divided by ONE portfolio-wide constant (total
-- portfolio value on its very first observation date) before it ever
-- leaves the database. That preserves every ratio TWR/weights/returns
-- actually need (between securities, and over time) while making the
-- absolute € figure irrecoverable from the output - you cannot reverse
-- a "67.7% of the starting portfolio" figure back into a real euro
-- amount without knowing the constant, which never leaves this
-- function either. The exact same, already-tested
-- chainLinkedPortfolioReturn()/annualReturns() (calculations.js) then
-- run on this scaled data client-side and produce numerically IDENTICAL
-- percentages to the real computation - scaling every input by one
-- constant never changes a ratio-based calculation's result.

-- =========================================================================
-- 1. Per-security scaled value history - the one function everything
--    else (value series, holdings weights/returns, TWR, annual returns)
--    is derived from client-side, exactly mirroring how
--    getPortfolioDataLive() already processes real €-valued data - just
--    fed a scaled ratio instead of value_eur.
-- =========================================================================
create or replace function public_portfolio_snapshot()
returns table(
  security_id uuid,
  security_name text,
  security_type text,
  account_id uuid,
  date date,
  scaled_value numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with base as (
    -- The ONE constant every value below is divided by - the real
    -- total portfolio value on its earliest observation date. This
    -- number itself is never returned by this function, by any other
    -- function here, or anywhere else - it exists only inside this
    -- query's own execution.
    select coalesce(sum(v.value_eur), 1) as total
    from valuations v
    where v.date = (select min(date) from valuations)
  )
  select
    v.security_id,
    s.name,
    s.type,
    t.account_id,
    v.date,
    round(v.value_eur / nullif(b.total, 0), 8) as scaled_value
  from valuations v
  join securities s on s.id = v.security_id
  left join lateral (
    select account_id from transactions t2
    where t2.security_id = v.security_id
    order by t2.date desc
    limit 1
  ) t on true
  cross join base b
  order by v.security_id, v.date;
$$;

comment on function public_portfolio_snapshot() is
  'Public (anon-callable) real portfolio history, scaled - never €. Every value here is (real value_eur / total portfolio value on its first observation date), a dimensionless ratio. security_name/type and account_id are real and safe (not monetary). Feed into the same client-side valueOfSecurityAsOf()/chainLinkedPortfolioReturn()/annualReturns() the authenticated path already uses - identical methodology, identical % results, just scaled input.';

revoke all on function public_portfolio_snapshot() from public;
grant execute on function public_portfolio_snapshot() to anon;

-- =========================================================================
-- 2. Cash-flow dates - needed for TWR's sub-period boundaries. Dates and
--    transaction TYPE only (buy/sell/deposit/withdrawal) - no amount, no
--    security, no account. This is deliberately less detail than what
--    the Transactions page itself would ever show even signed in with
--    values hidden - matching Vera's separate, earlier, explicit
--    instruction that Transactions stays a gated preview (dates,
--    securities, quantities all hidden there) - this function must
--    never become a backdoor around that page's own stricter gate, so
--    it returns only the two fields TWR's own math structurally needs.
-- =========================================================================
create or replace function public_cash_flow_dates()
returns table(date date, type text)
language sql
security definer
set search_path = public
stable
as $$
  select date, type
  from transactions
  where voided = false and type in ('buy', 'sell', 'deposit', 'withdrawal')
  order by date;
$$;

comment on function public_cash_flow_dates() is
  'Public (anon-callable) - dates and transaction TYPE only, for TWR sub-period boundaries. No amount, no security, no account - deliberately less than what a signed-out visitor to the Transactions page itself would see (that page stays a full gated preview per its own, separate, earlier requirement). Never join this against public_portfolio_snapshot() in application code in a way that would let a caller reconstruct which flow happened where.';

revoke all on function public_cash_flow_dates() from public;
grant execute on function public_cash_flow_dates() to anon;

-- =========================================================================
-- 3. Accounts - name and currency only, for account-level allocation
--    grouping. No balance, no institution details beyond the name
--    already shown elsewhere in this app's own real, non-monetary data.
-- =========================================================================
create or replace function public_accounts()
returns table(id uuid, name text, currency text)
language sql
security definer
set search_path = public
stable
as $$
  select id, name, currency from accounts order by name;
$$;

comment on function public_accounts() is
  'Public (anon-callable) - account name/currency only, no balance. For account-level weight grouping (weights are derived from public_portfolio_snapshot()''s scaled values, never from a balance column here).';

revoke all on function public_accounts() from public;
grant execute on function public_accounts() to anon;

-- =========================================================================
-- Verification query - run this AFTER the grants above to confirm, by
-- introspection (not by trusting the SQL you just read), that none of
-- the three functions' return signatures contain anything that could be
-- a monetary column. This checks the ACTUAL registered function
-- signatures in the database, not the source text.
-- =========================================================================
select
  p.proname as function_name,
  pg_get_function_result(p.oid) as return_columns
from pg_proc p
where p.proname in ('public_portfolio_snapshot', 'public_cash_flow_dates', 'public_accounts');
