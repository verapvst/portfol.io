-- Portfolio.io — security_details extensions: subscription fee,
-- per-group "data as of" dates, a real auto-updating updated_at, and a
-- 4th data_quality state.
--
-- Additive only, 0005/0006 already ran against the live database - this
-- follows the same pattern as 0001 → 0002 (a later migration extends an
-- earlier table, never edits an already-applied file in place).
--
-- Why this exists: adding BPI Dinâmico surfaced two real gaps -
-- (1) subscription_fee_pct is a real, commonly-disclosed fund cost
-- (BPI's own Ficha Mensal has a dedicated "Comissão de Subscrição" line,
-- and js/importer/monthlyFactsheetParser.js already extracts it) that
-- 0005 simply didn't include; (2) the app has no general "Last
-- Updated"/"Data as of" concept anywhere yet, and security_details is
-- the first place where a single record can genuinely mix a real, dated
-- fact (BPI's TER, dated to a specific factsheet) with fields that are
-- still entirely unknown - one row-level "last_verified" date can't
-- honestly represent both.
--
-- How to run this: paste into the Supabase SQL Editor and run once,
-- after 0005/0006.

-- =========================================================================
-- 1. Missing real field
-- =========================================================================

alter table security_details add column subscription_fee_pct numeric;
comment on column security_details.subscription_fee_pct is
  'Annual/one-off subscription fee, % - the counterpart to redemption_fee_pct. Missing from 0005 by oversight, not a deliberate omission.';

-- =========================================================================
-- 2. "Last Updated" vs "Data as of" - a Portfolio.io-wide principle,
--    first applied here. See docs/data-freshness.md for the full
--    convention (source date > db update date > today-if-newly-entered
--    > omit if genuinely unknown - never a manufactured date).
--
--    updated_at = "Last updated": when this DATABASE ROW was last
--    touched - now made real by the trigger below (every table until
--    now just set it once at insert and left it frozen forever, which
--    silently made "Last Updated" meaningless the moment anyone edited
--    a row - a real, pre-existing gap, not new to this migration).
--
--    The three *_as_of columns = "Data as of": when the underlying
--    real-world figures in that specific group were true, which is
--    often NOT today and NOT the same as when the row was saved. A
--    fund's June TER doesn't become "current as of today" just because
--    someone typed it into Supabase today. Nullable and independent of
--    each other on purpose - BPI Dinâmico is the exact case that proves
--    why: its costs have a real dated source, its performance/risk
--    figures currently have none at all.
-- =========================================================================

alter table security_details add column costs_as_of date;
alter table security_details add column performance_as_of date;
alter table security_details add column allocation_as_of date;

comment on column security_details.costs_as_of is 'Data as of: the real-world date the TER/fee/AUM figures were true, per their source document. Not the row''s save date.';
comment on column security_details.performance_as_of is 'Data as of: the real-world date the return/risk figures were true.';
comment on column security_details.allocation_as_of is 'Data as of: the real-world date the allocation/exposure figures were true.';

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

comment on function set_updated_at is
  'Generic "Last Updated" trigger - stamps updated_at = now() on every UPDATE. Applied to security_details now; other tables can adopt the same trigger later without a schema change of their own (just `create trigger ... before update ... execute function set_updated_at()`), not required as part of this pass.';

create trigger security_details_set_updated_at
  before update on security_details
  for each row
  execute function set_updated_at();

-- =========================================================================
-- 3. A 4th data_quality state
-- =========================================================================

alter table security_details drop constraint security_details_data_quality_check;
alter table security_details add constraint security_details_data_quality_check
  check (data_quality in ('Real', 'Partial', 'Estimated', 'Unknown'));

comment on column security_details.data_quality is
  'Real = every material field for this row is sourced from a real document/database. Partial = a genuine mix (BPI Dinâmico is exactly this: real costs, unknown performance). Estimated = a considered proxy/assumption (e.g. a brand-new fund using a category-average risk figure). Unknown = we have the row at all mostly for identity (name/ISIN/type), not because we can substantiate its numbers. Deliberately does NOT include "Interpolated" - that concept belongs to a time series (valuations.real:true/false), not a static reference record; conflating the two here would blur exactly the distinction Vera asked to keep clean between "what a security is" (this table) and "what its value was over time" (valuations).';
