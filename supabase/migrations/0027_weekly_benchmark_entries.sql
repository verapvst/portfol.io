-- Portfolio.io — enable weekly manual benchmark observations.
--
-- WHY: 0018 retired the nightly benchmark auto-collector (no free API
-- exposes raw SPX/NDX index levels), so benchmark_history has only ever
-- had one static historical CSV import (monthly, Feb 2017 - Aug 2026).
-- Now that portfolio valuations are moving to a weekly manual Sunday
-- check-in (see js/data-hub.js's Weekly Check-in), the S&P 500/Nasdaq-100
-- comparison needs a matching weekly cadence, captured the same way -
-- manually, by the app's owner, through the Data Hub - not fabricated
-- or estimated (per the app owner's explicit instruction: never invent
-- a Sunday market price - markets are closed, so every entry names the
-- real trading day its index level actually came from).
--
-- Three changes, all additive:
--
-- 1. 'weekly' joins the existing daily/monthly frequency vocabulary -
--    this table already carries the exact same observation-density
--    column valuations got in 0024, for the same reason (never let a
--    reader assume daily coverage that isn't real).
alter table benchmark_history drop constraint if exists benchmark_history_frequency_check;
alter table benchmark_history add constraint benchmark_history_frequency_check
  check (frequency in ('daily', 'monthly', 'weekly'));

-- 2. A weekly entry has two genuinely different dates: the Sunday
--    checkpoint itself (`date`, same meaning as every other row in this
--    table and as valuations.date) and the real market trading day the
--    index level is actually from (markets are closed Sunday, so this
--    is never the same day as `date` for a weekly row - typically the
--    preceding Friday, but deliberately not assumed/defaulted anywhere
--    in the schema; the app's owner enters it explicitly each time).
--    Nullable: existing monthly CSV rows have no separate trading date
--    to backfill (the source export only ever gave one date per row),
--    and daily rows (if this table ever gets real daily coverage again)
--    have no need for it either, since `date` already is the trading
--    day for those.
alter table benchmark_history add column price_date date;

-- 3. This table has never had an authenticated write policy at all -
--    by design, 0016 restricted every write to the service_role key
--    (used only by the now-retired nightly Edge Functions), specifically
--    to keep the collected series free of anything but one trusted
--    automated source. A manual weekly entry now needs a real path in,
--    so this adds one - narrowly: INSERT only, matching the "observation
--    table, not a calculated one" discipline this table has always had
--    (0016's own header comment) and the same insert-only-forever
--    convention valuations already uses. No UPDATE/DELETE policy is
--    added - a wrong entry gets corrected the same way a wrong
--    valuation does, a new dated row, never an edit in place.
--    Mirrors the "shared reference data, any authenticated user may
--    write" precedent 0001 already set for institutions/securities -
--    there is only one real user of this app today.
create policy "authenticated insert" on benchmark_history for insert
  to authenticated
  with check (true);

-- Verification.
select column_name, data_type, is_nullable from information_schema.columns
  where table_name = 'benchmark_history' and table_schema = 'public' order by ordinal_position;
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.benchmark_history'::regclass and contype = 'c';
select polname, cmd, roles from pg_policies where tablename = 'benchmark_history';
