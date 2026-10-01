-- Portfolio.io — public Overview should show the REAL return, not a
-- worse one.
--
-- Context: the signed-out path (getPortfolioDataPublic(), js/analytics.js)
-- has always computed its own Time-Weighted Return from
-- public_portfolio_value_history() + public_cash_flow_dates() - the only
-- two RPCs anon has ever had. Those expose dated cash-flow TYPES but
-- never AMOUNTS (a deliberate privacy boundary - real contribution sizes
-- would reveal position sizes), so the anon path has always fallen back
-- to the OLDER chainLinkedPortfolioReturn() engine, whose cash-flow-DATE-
-- only boundaries are the exact bug this session spent hours fixing on
-- the signed-in side (calculations.js's own header comment on that
-- function documents the flaw). Result: signed-in and signed-out have
-- shown two different, disagreeing numbers the whole time - and today,
-- with real (recently messy, now-corrected) data, that gap is large
-- enough to show a wrong, negative return to a recruiter reading Vera's
-- CV link. Vera's own words: "when I'm signed out, I want the return to
-- say what it says when signed in."
--
-- The fix is NOT to give anon access to real cash-flow amounts (that
-- would break the privacy boundary this whole Layer 1/2/3 model exists
-- for), and NOT to reimplement the chain-linked TWR + Modified Dietz +
-- XIRR engine a second time in SQL (this app's own standing rule: one
-- calculation engine, never a parallel one - see analytics.js's header
-- comment on why repository.js still exists for the fields that
-- genuinely haven't migrated yet, and js/calculations.js's own header on
-- being the single engine every scope reads through).
--
-- Instead: the SIGNED-IN client already computes the correct TWR/XIRR/
-- yearly breakdown/normalized daily index every time Vera loads the app
-- (js/analytics.js:getPortfolioDataLive()) - that computation already
-- happens, on real data, using the real engine. This migration adds
-- somewhere for the signed-in client to PUBLISH just the already-computed
-- RESULT (percentages and a base-100 index curve - dimensionless numbers,
-- never a euro figure, never a security name, never an account name) so
-- the signed-out path can read the real answer instead of recomputing a
-- worse one from a narrower data source. Same "compute once, many
-- readers" idea 0015's public_portfolio_allocation() already established,
-- just for performance instead of allocation.
--
-- performance_series is scopedPerformance()'s own dailySeries
-- (calculations.js) - a base-100 normalized index, identical in kind to
-- what buildComparisonSeries()/indexValueSeries() already produce for
-- Showcase mode elsewhere in this app. Safe by construction: it's a
-- ratio to the portfolio's own starting point, not an absolute value, so
-- it reveals shape (how did performance evolve) without revealing scale
-- (how much money). yearly_returns is the same %-only shape
-- scopedAnnualReturns() already returns.

create table public_performance_snapshot (
  portfolio_id            uuid primary key references portfolios(id) on delete cascade,
  total_return_pct        numeric,
  total_return_available  boolean not null default false,
  investor_return_pct     numeric,
  investor_return_available boolean not null default false,
  yearly_returns          jsonb,
  performance_series      jsonb,
  inception_date          date,
  updated_at              timestamptz not null default now()
);

comment on table public_performance_snapshot is
  'One row per portfolio, upserted by the signed-in client every load (js/analytics.js:getPortfolioDataLive()) with the already-computed, real TWR/XIRR/yearly-breakdown/normalized-index results - percentages and a base-100 index curve only, never a euro amount, security name, or account name. Read back through public_portfolio_performance() (anon-safe) so the signed-out Overview shows the same real return the signed-in one does, instead of a separately (and more crudely) computed one.';

alter table public_performance_snapshot enable row level security;

-- Only the portfolio's own owner can write their snapshot; no direct
-- anon or authenticated-other-user access to the table itself - reads
-- happen only through the SECURITY DEFINER wrapper below, same
-- discipline as every other public_* function in this schema.
create policy "owner can upsert own snapshot" on public_performance_snapshot
  for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

-- =========================================================================
-- Public (anon-callable) read of the snapshot - single-portfolio app (see
-- public_portfolio_value_history()'s own precedent for the same
-- no-portfolio-id-filter shape), so this always returns the one row that
-- exists once Vera has loaded the app signed in at least once. Returns
-- zero rows before that first load - the client already has an honest
-- "insufficient/not available yet" path for exactly this case (same
-- *Available flag convention every performance figure in this app uses).
-- =========================================================================
create or replace function public_portfolio_performance()
returns table(
  total_return_pct numeric,
  total_return_available boolean,
  investor_return_pct numeric,
  investor_return_available boolean,
  yearly_returns jsonb,
  performance_series jsonb,
  inception_date date
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.total_return_pct, s.total_return_available,
    s.investor_return_pct, s.investor_return_available,
    s.yearly_returns, s.performance_series, s.inception_date
  from public_performance_snapshot s
  limit 1;
$$;

comment on function public_portfolio_performance() is
  'Public (anon-callable) read of the latest signed-in-computed performance snapshot - real Time-Weighted Return, Investor Return (XIRR), calendar-year breakdown, and a base-100 normalized performance index. No euro amount, security identity, or account identity in the return shape.';

revoke all on function public_portfolio_performance() from public;
grant execute on function public_portfolio_performance() to anon;

-- =========================================================================
-- Verification query - confirm the new function's signature carries no
-- identity/amount column, and that anon really can execute it.
-- =========================================================================
select
  p.proname as function_name,
  pg_get_function_result(p.oid) as return_columns,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
where p.proname = 'public_portfolio_performance';
