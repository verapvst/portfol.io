-- Portfolio.io — schedules fetch-benchmark-history-weekly to run every
-- Sunday, matching the portfolio's own Weekly Check-in cadence
-- (js/data-hub.js's mostRecentSunday()). Modeled on
-- 0010_schedule_daily_prices_cron.sql / 0017_schedule_benchmark_fx_cron.sql
-- - same pg_cron/pg_net mechanism, applied to the new weekly function.
--
-- Timing: 23:10 UTC Sundays - well after Friday's real market close
-- (the source of Alpha Vantage's latest weekly bar) has long settled,
-- and a few minutes after fetch-fx-rates-nightly/fetch-risk-free-rate-
-- nightly's own weekday slots so cron jobs never compete for the same
-- pg_net worker. Sunday specifically (not "run daily, only write on
-- Sunday") because fetch-benchmark-history-weekly's own `date` column
-- is simply its invocation date - scheduling it for Sunday IS what
-- makes that date always the correct checkpoint, with no "which Sunday"
-- logic needed inside the function itself.
--
-- pg_cron/pg_net are already enabled (0004) - no extension setup here.
--
-- BEFORE RUNNING: replace <ANON_KEY> below with the real publishable
-- key (same one already public in js/supabaseConfig.js - it identifies
-- the project, not a secret), same placeholder discipline as 0010/0017.
--
-- Safe to re-run - cron.schedule() with the same job name replaces the
-- existing schedule rather than creating a duplicate.

select cron.schedule(
  'fetch-benchmark-history-weekly',
  '10 23 * * 0',
  $$
  select net.http_post(
    url := 'https://mdsjlaniascmrktxvezh.supabase.co/functions/v1/fetch-benchmark-history-weekly',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_3fKyaMC4Hn6x8RYBR5jJ2g_gNEwnLfG',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Confirm the job registered correctly (schedule '10 23 * * 0', active = true).
select jobid, jobname, schedule, active from cron.job
where jobname = 'fetch-benchmark-history-weekly';
