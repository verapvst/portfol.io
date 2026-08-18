-- Portfolio.io — fix a real bug: `benchmarks` was created in 0016
-- without ever enabling row level security or adding a read policy
-- (unlike benchmark_history/fx_rates/benchmark_fetch_log, which all got
-- one). A table with RLS never enabled isn't exposed through Supabase's
-- REST API at all - confirmed live: an anon-key request to
-- /rest/v1/benchmarks?select=* returned an empty array despite 2 real
-- rows existing (verified directly in the SQL Editor). This is
-- authentication-agnostic - it would have returned empty for signed-in
-- requests too, silently breaking db.js:loadBenchmarks() and therefore
-- every benchmark toggle in the app, even though benchmark_history
-- itself was readable the whole time. Caught during this session's own
-- independent verification pass, not by a user report.

alter table benchmarks enable row level security;
create policy "authenticated read" on benchmarks for select using (auth.role() = 'authenticated');
create policy "anon read" on benchmarks for select to anon using (true);

-- No write policy for anon/authenticated, by design - same as every
-- other table in this feature (0016/0018), only service_role or a
-- direct SQL migration writes here.

-- Confirm: should return 2 rows (same as the SQL Editor's own
-- unrestricted view) - if this still comes back empty, something else
-- is wrong and needs investigating before trusting the fix.
select id, symbol, name from benchmarks order by id;
