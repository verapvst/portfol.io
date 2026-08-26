-- One-time historical correction, NOT a numbered migration - replaces the
-- BPI Dinâmico valuation history for the period you actually held it
-- (2017-06-21, the one Buy transaction, through 2026-08-04, the day of
-- your first ETF purchases) with real dated NAV observations extracted
-- from a bancobpi.pt export, in place of the previous series.
--
-- WHY THIS EXISTS
-- The previous 112-113 rows for this security were ~85% synthetic: only
-- 17 were real reported figures (mostly quarterly "Relatório e Contas
-- 2024" points), and 95+ were straight-line interpolation between them -
-- including one unbroken ~4.7-year stretch (2017-2022) with zero real
-- grounding. That's not what "historical data" should mean.
--
-- The replacement series below is 167 rows spanning 2017-07-03 (the first
-- CSV observation on or after your 2017-06-21 purchase) through
-- 2026-08-04 (your first ETF buy). 166 of the 167 rows are real NAV
-- observations from bancobpi.pt (nav-per-unit x 25.2617 units, the
-- constant unit count from the single BPI-DIN-000001 Buy transaction),
-- spaced ~3 weeks apart with zero gaps over 25 days. Nothing in those
-- 166 rows is interpolated, estimated, or invented.
--
-- The 167th row (2026-08-04, the final one) is a deliberate exception:
-- per an explicit decision on 2026-08-26, it keeps the pre-existing
-- manually-verified value_eur of 335.44 (source: Trading212/BPI app
-- cross-check on that date) instead of the CSV-implied 339.52
-- (nav 13.44 x 25.2617). The two differ by ~1.2%, plausibly a same-day
-- reporting lag between the official BPI NAV feed and the app's live
-- quote - the decision was to trust the app cross-check for that one
-- date rather than the NAV export.
--
-- SCOPE - READ THIS BEFORE RUNNING
--   - Only touches valuations for the security named exactly
--     'BPI Dinâmico'.
--   - Only touches rows with date <= '2026-08-04' (your first ETF buy).
--     Anything dated after that is deliberately left untouched - it's
--     outside the BPI Dinâmico historical-period boundary and may
--     reflect live/ongoing tracking you don't want disturbed.
--
-- SAFETY - NOTHING IS DELETED WITHOUT BEING PRESERVED FIRST
--   1. Every row currently in `valuations` for BPI Dinâmico with
--      date <= 2026-08-04 is copied into a new backup table,
--      `public.valuations_bpi_dinamico_backup_20260826`, before anything
--      is deleted. That table is never dropped by this script - if
--      anything here looks wrong afterwards, the original rows are all
--      still sitting there to restore from.
--   2. The delete + insert only runs after confirming the backup row
--      count exactly matches the live row count for that security/date
--      range - if they don't match for any reason, the script raises an
--      exception and stops before touching `valuations`.
--
-- How to run: paste the whole file into the Supabase project's SQL
-- Editor and run it once. Every table is schema-qualified (public.xxx).
-- This is real financial data, not draft - read it before running it.

create table if not exists public.valuations_bpi_dinamico_backup_20260826 as
select v.*
from public.valuations v
join public.securities s on s.id = v.security_id
where s.name = 'BPI Dinâmico'
  and v.date <= '2026-08-04'
with no data;

insert into public.valuations_bpi_dinamico_backup_20260826
select v.*
from public.valuations v
join public.securities s on s.id = v.security_id
where s.name = 'BPI Dinâmico'
  and v.date <= '2026-08-04'
  and not exists (
    select 1 from public.valuations_bpi_dinamico_backup_20260826 b where b.id = v.id
  );

do $$
declare
  real_id uuid;
  portfolio_id_val uuid;
  backup_count int;
  live_count int;
begin
  select id into real_id from public.securities where name = 'BPI Dinâmico';
  if real_id is null then
    raise exception 'No security named exactly "BPI Dinâmico" found - stopping before touching any data.';
  end if;

  select id into portfolio_id_val from public.portfolios limit 1;
  if portfolio_id_val is null then
    raise exception 'No portfolio row found - stopping.';
  end if;

  select count(*) into backup_count
  from public.valuations_bpi_dinamico_backup_20260826;

  select count(*) into live_count
  from public.valuations
  where security_id = real_id and date <= '2026-08-04';

  if backup_count <> live_count then
    raise exception 'Backup has % row(s) but % live row(s) match security_id/date range - refusing to delete until these match exactly. Investigate before re-running.', backup_count, live_count;
  end if;

  raise notice 'Backup verified: % row(s) safely preserved in valuations_bpi_dinamico_backup_20260826. Proceeding to replace with 167 CSV-reconciled rows.', backup_count;

  delete from public.valuations
  where security_id = real_id and date <= '2026-08-04';

  insert into public.valuations
    (security_id, portfolio_id, date, value_eur, units, source, import_date, report_date, import_method, import_version, notes)
  values
    (real_id, portfolio_id_val, '2017-07-03'::date, 248.58, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.84.'),
    (real_id, portfolio_id_val, '2017-07-24'::date, 248.58, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.84.'),
    (real_id, portfolio_id_val, '2017-08-11'::date, 247.06, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.78.'),
    (real_id, portfolio_id_val, '2017-08-31'::date, 247.06, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.78.'),
    (real_id, portfolio_id_val, '2017-09-20'::date, 249.08, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.86.'),
    (real_id, portfolio_id_val, '2017-10-10'::date, 251.35, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.95.'),
    (real_id, portfolio_id_val, '2017-10-30'::date, 253.12, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.02.'),
    (real_id, portfolio_id_val, '2017-11-20'::date, 250.85, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.93.'),
    (real_id, portfolio_id_val, '2017-12-11'::date, 252.36, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.99.'),
    (real_id, portfolio_id_val, '2017-12-29'::date, 251.61, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.96.'),
    (real_id, portfolio_id_val, '2018-01-18'::date, 255.4, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.11.'),
    (real_id, portfolio_id_val, '2018-02-07'::date, 250.09, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.9.'),
    (real_id, portfolio_id_val, '2018-02-27'::date, 251.61, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.96.'),
    (real_id, portfolio_id_val, '2018-03-19'::date, 249.84, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.89.'),
    (real_id, portfolio_id_val, '2018-04-09'::date, 248.07, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.82.'),
    (real_id, portfolio_id_val, '2018-04-30'::date, 250.34, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.91.'),
    (real_id, portfolio_id_val, '2018-05-18'::date, 252.11, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.98.'),
    (real_id, portfolio_id_val, '2018-06-07'::date, 251.1, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.94.'),
    (real_id, portfolio_id_val, '2018-06-27'::date, 248.58, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.84.'),
    (real_id, portfolio_id_val, '2018-07-17'::date, 250.09, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.9.'),
    (real_id, portfolio_id_val, '2018-08-06'::date, 251.1, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.94.'),
    (real_id, portfolio_id_val, '2018-08-27'::date, 250.34, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.91.'),
    (real_id, portfolio_id_val, '2018-09-17'::date, 249.33, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.87.'),
    (real_id, portfolio_id_val, '2018-10-04'::date, 249.59, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.88.'),
    (real_id, portfolio_id_val, '2018-10-25'::date, 241.25, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.55.'),
    (real_id, portfolio_id_val, '2018-11-14'::date, 242.26, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.59.'),
    (real_id, portfolio_id_val, '2018-12-04'::date, 241.0, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.54.'),
    (real_id, portfolio_id_val, '2018-12-21'::date, 233.17, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.23.'),
    (real_id, portfolio_id_val, '2019-01-14'::date, 236.95, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.38.'),
    (real_id, portfolio_id_val, '2019-02-04'::date, 241.0, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.54.'),
    (real_id, portfolio_id_val, '2019-02-22'::date, 244.03, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.66.'),
    (real_id, portfolio_id_val, '2019-03-14'::date, 245.29, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.71.'),
    (real_id, portfolio_id_val, '2019-04-03'::date, 248.07, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.82.'),
    (real_id, portfolio_id_val, '2019-04-23'::date, 250.09, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.9.'),
    (real_id, portfolio_id_val, '2019-05-13'::date, 245.54, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.72.'),
    (real_id, portfolio_id_val, '2019-06-03'::date, 243.78, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.65.'),
    (real_id, portfolio_id_val, '2019-06-24'::date, 247.31, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.79.'),
    (real_id, portfolio_id_val, '2019-07-12'::date, 249.08, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.86.'),
    (real_id, portfolio_id_val, '2019-08-01'::date, 248.83, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.85.'),
    (real_id, portfolio_id_val, '2019-08-21'::date, 246.3, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.75.'),
    (real_id, portfolio_id_val, '2019-09-10'::date, 248.58, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.84.'),
    (real_id, portfolio_id_val, '2019-09-30'::date, 249.33, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.87.'),
    (real_id, portfolio_id_val, '2019-10-21'::date, 249.08, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.86.'),
    (real_id, portfolio_id_val, '2019-11-11'::date, 252.11, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.98.'),
    (real_id, portfolio_id_val, '2019-11-29'::date, 253.12, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.02.'),
    (real_id, portfolio_id_val, '2019-12-19'::date, 254.89, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.09.'),
    (real_id, portfolio_id_val, '2020-01-08'::date, 256.15, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.14.'),
    (real_id, portfolio_id_val, '2020-01-28'::date, 256.15, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.14.'),
    (real_id, portfolio_id_val, '2020-02-17'::date, 260.7, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.32.'),
    (real_id, portfolio_id_val, '2020-03-09'::date, 243.02, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.62.'),
    (real_id, portfolio_id_val, '2020-03-30'::date, 231.14, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.15.'),
    (real_id, portfolio_id_val, '2020-04-17'::date, 241.75, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.57.'),
    (real_id, portfolio_id_val, '2020-05-07'::date, 244.03, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.66.'),
    (real_id, portfolio_id_val, '2020-05-27'::date, 247.31, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.79.'),
    (real_id, portfolio_id_val, '2020-06-16'::date, 251.61, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 9.96.'),
    (real_id, portfolio_id_val, '2020-07-06'::date, 256.91, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.17.'),
    (real_id, portfolio_id_val, '2020-07-27'::date, 258.43, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.23.'),
    (real_id, portfolio_id_val, '2020-08-17'::date, 260.45, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.31.'),
    (real_id, portfolio_id_val, '2020-09-04'::date, 260.45, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.31.'),
    (real_id, portfolio_id_val, '2020-09-24'::date, 258.17, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.22.'),
    (real_id, portfolio_id_val, '2020-10-14'::date, 265.75, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.52.'),
    (real_id, portfolio_id_val, '2020-11-03'::date, 261.71, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.36.'),
    (real_id, portfolio_id_val, '2020-11-23'::date, 268.53, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.63.'),
    (real_id, portfolio_id_val, '2020-12-14'::date, 270.05, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.69.'),
    (real_id, portfolio_id_val, '2021-01-04'::date, 273.08, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.81.'),
    (real_id, portfolio_id_val, '2021-01-22'::date, 276.11, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.93.'),
    (real_id, portfolio_id_val, '2021-02-11'::date, 278.89, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.04.'),
    (real_id, portfolio_id_val, '2021-03-03'::date, 274.85, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.88.'),
    (real_id, portfolio_id_val, '2021-03-23'::date, 274.34, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.86.'),
    (real_id, portfolio_id_val, '2021-04-12'::date, 277.37, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.98.'),
    (real_id, portfolio_id_val, '2021-05-03'::date, 277.88, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.0.'),
    (real_id, portfolio_id_val, '2021-05-24'::date, 277.37, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.98.'),
    (real_id, portfolio_id_val, '2021-06-11'::date, 281.16, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.13.'),
    (real_id, portfolio_id_val, '2021-07-01'::date, 281.67, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.15.'),
    (real_id, portfolio_id_val, '2021-07-21'::date, 281.67, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.15.'),
    (real_id, portfolio_id_val, '2021-08-10'::date, 284.7, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.27.'),
    (real_id, portfolio_id_val, '2021-08-30'::date, 284.95, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.28.'),
    (real_id, portfolio_id_val, '2021-09-20'::date, 282.17, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.17.'),
    (real_id, portfolio_id_val, '2021-10-11'::date, 283.18, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.21.'),
    (real_id, portfolio_id_val, '2021-10-29'::date, 286.22, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.33.'),
    (real_id, portfolio_id_val, '2021-11-18'::date, 291.01, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.52.'),
    (real_id, portfolio_id_val, '2021-12-07'::date, 288.74, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.43.'),
    (real_id, portfolio_id_val, '2021-12-28'::date, 288.49, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.42.'),
    (real_id, portfolio_id_val, '2022-01-17'::date, 286.72, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.35.'),
    (real_id, portfolio_id_val, '2022-02-07'::date, 280.15, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.09.'),
    (real_id, portfolio_id_val, '2022-02-28'::date, 279.39, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.06.'),
    (real_id, portfolio_id_val, '2022-03-18'::date, 280.15, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.09.'),
    (real_id, portfolio_id_val, '2022-04-07'::date, 278.13, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.01.'),
    (real_id, portfolio_id_val, '2022-04-27'::date, 273.08, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.81.'),
    (real_id, portfolio_id_val, '2022-05-17'::date, 270.3, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.7.'),
    (real_id, portfolio_id_val, '2022-06-06'::date, 270.81, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.72.'),
    (real_id, portfolio_id_val, '2022-06-27'::date, 264.49, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.47.'),
    (real_id, portfolio_id_val, '2022-07-18'::date, 265.25, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.5.'),
    (real_id, portfolio_id_val, '2022-08-05'::date, 271.06, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.73.'),
    (real_id, portfolio_id_val, '2022-08-25'::date, 272.07, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.77.'),
    (real_id, portfolio_id_val, '2022-09-14'::date, 265.0, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.49.'),
    (real_id, portfolio_id_val, '2022-10-04'::date, 260.95, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.33.'),
    (real_id, portfolio_id_val, '2022-10-24'::date, 255.9, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.13.'),
    (real_id, portfolio_id_val, '2022-11-14'::date, 261.71, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.36.'),
    (real_id, portfolio_id_val, '2022-12-05'::date, 262.72, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.4.'),
    (real_id, portfolio_id_val, '2022-12-23'::date, 257.67, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.2.'),
    (real_id, portfolio_id_val, '2023-01-11'::date, 261.96, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.37.'),
    (real_id, portfolio_id_val, '2023-02-01'::date, 265.75, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.52.'),
    (real_id, portfolio_id_val, '2023-02-20'::date, 263.73, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.44.'),
    (real_id, portfolio_id_val, '2023-03-13'::date, 259.94, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.29.'),
    (real_id, portfolio_id_val, '2023-04-03'::date, 263.73, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.44.'),
    (real_id, portfolio_id_val, '2023-04-24'::date, 261.96, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.37.'),
    (real_id, portfolio_id_val, '2023-05-12'::date, 263.23, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.42.'),
    (real_id, portfolio_id_val, '2023-06-01'::date, 265.25, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.5.'),
    (real_id, portfolio_id_val, '2023-06-21'::date, 265.5, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.51.'),
    (real_id, portfolio_id_val, '2023-07-11'::date, 263.98, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.45.'),
    (real_id, portfolio_id_val, '2023-07-31'::date, 268.28, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.62.'),
    (real_id, portfolio_id_val, '2023-08-21'::date, 262.22, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.38.'),
    (real_id, portfolio_id_val, '2023-09-11'::date, 266.51, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.55.'),
    (real_id, portfolio_id_val, '2023-09-29'::date, 263.23, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.42.'),
    (real_id, portfolio_id_val, '2023-10-19'::date, 261.96, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.37.'),
    (real_id, portfolio_id_val, '2023-11-08'::date, 265.0, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.49.'),
    (real_id, portfolio_id_val, '2023-11-28'::date, 268.53, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.63.'),
    (real_id, portfolio_id_val, '2023-12-18'::date, 274.34, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.86.'),
    (real_id, portfolio_id_val, '2024-01-08'::date, 274.59, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 10.87.'),
    (real_id, portfolio_id_val, '2024-01-29'::date, 277.88, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.0.'),
    (real_id, portfolio_id_val, '2024-02-16'::date, 279.9, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.08.'),
    (real_id, portfolio_id_val, '2024-03-07'::date, 283.44, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.22.'),
    (real_id, portfolio_id_val, '2024-03-27'::date, 285.96, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.32.'),
    (real_id, portfolio_id_val, '2024-04-16'::date, 282.68, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.19.'),
    (real_id, portfolio_id_val, '2024-05-06'::date, 285.2, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.29.'),
    (real_id, portfolio_id_val, '2024-05-27'::date, 286.97, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.36.'),
    (real_id, portfolio_id_val, '2024-06-17'::date, 287.98, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.4.'),
    (real_id, portfolio_id_val, '2024-07-05'::date, 290.0, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.48.'),
    (real_id, portfolio_id_val, '2024-07-25'::date, 288.24, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.41.'),
    (real_id, portfolio_id_val, '2024-08-14'::date, 288.74, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.43.'),
    (real_id, portfolio_id_val, '2024-09-03'::date, 292.03, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.56.'),
    (real_id, portfolio_id_val, '2024-09-23'::date, 294.05, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.64.'),
    (real_id, portfolio_id_val, '2024-10-14'::date, 297.58, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.78.'),
    (real_id, portfolio_id_val, '2024-11-04'::date, 294.05, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.64.'),
    (real_id, portfolio_id_val, '2024-11-22'::date, 300.61, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.9.'),
    (real_id, portfolio_id_val, '2024-12-12'::date, 302.89, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.99.'),
    (real_id, portfolio_id_val, '2024-12-31'::date, 298.34, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.81.'),
    (real_id, portfolio_id_val, '2025-01-21'::date, 301.88, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.95.'),
    (real_id, portfolio_id_val, '2025-02-10'::date, 305.92, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.11.'),
    (real_id, portfolio_id_val, '2025-03-03'::date, 304.4, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.05.'),
    (real_id, portfolio_id_val, '2025-03-24'::date, 299.86, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.87.'),
    (real_id, portfolio_id_val, '2025-04-11'::date, 284.7, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.27.'),
    (real_id, portfolio_id_val, '2025-04-30'::date, 293.79, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.63.'),
    (real_id, portfolio_id_val, '2025-05-21'::date, 300.87, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.91.'),
    (real_id, portfolio_id_val, '2025-06-09'::date, 302.64, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.98.'),
    (real_id, portfolio_id_val, '2025-06-30'::date, 302.64, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 11.98.'),
    (real_id, portfolio_id_val, '2025-07-21'::date, 304.91, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.07.'),
    (real_id, portfolio_id_val, '2025-08-11'::date, 306.68, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.14.'),
    (real_id, portfolio_id_val, '2025-08-29'::date, 307.94, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.19.'),
    (real_id, portfolio_id_val, '2025-09-18'::date, 311.48, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.33.'),
    (real_id, portfolio_id_val, '2025-10-08'::date, 317.54, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.57.'),
    (real_id, portfolio_id_val, '2025-10-28'::date, 319.06, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.63.'),
    (real_id, portfolio_id_val, '2025-11-17'::date, 318.04, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.59.'),
    (real_id, portfolio_id_val, '2025-12-05'::date, 319.56, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.65.'),
    (real_id, portfolio_id_val, '2025-12-29'::date, 320.32, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.68.'),
    (real_id, portfolio_id_val, '2026-01-16'::date, 327.39, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.96.'),
    (real_id, portfolio_id_val, '2026-02-05'::date, 325.88, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.9.'),
    (real_id, portfolio_id_val, '2026-02-25'::date, 332.95, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 13.18.'),
    (real_id, portfolio_id_val, '2026-03-17'::date, 326.13, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.91.'),
    (real_id, portfolio_id_val, '2026-04-02'::date, 321.58, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 12.73.'),
    (real_id, portfolio_id_val, '2026-04-27'::date, 328.4, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 13.0.'),
    (real_id, portfolio_id_val, '2026-05-18'::date, 331.18, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 13.11.'),
    (real_id, portfolio_id_val, '2026-06-05'::date, 334.97, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 13.26.'),
    (real_id, portfolio_id_val, '2026-06-25'::date, 338.51, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 13.4.'),
    (real_id, portfolio_id_val, '2026-07-15'::date, 338.0, 25.2617, 'BPI Dinâmico historical NAV export (bancobpi.pt)', current_date, null, 'CSV reconciliation', 'v1', 'Reconciled 2026-08-26 from user-supplied bancobpi.pt NAV export, replacing prior interpolated series. Source NAV per unit: 13.38.'),
    (real_id, portfolio_id_val, '2026-08-04'::date, 335.44, 25.2617, 'Trading 212 app / BPI app cross-check', current_date, null, 'Manual', 'v1', 'Kept from prior series by explicit decision on 2026-08-26: retains the app cross-check value (335.44) instead of the CSV/NAV-export-implied value (339.52, nav 13.44 x 25.2617) for this date. All other 166 rows in this series are unmodified CSV NAV observations.');

  raise notice 'Inserted 167 valuation rows for BPI Dinâmico (2017-07-03 through 2026-08-04): 166 genuine CSV NAV observations plus one retained manual value (2026-08-04, kept at 335.44 per 2026-08-26 decision). Old series (up to and including 2026-08-04) fully replaced; anything dated after 2026-08-04 was left untouched.';
end $$;

-- After running, sanity-check with:
--   select count(*) from public.valuations v join public.securities s on s.id = v.security_id where s.name = 'BPI Dinâmico';
--   select min(date), max(date), count(*) from public.valuations v join public.securities s on s.id = v.security_id where s.name = 'BPI Dinâmico' and date <= '2026-08-04';
-- Expect 167 rows in the second query, dates from 2017-07-03 to 2026-08-04.
