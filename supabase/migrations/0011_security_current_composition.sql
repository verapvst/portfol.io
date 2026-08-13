-- Portfolio.io — current-state fund composition (top holdings), stored
-- on security_details rather than a new historical table.
--
-- Context: js/importer/monthlyFactsheetParser.js already extracts a
-- top_holdings list from a BPI Ficha Mensal PDF ({asset, weight_pct}
-- pairs), but nothing has ever persisted that output anywhere - it was
-- computed and discarded on every import until now. So this migration
-- is NOT a migration away from an existing large table: audited first
-- (grepped every write path in js/data-hub.js) and confirmed zero rows
-- of historical composition exist anywhere in this database today.
-- There is nothing to delete, nothing to decide a cutover strategy for.
--
-- Architecture decision: CURRENT STATE ONLY, replaced wholesale on each
-- import - not one row per holding per month accumulating forever. A
-- fund's top-10 holdings list is read/written as one unit (nobody
-- queries "every security that ever held Apple in March"), exactly the
-- same shape and same real precedent already in this table:
-- security_details.annual_returns (jsonb, "variable-length by product
-- age, not worth a separate table" - migration 0005's own comment).
-- top_holdings follows that exact precedent rather than inventing a new
-- pattern - a new relational table (e.g. security_current_holdings)
-- was considered and rejected: it would need its own RLS policy, its
-- own join everywhere it's read, and solves a cross-security query need
-- ("which of my funds hold Apple") nobody has asked for yet - exactly
-- the over-engineering this pass was told to avoid.
--
-- Provenance: composition_as_of follows the exact same convention as
-- costs_as_of/performance_as_of/allocation_as_of (migration 0007) - the
-- factsheet's own reporting date, never today's date. "Imported at" /
-- "Last updated" needs no new column: security_details.updated_at is
-- already a real, trigger-maintained timestamp (0007's set_updated_at())
-- that fires on any update to this row, including this one. Source
-- reuses the existing single security_details.source column, matching
-- how costs/performance/allocation already share it rather than each
-- getting its own.

alter table security_details add column if not exists top_holdings jsonb;
comment on column security_details.top_holdings is
  'Current top holdings only - [{"asset": "...", "weight_pct": ...}, ...], ranked as printed on the source factsheet. Replaced wholesale on each new factsheet import (see js/data-hub.js:loadCostsToDatabase()), never accumulated historically - same "variable-length, always read/written as a whole" pattern as annual_returns above. Null means genuinely not yet imported, not zero holdings.';

alter table security_details add column if not exists composition_as_of date;
comment on column security_details.composition_as_of is
  'Data as of: the real-world date the factsheet''s holdings were true (its own reporting date) - same Last Updated / Data as of convention as costs_as_of/performance_as_of/allocation_as_of (0007). Not the row''s save date - security_details.updated_at (0007''s trigger) already covers "when was this last imported/touched".';
