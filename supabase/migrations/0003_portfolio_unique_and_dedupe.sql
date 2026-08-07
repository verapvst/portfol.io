-- Portfolio.io — fix a real race condition in ensurePortfolio() (js/db.js):
-- visiting several pages in quick succession while signed in could run the
-- "does a portfolio exist?" check on more than one page before the first
-- page's insert had committed, so more than one page concluded "no" and
-- each created its own row. Confirmed in production data: three
-- "My Portfolio" rows for the same user_id, all created within ~40ms of
-- each other.
--
-- This migration (1) keeps the earliest portfolio per user and deletes the
-- rest, then (2) adds a unique constraint so it can never happen again -
-- a second concurrent insert now fails with a 23505 (unique_violation)
-- instead of silently succeeding, which js/db.js's ensurePortfolio() (see
-- the same-day code fix) catches and turns into "re-read the existing row"
-- instead of a duplicate.
--
-- How to run: paste into the Supabase SQL Editor and run once, same as
-- 0001/0002. Safe even if you never hit the race - the delete matches 0
-- rows for a user with only one portfolio, and the constraint is a no-op
-- validation that already holds.

delete from portfolios a
using portfolios b
where a.user_id = b.user_id
  and a.created_at > b.created_at;

alter table portfolios add constraint portfolios_user_id_key unique (user_id);
