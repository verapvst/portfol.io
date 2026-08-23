-- Portfolio.io — Personal Finance Architecture Phase 2: monthly BPI
-- snapshot history (docs/personal-finance-architecture.md §F/§J Phase 2,
-- migration-plan.md §2.6 - fully specified there, never built until now).
--
-- What this fund actually held on a given report date - every
-- underlying position inside a fund-of-funds, at one point in time.
-- Genuinely different in kind from security_details.top_holdings/
-- all_holdings (0011/0012), which stay exactly as they are: those are
-- deliberately CURRENT-STATE-ONLY, upserted/overwritten on every import
-- per an earlier, real decision ("don't accumulate historical
-- composition rows forever") - they still answer "what does this fund
-- hold right now" for Securities/Product Detail, and this migration
-- does not touch them. This table answers a different question -
-- "what did this fund hold in August vs. September" - which needs the
-- opposite discipline: insert-only, one full batch of rows per
-- security per report_date, never overwritten. Same append-only
-- pattern this app already uses for valuations/benchmark_history,
-- applied to a fund's own composition instead of its price.
--
-- No portfolio_id: like securities/security_details/brokers, a fund's
-- own holdings are a fact about the PRODUCT, not about Vera's personal
-- position - the existence of a row here means "this fund held this
-- position on this date", never "Vera owns this". Same Layer 1 public-
-- research principle already established for Securities/Brokers this
-- session (0014) - anon gets read access from the start here, not as a
-- later, separate migration.
--
-- exposure_country/exposure_region are already real, computed data
-- today (js/importer/geoClassifier.js, wired into data-hub.js's
-- classifyGroupHoldings() - confirmed, not a gap) - just never had
-- anywhere to be saved until now.

create table detailed_portfolio_holdings (
  id               uuid primary key default gen_random_uuid(),
  security_id      uuid not null references securities(id) on delete cascade,
  report_date      date not null,
  category_path    text,
  holding_name     text not null,
  currency         text,
  quantity         numeric,
  price            numeric,
  price_type       text,
  market_value     numeric,
  weight_pct       numeric,
  exposure_country text,
  exposure_region  text,
  source           text,
  created_at       timestamptz not null default now()
);

comment on table detailed_portfolio_holdings is
  'A fund''s own underlying composition at a report date - one full batch of rows per security per report_date, insert-only, never overwritten. Distinct from security_details.top_holdings/all_holdings (0011/0012), which stay current-state-only on purpose. Public research data (Layer 1), same as securities/security_details/brokers - no personal ownership dimension.';

create index detailed_portfolio_holdings_security_date_idx on detailed_portfolio_holdings (security_id, report_date);

alter table detailed_portfolio_holdings enable row level security;

create policy "authenticated read"  on detailed_portfolio_holdings for select using (auth.role() = 'authenticated');
create policy "authenticated write" on detailed_portfolio_holdings for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "anon read" on detailed_portfolio_holdings for select to anon using (true);
