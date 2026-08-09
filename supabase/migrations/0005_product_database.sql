-- Portfolio.io — Product Database schema.
-- Source of truth for what this table means: docs/legacy-feature-inventory.md
-- ("The real product database" section) — this is the real 18-product/
-- 10-broker schema recovered from the old Portfol.io app's Excel-driven
-- database, adapted into Supabase per the Migration Plan's existing
-- extend-securities-with-security_details design (already anticipated
-- in docs/feature-backlog.md, not a new invention).
--
-- security_details is 1:1 with securities (Migration Plan §2.2's own
-- distinction: a product can be BOTH held (has transactions) and
-- researched (has security_details) - same row, same identity, never
-- a parallel/duplicate product table. "Held by me" vs "Research only"
-- is computed, not stored: exists(select 1 from transactions where
-- security_id = ...).
--
-- How to run this: paste into the Supabase SQL Editor and run once,
-- after 0001-0004. No IF NOT EXISTS guard, on purpose - same discipline
-- as every migration before this one (a partial second run fails
-- loudly instead of silently skipping).

-- =========================================================================
-- PRODUCT DETAIL (1:1 extension of securities - Research/Product Library)
-- =========================================================================

create table security_details (
  security_id               uuid primary key references securities(id) on delete cascade,

  launched_date              date,

  -- Costs (annual, % - TER is the small recurring number; see
  -- js/calculations.js:costDrag() for the separate cumulative-impact
  -- calculation this deliberately does NOT store, since Cost Drag
  -- depends on horizon/return assumptions chosen at view time, not a
  -- fixed product fact).
  ter_pct                   numeric,
  riy_pct                   numeric,
  management_fee_pct        numeric,
  depositary_fee_pct        numeric,
  redemption_fee_pct        numeric,
  aum_eur_millions          numeric,

  -- Performance (annualised, %, as reported at import time - not live,
  -- see last_verified below)
  return_1y_pct             numeric,
  return_3y_pct             numeric,
  return_5y_pct             numeric,
  volatility_pct            numeric,
  sharpe_ratio              numeric,
  sortino_ratio             numeric,
  beta                      numeric,
  tracking_error_pct        numeric,
  max_drawdown_pct          numeric,
  alpha_pct                 numeric,
  assumed_gross_return_pct  numeric,
  star_rating                smallint check (star_rating between 1 and 5),
  annual_returns             jsonb, -- {"2024": 13.7, "2023": 21.4, ...} - variable-length by product age, not worth a separate table

  -- Allocation / exposure (%, sum to ~100 within each group)
  alloc_stocks_pct          numeric,
  alloc_bonds_pct           numeric,
  alloc_other_pct           numeric,
  exposure_us_pct           numeric,
  exposure_eu_pct           numeric,
  exposure_em_pct           numeric,
  holdings_count            int,
  concentration_top10       numeric, -- 0-1, share of NAV in the top 10 holdings

  -- Taxation (Portuguese capital-gains regime - 4 holding-period
  -- brackets, per docs/legacy-feature-inventory.md's Cost Engine section)
  tax_rate_lt2y_pct         numeric,
  tax_rate_2to5y_pct        numeric,
  tax_rate_5to8y_pct        numeric,
  tax_rate_gt8y_pct         numeric,
  tax_deduction_pct         numeric, -- PPR entry-contribution deduction, where applicable
  tax_efficiency_score      smallint,

  -- Quality / provenance - the trust signal the old app surfaced on
  -- every product page, preserved deliberately (docs/legacy-feature-
  -- inventory.md flags this as worth keeping, not just the numbers)
  data_quality              text check (data_quality in ('Real', 'Partial', 'Estimated')),
  transparency_score        smallint,
  philosophy                text,
  sfdr_article               text,

  -- Traceability back to the source dataset this row was seeded from -
  -- not used by the app, just an honest paper trail
  legacy_product_id         text,
  source                    text,
  last_verified              date,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table security_details is
  'Research-facing product detail, 1:1 with securities. Editable reference data (Data, not Intelligence, per docs/migration-plan.md §1) - if a TER turns out wrong, this row gets corrected, nothing downstream is hardcoded.';

alter table security_details enable row level security;

-- Same tier as institutions/securities (0001_initial_schema.sql):
-- shared reference data, any authenticated user may read/write it.
-- Deliberately NOT anon-readable yet, even though Product Library is
-- meant to be Showcase-safe long-term (docs/information-architecture.md
-- §2, Research row) - securities today is a single shared table for
-- both real held positions and pure-research products, and opening it
-- to anon would also expose which securities are Vera's actual
-- holdings. Real anon-safe Showcase access needs the public_* views
-- already designed in docs/production-architecture.md §1.1 (not built)
-- - a deliberate, documented interim simplification, not an oversight.
create policy "authenticated read"  on security_details for select using (auth.role() = 'authenticated');
create policy "authenticated write" on security_details for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- =========================================================================
-- BROKERS (standalone reference data - not tied to any security)
-- =========================================================================

create table brokers (
  id                     text primary key, -- short slug, e.g. 'trading212' - human-readable, matches the source dataset's own ids
  name                   text not null,
  country                text,
  regulator              text,
  publicly_listed        boolean,
  founded_year           int,
  protection_amount      numeric,
  protection_currency    text,
  custodian              text,
  etf_commission         numeric,
  stock_commission       numeric,
  fx_fee_pct             numeric,
  custody_fee_pct        numeric,
  inactivity_fee         numeric,
  withdrawal_fee         numeric,
  fractional_etfs        boolean,
  fractional_stocks      boolean,
  auto_investing         boolean,
  tax_report_provided    boolean,
  interest_on_cash_pct   numeric,
  tax_simplicity_score   smallint,
  beginner_score         smallint,
  advanced_score         smallint,
  cost_score             smallint,
  safety_score           smallint,
  ux_score               smallint,
  website                text,
  description            text,
  pros                   text[],
  cons                   text[],
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table brokers is
  'Broker comparison reference data, per docs/legacy-feature-inventory.md''s Tools section - not tied to any account/security, purely for the future broker-comparison/recommendation feature.';

alter table brokers enable row level security;

create policy "authenticated read"  on brokers for select using (auth.role() = 'authenticated');
create policy "authenticated write" on brokers for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
