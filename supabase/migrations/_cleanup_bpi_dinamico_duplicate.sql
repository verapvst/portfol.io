-- One-time cleanup, NOT a numbered migration - fixes the duplicate
-- "BPI DINAMICO" security created by today's Data Hub import (root
-- cause fixed in js/data-hub.js/js/db.js - see normalizeName() in
-- js/utils.js). Read this whole file before running it - it deletes a
-- row.
--
-- Every table below is schema-qualified (public.xxx) - a previous
-- version without the prefix hit "relation does not exist" in the SQL
-- Editor even though these are the exact tables the app uses constantly
-- through supabase-js. Qualifying removes any ambiguity about which
-- schema/search_path the editor session resolves against.
--
-- What this does, in order:
--   1. Moves the 4 cost rows currently attached to "BPI DINAMICO" onto
--      the real "BPI Dinâmico" security instead (they're the same
--      values you'd already reconciled from the workbook - 0.835/0.09/
--      0/0 - so this is a re-attachment, not new information).
--   2. Deletes the duplicate "BPI DINAMICO" security row - but ONLY if,
--      at the moment this runs, nothing else references it (no
--      transactions, valuations, security_details, or costs left
--      pointing at it). If anything else does, the delete is skipped
--      and you'll see a NOTICE explaining what's still attached -
--      safer than silently failing or cascading.
--
-- Run this in the SQL Editor only when you're ready - it's real data,
-- not draft.

do $$
declare
  real_id uuid;
  dup_id uuid;
  remaining_refs int;
begin
  select id into real_id from public.securities where name = 'BPI Dinâmico';
  select id into dup_id from public.securities where name = 'BPI DINAMICO';

  if real_id is null then
    raise notice 'No security named exactly "BPI Dinâmico" found - nothing to reconcile onto. Stopping.';
    return;
  end if;
  if dup_id is null then
    raise notice 'No security named exactly "BPI DINAMICO" found - nothing to clean up.';
    return;
  end if;

  update public.costs set security_id = real_id where security_id = dup_id;
  raise notice 'Moved cost rows from BPI DINAMICO (%) to BPI Dinâmico (%).', dup_id, real_id;

  select
    (select count(*) from public.transactions where security_id = dup_id) +
    (select count(*) from public.valuations where security_id = dup_id) +
    (select count(*) from public.security_details where security_id = dup_id) +
    (select count(*) from public.costs where security_id = dup_id)
  into remaining_refs;

  if remaining_refs = 0 then
    delete from public.securities where id = dup_id;
    raise notice 'Deleted the duplicate BPI DINAMICO security row.';
  else
    raise notice 'BPI DINAMICO still has % other reference(s) (transactions/valuations/security_details/costs) - NOT deleted. Review manually.', remaining_refs;
  end if;
end $$;
