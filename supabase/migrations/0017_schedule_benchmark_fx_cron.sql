-- Portfolio.io — schedules fetch-benchmark-history and fetch-fx-rates
-- to run automatically every weekday evening, so benchmark_history/
-- fx_rates keep accumulating daily observations going forward. Modeled
-- directly on 0010_schedule_daily_prices_cron.sql - same pg_cron/pg_net
-- mechanism, same reasoning, applied to the two new Edge Functions.
--
-- Timing: 23:00 UTC, Mon-Fri. SPY/QQQ trade on NYSE/Nasdaq, closing
-- 16:00 ET - that's 21:00 UTC in winter (EST, UTC-5) or 20:00 UTC in
-- summer (EDT, UTC-4). 23:00 UTC gives a 2-3 hour buffer after close
-- either way, comfortably after Alpha Vantage would have the day's real
-- close. Run an hour after 0010's own 19:00 UTC XETRA job so the two
-- schedules never compete for the same pg_net worker slot.
--
-- pg_cron/pg_net are already enabled (0004) - no extension setup
-- needed here.
--
-- BEFORE RUNNING: replace <ANON_KEY> below with the real publishable
-- key (same one already public in js/supabaseConfig.js - it identifies
-- the project, not a secret), same placeholder discipline as 0010.
--
-- Safe to re-run - cron.schedule() with the same job name replaces the
-- existing schedule rather than creating a duplicate.

select cron.schedule(
  'fetch-benchmark-history-nightly',
  '0 23 * * 1-5',
  $$
  select net.http_post(
    url := 'https://mdsjlaniascmrktxvezh.supabase.co/functions/v1/fetch-benchmark-history',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_3fKyaMC4Hn6x8RYBR5jJ2g_gNEwnLfG',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'fetch-fx-rates-nightly',
  '5 23 * * 1-5',
  $$
  select net.http_post(
    url := 'https://mdsjlaniascmrktxvezh.supabase.co/functions/v1/fetch-fx-rates',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_3fKyaMC4Hn6x8RYBR5jJ2g_gNEwnLfG',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Confirm both jobs registered correctly (should return two rows,
-- schedules '0 23 * * 1-5' and '5 23 * * 1-5', active = true).
select jobid, jobname, schedule, active from cron.job
where jobname in ('fetch-benchmark-history-nightly', 'fetch-fx-rates-nightly');
