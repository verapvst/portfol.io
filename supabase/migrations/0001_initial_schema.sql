-- Portfolio.io — Initial Schema
-- Step 2 of the implementation plan: Users (auth.users, built into Supabase —
-- nothing to create), Portfolios, Institutions, Accounts, Securities,
-- Transactions, Valuations, Documents.
--
-- Source of truth for what each table/column means:
-- ../../02_Portfolio.io - Migration Plan.md (section 2, per-module breakdown)
--
-- How to run this: paste the whole file into the Supabase project's
-- SQL Editor (Dashboard -> SQL Editor -> New query) and run it once,
-- right after the project is created. Safe to re-run only after a
-- `drop table` — there's no IF NOT EXISTS guard, on purpose, so a
-- partial second run fails loudly instead of silently skipping.

create extension if not exists "pgcrypto";

-- =========================================================================
-- REFERENCE DATA
-- =========================================================================

create table portfolios (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  base_currency   text not null default 'EUR',
  inception_date  date,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Normalizes Accounts.Institution / Assets.Provider (both free text in the
-- workbook) into one shared lookup, per the Migration Plan §2.1/§2.2.
create table institutions (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  logo_url  text,
  country   text
);

create table accounts (
  id              uuid primary key default gen_random_uuid(),
  portfolio_id    uuid not null references portfolios(id) on delete cascade,
  institution_id  uuid references institutions(id),
  name            text not null,
  jurisdiction    text,
  currency        text not null,
  account_type    text not null,
  opened_date     date,
  status          text not null default 'active' check (status in ('active', 'closed')),
  source          text,
  import_method   text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Assets sheet, renamed per the Migration Plan §2.2. `region` here is the
-- security's own stated mandate/regulatory region — deliberately NOT the
-- same field as Detailed Portfolio's look-through Exposure Region, which
-- gets its own table later (Migration Plan §2.6, not part of this pass).
create table securities (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  type                text not null,
  isin                text,
  ticker              text,
  asset_class         text,
  category            text,
  region              text,
  domicile            text,
  currency            text,
  ucits               boolean,
  replication_method  text,
  distribution_type   text,
  provider_id         uuid references institutions(id),
  benchmark           text,
  sub_portfolio       text,
  source              text,
  import_method       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- =========================================================================
-- EVENTS (append-only in spirit — see policy notes below)
-- =========================================================================

create table transactions (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references portfolios(id) on delete cascade,
  account_id     uuid not null references accounts(id),
  security_id    uuid not null references securities(id),
  type           text not null check (type in ('buy', 'sell', 'dividend', 'split', 'fee', 'deposit', 'withdrawal')),
  date           date not null,
  units          numeric,
  amount         numeric,
  fees           numeric not null default 0,
  tax            numeric not null default 0,
  fx_cost        numeric not null default 0,
  currency       text not null,
  source         text,
  import_method  text,
  import_job_id  uuid,
  voided         boolean not null default false,
  corrected_by   uuid references transactions(id),
  notes          text,
  created_at     timestamptz not null default now()
);

-- Portfolio Values sheet, renamed per the Migration Plan §2.5. Insert-only
-- by design (see policies) — a wrong figure gets superseded by a new dated
-- row, never edited in place.
create table valuations (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references portfolios(id) on delete cascade,
  security_id    uuid not null references securities(id),
  date           date not null,
  value_eur      numeric not null,
  units          numeric,
  source         text,
  import_date    date,
  report_date    date,
  import_method  text,
  import_version text,
  import_job_id  uuid,
  notes          text,
  created_at     timestamptz not null default now()
);

-- =========================================================================
-- DOCUMENTS (no workbook equivalent — Migration Plan §2.10)
-- =========================================================================

create table documents (
  id                     uuid primary key default gen_random_uuid(),
  portfolio_id           uuid not null references portfolios(id) on delete cascade,
  file_path              text not null,
  file_name              text not null,
  file_type              text not null,
  document_type          text,
  uploaded_at            timestamptz not null default now(),
  uploaded_by            uuid references auth.users(id),
  related_import_job_id  uuid,
  status                 text not null default 'pending' check (status in ('pending', 'processed', 'archived'))
);

-- =========================================================================
-- ROW LEVEL SECURITY
--
-- Deliberate simplification for this first pass: every table here collapses
-- Private + Admin into one "authenticated owner" tier — if you're logged in
-- and it's your portfolio, you can read AND write. The Platform Architecture
-- doc's Admin-mode elevation (a separate session claim gating writes) and
-- the Public tier (anon access to sanitized views only) are both real,
-- both designed, and both deliberately deferred to Migration Plan Phase 5 —
-- not needed to get the first page working, not forgotten.
-- =========================================================================

alter table portfolios   enable row level security;
alter table institutions enable row level security;
alter table accounts     enable row level security;
alter table securities   enable row level security;
alter table transactions enable row level security;
alter table valuations   enable row level security;
alter table documents    enable row level security;

create policy "owner full access" on portfolios for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Institutions/Securities are shared reference data, not portfolio-scoped —
-- any authenticated user may read or write them (there is only one real
-- user today; this widens naturally once portfolio_id scoping is needed).
create policy "authenticated read"  on institutions for select using (auth.role() = 'authenticated');
create policy "authenticated write" on institutions for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated read"  on securities for select using (auth.role() = 'authenticated');
create policy "authenticated write" on securities for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "owner full access" on accounts for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

create policy "owner full access" on transactions for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

create policy "owner full access" on valuations for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));

create policy "owner full access" on documents for all
  using (portfolio_id in (select id from portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from portfolios where user_id = auth.uid()));
