-- Portfol.io - publish the risk metrics too (Volatility, Max Drawdown,
-- Sharpe, Sortino, Beta, Alpha, Correlation).
--
-- The Performance page's "Risk & Quant Metrics" read "Insufficient history"
-- for signed-out visitors even though the signed-in view has plenty: the
-- public path can't recompute them (no per-security data), and 0031 only
-- published TWR/XIRR/yearly/the index curve. They are pure ratios/percent
-- statistics of the already-public cash-flow-neutral curve - no euro amount,
-- security or account - so the signed-in client now publishes them in the
-- same snapshot row and the public RPC returns them.
--
-- Idempotent. Run once in the Supabase SQL Editor, then sign in once so the
-- app publishes the new column.

alter table public_performance_snapshot add column if not exists quant_metrics jsonb;

drop function if exists public_portfolio_performance();
create function public_portfolio_performance()
returns table(
  total_return_pct numeric,
  total_return_available boolean,
  investor_return_pct numeric,
  investor_return_available boolean,
  yearly_returns jsonb,
  performance_series jsonb,
  inception_date date,
  quant_metrics jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.total_return_pct, s.total_return_available,
    s.investor_return_pct, s.investor_return_available,
    s.yearly_returns, s.performance_series, s.inception_date,
    s.quant_metrics
  from public_performance_snapshot s
  limit 1;
$$;

revoke all on function public_portfolio_performance() from public;
grant execute on function public_portfolio_performance() to anon;
