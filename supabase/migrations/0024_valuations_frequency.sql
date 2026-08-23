-- Portfolio.io — Personal Finance Architecture Phase 1: weekly valuation
-- workflow (docs/personal-finance-architecture.md §F/§J Phase 1).
--
-- Adds the same observation-density column benchmark_history already has
-- (0018_benchmark_index_level_restructure.sql) to valuations, so a
-- weekly portfolio check-in can be told apart from an ad-hoc/daily
-- manual entry without inferring it from point spacing later.
--
-- Nullable, no default and no backfill on purpose - we genuinely don't
-- know the real cadence behind existing historical rows (some were
-- daily-ish manual entries, some were BPI-report-driven, none were
-- tagged at the time), and forcing a guessed value onto them would
-- violate this app's own "never manufacture a fact we don't have"
-- discipline (docs/data-freshness.md's date-choice hierarchy makes the
-- same call for dates: unknown stays null, never fabricated). New rows
-- from the Weekly Check-in flow (js/data-hub.js) explicitly set
-- frequency='weekly'; every other existing write path is unaffected
-- and keeps writing frequency=null exactly as before this migration.

alter table valuations add column frequency text check (frequency in ('daily', 'weekly', 'monthly'));

comment on column valuations.frequency is
  'Observation cadence, when known - "weekly" for Sunday check-ins (js/data-hub.js), null for ad-hoc/unspecified manual entries (existing behaviour, unchanged). Never inferred or backfilled - see this migration''s own header for why.';
