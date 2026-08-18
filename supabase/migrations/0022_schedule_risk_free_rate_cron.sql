-- Portfolio.io — schedules fetch-risk-free-rate to run automatically
-- every weekday evening, same pg_cron/pg_net mechanism as 0017's
-- benchmark/FX crons. Treasury yield data updates daily on trading
-- days, same cadence reasoning as the other two.
--
-- Timing: 23:10 UTC, 5 minutes after fetch-fx-rates-nightly (23:05) and
-- 10 after fetch-benchmark-history-nightly (23:00) - same "stagger so
-- they never compete for the same pg_net worker slot" reasoning as
-- 0017's own header comment.
--
-- pg_cron/pg_net are already enabled (0004) - no extension setup
-- needed here.
--
-- Safe to re-run - cron.schedule() with the same job name replaces the
-- existing schedule rather than creating a duplicate.

select cron.schedule(
  'fetch-risk-free-rate-nightly',
  '10 23 * * 1-5',
  $$
  select net.http_post(
    url := 'https://mdsjlaniascmrktxvezh.supabase.co/functions/v1/fetch-risk-free-rate',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_3fKyaMC4Hn6x8RYBR5jJ2g_gNEwnLfG',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Confirm the job registered correctly (should return one row, schedule
-- '10 23 * * 1-5', active = true).
select jobid, jobname, schedule, active from cron.job where jobname = 'fetch-risk-free-rate-nightly';
