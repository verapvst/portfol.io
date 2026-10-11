-- Portfol.io - schedule fetch-inflation. CPI is published monthly, so a
-- weekly run (Mondays, after the nightly collectors) is plenty and costs one
-- Alpha Vantage call a week. Same pg_cron/pg_net mechanism as 0022. Safe to
-- re-run (cron.schedule with the same job name replaces it).
--
-- fetch-risk-free-rate (already scheduled by 0022) now fetches the whole
-- Treasury curve (3m/2y/5y/10y/30y) with no change to its schedule.

select cron.schedule(
  'fetch-inflation-weekly',
  '20 23 * * 1',
  $$
  select net.http_post(
    url := 'https://mdsjlaniascmrktxvezh.supabase.co/functions/v1/fetch-inflation',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_3fKyaMC4Hn6x8RYBR5jJ2g_gNEwnLfG',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

select jobid, jobname, schedule, active from cron.job where jobname = 'fetch-inflation-weekly';
