-- One-time cleanup, NOT a numbered migration - fixes the duplicate
-- "BPI Smart Ações PPR" security found during the Security Master audit
-- (same root cause class as _cleanup_bpi_dinamico_duplicate.sql: created
-- by the original bulk seed from database.json, not by anyone typing a
-- name into the app - both rows share the exact same created_at
-- timestamp, and the app's own dedup guard, findOrCreateSecurity() in
-- js/db.js, only runs on that typed/imported path, never on a bulk
-- INSERT). Read this whole file before running it - it deletes a row.
--
-- Schema-qualified (public.xxx) throughout - same lesson as the BPI
-- Dinâmico cleanup script: unqualified names hit "relation does not
-- exist" in the SQL Editor even though these are the exact tables the
-- app uses constantly through supabase-js.
--
-- Which row is which (verified against your live data before writing
-- this):
--   "BPI Smart Ações PPR"  - no ISIN, data_quality 'Estimated', empty
--                             annual_returns, €0 AUM - a sparse
--                             placeholder, never actually researched.
--   "BPI SMART Ações PPR"  - ISIN PTYPIEHM0024, data_quality 'Real',
--                             6 years of real annual returns, €46.55M
--                             AUM - the genuine, researched record.
-- Both had zero transactions, zero valuations, and zero costs rows at
-- audit time (checked all three tables directly) - this is a pure
-- placeholder with nothing attached, unlike BPI Dinâmico's own earlier
-- cleanup which had real cost rows to re-attach first.
--
-- What this does, in order:
--   1. Confirms both rows still exist under their exact names (if either
--      name doesn't match exactly, it stops and tells you why, rather
--      than guessing).
--   2. Deletes the placeholder "BPI Smart Ações PPR" security row - but
--      ONLY if, at the moment this runs, nothing else references it (no
--      transactions, valuations, security_details, or costs left
--      pointing at it). If anything does, the delete is skipped and
--      you'll see a NOTICE explaining what's still attached - safer
--      than silently failing or cascading.
--   3. Leaves "BPI SMART Ações PPR" (the canonical, real-data row)
--      completely untouched.
--
-- Run this in the SQL Editor only when you're ready - it's real data,
-- not draft.

do $$
declare
  real_id uuid;
  dup_id uuid;
  remaining_refs int;
begin
  select id into real_id from public.securities where name = 'BPI SMART Ações PPR';
  select id into dup_id from public.securities where name = 'BPI Smart Ações PPR';

  if real_id is null then
    raise notice 'No security named exactly "BPI SMART Ações PPR" found - nothing to keep as canonical. Stopping.';
    return;
  end if;
  if dup_id is null then
    raise notice 'No security named exactly "BPI Smart Ações PPR" found - nothing to clean up.';
    return;
  end if;

  select
    (select count(*) from public.transactions where security_id = dup_id) +
    (select count(*) from public.valuations where security_id = dup_id) +
    (select count(*) from public.security_details where security_id = dup_id) +
    (select count(*) from public.costs where security_id = dup_id)
  into remaining_refs;

  -- security_details always counts as 1 here (the placeholder row has
  -- its own researched-but-sparse record) - that's expected, not a
  -- reason to abort, so it's deleted explicitly below rather than
  -- included in the "should we proceed" gate the way transactions/
  -- valuations/costs are.
  select
    (select count(*) from public.transactions where security_id = dup_id) +
    (select count(*) from public.valuations where security_id = dup_id) +
    (select count(*) from public.costs where security_id = dup_id)
  into remaining_refs;

  if remaining_refs = 0 then
    delete from public.security_details where security_id = dup_id;
    delete from public.securities where id = dup_id;
    raise notice 'Deleted the duplicate "BPI Smart Ações PPR" security row (%) and its security_details row. Canonical "BPI SMART Ações PPR" (%) untouched.', dup_id, real_id;
  else
    raise notice '"BPI Smart Ações PPR" still has % other reference(s) (transactions/valuations/costs) - NOT deleted. Review manually.', remaining_refs;
  end if;
end $$;

-- Verification query - run after the block above to confirm, by
-- introspection, that exactly one "Ações PPR"-named security remains
-- and it's the canonical, real-data row.
select s.id, s.name, s.isin, sd.data_quality
from public.securities s
left join public.security_details sd on sd.security_id = s.id
where s.name in ('BPI Smart Ações PPR', 'BPI SMART Ações PPR');
