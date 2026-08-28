-- One-time data tagging, NOT a numbered migration (a plain UPDATE on
-- existing rows, no schema change) - populates securities.sub_portfolio,
-- a column that has existed since 0001_initial_schema.sql but has sat
-- dormant (analytics.js's own comment: "a security with no tag simply
-- belongs to no strategy"). Tagging it turns on the Performance page's
-- already-built but so-far-empty "Strategies" scope selector - no new
-- schema, no new code, just data.
--
-- WHY: the app owner wants three scoped performance views - "BPI
-- Dinâmico alone", "all Trading212 ETFs together", and "Total
-- Portfolio" (already the default/root scope, needs no tag). Account
-- scoping alone would give "BPI alone" for free today (it's the only
-- holding in ACC-001), but that only holds by coincidence of today's
-- account structure - an explicit strategy tag is the real, stable
-- answer to "what strategy is this security part of", independent of
-- which broker happens to custody it.
--
-- How to run: paste into the Supabase SQL Editor and run once. Only
-- touches securities.sub_portfolio for the 5 securities named below -
-- nothing else. Safe to re-run (idempotent - same value each time).

update public.securities set sub_portfolio = 'BPI Dinâmico'
  where name = 'BPI Dinâmico';

update public.securities set sub_portfolio = 'Global Factor Tilt'
  where name in (
    'UBS Core MSCI World (Acc)',
    'Avantis Global Small Cap Value (Acc)',
    'Xtrackers MSCI World Quality (Acc)',
    'SPDR MSCI Emerging Markets (Acc)'
  );

-- Verification - expect exactly 5 rows: 1 'BPI Dinâmico' + 4 'Global Factor Tilt'.
select name, sub_portfolio from public.securities where sub_portfolio is not null order by sub_portfolio, name;
