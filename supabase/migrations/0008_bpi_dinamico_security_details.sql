-- Portfolio.io — BPI Dinâmico security_details row.
--
-- NOT a new security. BPI Dinâmico already exists in `securities`
-- (Vera's real held fund, subscribed 2017-06-21) - this migration adds
-- ONE security_details row to that EXISTING record, exactly the same
-- 1:1-extension pattern as 0006's four already-held ETFs. It does not
-- touch valuations, transactions, or the security's own name/isin/type -
-- those remain exactly as they are. This table describes what BPI
-- Dinâmico IS; valuations continues to be the only source of what it
-- was WORTH over time - the two are never merged.
--
-- Every field below is reconciled from real sources already in this
-- repository (see each column's inline note for exactly which). Fields
-- with no substantiated source are left NULL, not guessed - per the
-- "do not invent missing information" instruction. See
-- docs/data-freshness.md for the costs_as_of/performance_as_of/
-- allocation_as_of convention this migration is the first real user of.
--
-- Run this only after 0007 (adds the columns this insert uses) and only
-- after Vera confirms the reconciliation notes below - NOT auto-applied.
--
-- IMPORTANT re: the cost figures below - _check_bpi_costs.sql was run
-- against the live database on 2026-08-09 and returned zero rows: no
-- BPI Ficha Mensal has actually been imported through Data Hub for BPI
-- Dinâmico's cost section yet. The 0.835/0.090/0.000/0.000 figures
-- below are a documentation cross-reference (docs/workbook-
-- architecture.md's Costs sheet transcription, corroborated by
-- js/costs.js's own example placeholder), NOT a confirmed live import.
-- Real, not invented - but not database-verified either. Importing a
-- real BPI Ficha Mensal PDF through Data Hub before running this
-- migration would replace this with a properly sourced, live-confirmed
-- figure instead.

-- =========================================================================
-- Open item, flagged rather than silently resolved: BPI Dinâmico's isin
-- in the live `securities` table is 'PTYPJJHM0002' - which is also the
-- legacy database's stated ISIN for a DIFFERENT product ("BPI Impacto
-- Clima Ações", PROD002 in 0006). One of the two is very likely a
-- data-entry error somewhere upstream (not something to guess-fix here).
-- This migration does not touch securities.isin at all - only surfacing
-- the concern again since it's directly relevant to the record being
-- added right next to it.
-- =========================================================================

insert into security_details (
  security_id,
  ter_pct, depositary_fee_pct, subscription_fee_pct, redemption_fee_pct,
  alloc_stocks_pct, alloc_bonds_pct, alloc_other_pct,
  holdings_count,
  tax_rate_lt2y_pct, tax_rate_2to5y_pct, tax_rate_5to8y_pct, tax_rate_gt8y_pct, tax_deduction_pct,
  data_quality,
  costs_as_of, allocation_as_of, last_verified,
  source
) values (
  (select id from securities where name = 'BPI Dinâmico'),

  -- Costs: docs/workbook-architecture.md's Costs sheet transcription
  -- (BPI Ficha Mensal, dated 2026-06-30), corroborated by the exact same
  -- 0.835 figure already used as js/costs.js's own example placeholder -
  -- not a coincidence, that placeholder was clearly written from this
  -- fund's real number. NOT confirmed by a live `costs` table row as of
  -- 2026-08-09 (_check_bpi_costs.sql returned zero rows) - see the
  -- header comment above. management_fee_pct intentionally left null:
  -- the Ficha Mensal's Costs section discloses TER/Depositary/
  -- Subscription/Redemption as four line items, not a separately-
  -- broken-out management fee distinct from TER - inventing a split
  -- isn't justified by what's actually on the document.
  0.835, 0.090, 0.000, 0.000,

  -- Allocation: BPI Dinâmico's real internal asset-class split (source:
  -- BPI Ficha Mensal, June 2026 - see js/repository.js's own comment,
  -- "real internal asset-class split"). The real split has 4 categories
  -- (Cash 5.67% / Bonds 36.04% / Equities 37.77% / Alternatives 20.53%);
  -- this schema only has 3 buckets, so Cash+Alternatives (26.20%) are
  -- combined into "other" - an aggregation of two real disclosed
  -- figures, not an invented one.
  37.77, 36.04, 26.20,

  -- 118 real underlying holdings (its Detailed Portfolio) - cited
  -- repeatedly across docs/migration-plan.md and
  -- js/importer/geoClassifier.js's own comments, manually classified in
  -- Version 1.7/1.8 of the workbook.
  118,

  -- Tax: standard Portuguese mutual-fund capital-gains regime (the same
  -- bracket structure as every "Fund"-type product in 0006, e.g.
  -- PROD001) - this is a REGULATORY fact about the product category
  -- (Fundo de Investimento Mobiliário), not something specific to BPI
  -- Dinâmico that needed its own source; no PPR-style entry deduction
  -- applies since this isn't a PPR.
  28.0, 25.2, 22.4, 19.6, 0,

  -- Real costs and real allocation, but no performance/risk/AUM/rating
  -- data at all yet (see the many nulls above/below) - Partial is the
  -- honest tag, not Real.
  'Partial',

  '2026-06-30', '2026-06-30', current_date,

  'Reconciled 2026-08-09 from: live securities record (id/name/isin/type, pre-existing), docs/workbook-architecture.md (Costs sheet, BPI Ficha Mensal transcription - NOT yet confirmed by a live costs table row, _check_bpi_costs.sql returned zero rows on 2026-08-09), js/repository.js comments (BPI Ficha Mensal June 2026 internal split), js/importer/geoClassifier.js + docs/migration-plan.md (118 real Detailed Portfolio holdings). Fund-level AUM, performance, risk metrics, benchmark, real launch date (distinct from Vera''s 2017-06-21 subscription date), SFDR article and star rating are not yet substantiated - left null rather than estimated. The Data Hub''s BPI Ficha Mensal parser (js/importer/monthlyFactsheetParser.js) can extract several of these (launch_date, assets_under_management) automatically from a real BPI PDF the next time one is imported - that''s the intended path to filling these in with real data, not a manual guess.'
)
on conflict (security_id) do nothing;
-- Guards against a duplicate-key error if this file is accidentally run
-- twice (security_id is security_details' primary key) - matches the
-- "make partial/repeat runs safe, not just single-shot" lesson from
-- 0007's own re-run failure this session.
