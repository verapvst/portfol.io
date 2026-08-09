-- Portfolio.io — schedules fetch-daily-prices to run automatically,
-- every weekday evening, so daily_prices actually accumulates real
-- history going forward instead of staying at the single row this
-- session's manual test call just wrote.
--
-- Timing: 19:00 UTC, Mon-Fri. XETRA (where all 4 currently-mapped ETFs
-- trade) closes 17:30 local - that's 16:30 UTC in winter (CET, UTC+1)
-- or 15:30 UTC in summer (CEST, UTC+2). 19:00 UTC gives a 2.5-3.5 hour
-- buffer after close either way, comfortably after EODHD would have
-- the day's real close - not run at market open, which would just
-- refetch yesterday's stale close.
--
-- pg_net (enabled in 0004) does the actual HTTP call from inside
-- Postgres; pg_cron (also enabled in 0004) is what runs it on schedule.
--
-- BEFORE RUNNING: replace <ANON_KEY> below with the real publishable
-- key (same one already public in js/supabaseConfig.js - it identifies
-- the project, not a secret). Left as a placeholder here deliberately,
-- so a real bearer token never sits committed in this migration file.
--
-- Safe to re-run - cron.schedule() with the same job name replaces the
-- existing schedule rather than creating a duplicate.

select cron.schedule(
  'fetch-daily-prices-nightly',
  '0 19 * * 1-5',
  $$
  select net.http_post(
    url := 'https://mdsjlaniascmrktxvezh.supabase.co/functions/v1/fetch-daily-prices',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <ANON_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Confirm the job registered correctly (should return one row named
-- fetch-daily-prices-nightly, schedule '0 19 * * 1-5', active = true).
select jobid, jobname, schedule, active from cron.job where jobname = 'fetch-daily-prices-nightly';
