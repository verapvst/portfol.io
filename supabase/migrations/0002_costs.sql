-- Portfolio.io — Costs table.
-- Wasn't part of the original Phase 1 list (Users/Portfolios/Accounts/
-- Securities/Transactions/Valuations/Documents), added now to unblock
-- the Costs page. Same structure as ../../02_Portfolio.io - Migration
-- Plan.md §2.7 and the workbook's real `Costs` sheet.
--
-- How to run: paste into the Supabase SQL Editor and run once, same as
-- 0001_initial_schema.sql.

create table costs (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references portfolios(id) on delete cascade,
  security_id    uuid references securities(id),
  account_id     uuid references accounts(id),
  date           date not null,
  cost_category  text not null check (cost_category in ('Management', 'Trading', 'Custody', 'Other')),
  cost_name      text not null,
  frequency      text not null check (frequency in ('One-off', 'Daily', 'Monthly', 'Quarterly', 'Annual')),
  unit           text not null check (unit in ('%', 'EUR', 'USD')),
  value          numeric not null,
  source         text,
  report_date    date,
  import_job_id  uuid,
  notes          text,
  created_at     timestamptz not null default now()
);

alter table costs enable row level security;

create policy "owner full access" on costs for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));
