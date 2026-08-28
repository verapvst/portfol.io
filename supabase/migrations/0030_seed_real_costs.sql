-- Portfolio.io — Seed real, sourced ongoing costs into the `costs` table.
--
-- Context: the Costs page redesign (2026-08-28) needs a real "current
-- weighted portfolio cost rate" - which needs every currently-held
-- security to have a real cost row in THIS table (`costs`), not just in
-- `security_details` (the research-catalogue table product-detail.html
-- reads, which already had these figures - see 0006/0008). The two
-- tables serve different questions and were never meant to be kept in
-- sync automatically: this migration is a one-time copy of already-
-- verified real numbers from one into the other, not a new source.
--
-- Every value below is already present in security_details (0006/0008 -
-- "Portfol.io legacy database (Excel-derived)" for BPI Universal and
-- the 4 ETFs, BPI Dinâmico's own real Ficha Mensal dated 2026-06-30 for
-- BPI Dinâmico specifically). The 4 ETFs were ALSO independently
-- confirmed live on 2026-08-28 against each fund's own current provider
-- page (UBS/DWS/Avantis/SSGA) and justETF - see each INSERT's own
-- comment. BPI Universal's figure is single-sourced (no equivalent
-- public factsheet search was run for it) - flagged as such in its own
-- INSERT below, not presented at the same confidence as the double-
-- verified ETF figures.
--
-- ---------------------------------------------------------------------
-- nav_embedded (new column) - THE central distinction the Costs page
-- redesign is built around: a fund's own TER/depositary fee is already
-- subtracted from the NAV/valuation this app already reads (never a
-- separate cash outflow), so it must never be summed into "money
-- actually paid" the way a brokerage commission or account fee would
-- be - that would double-count the exact same expense. Existing
-- Management-category, security-scoped rows are backfilled to true
-- (a per-fund management/TER-type fee is, definitionally, embedded in
-- that fund's own NAV) since that's the one case safe to infer
-- automatically; every other existing row is left at the conservative
-- default (false = treat as a real cash cost) rather than guessed.
-- ---------------------------------------------------------------------

alter table costs add column if not exists nav_embedded boolean not null default false;

comment on column costs.nav_embedded is
  'true = already reflected in the security''s own NAV/valuation (a fund TER, management fee, depositary fee) - never add this on top of historical value/performance, it would double-count. false = a real, separate cash cost (brokerage commission, account/custody fee, FX spread) - safe to sum as money actually paid. Set explicitly on insert; never inferred at query time.';

update costs set nav_embedded = true
where cost_category = 'Management' and security_id is not null and nav_embedded = false;

-- ---------------------------------------------------------------------
-- BPI Dinâmico - TER 0.835% + Depositary Fee 0.090%, both real, from
-- its own June 2026 Ficha Mensal (Costs section) - same figures
-- security_details already carries (0008), copied here for the first
-- time (0008's own comment flagged this table had zero rows for BPI
-- Dinâmico as of 2026-08-09 - _check_bpi_costs.sql). Both NAV-embedded:
-- BPI Dinâmico's reported value_eur already nets these out.
-- ---------------------------------------------------------------------

insert into costs (portfolio_id, security_id, date, cost_category, cost_name, frequency, unit, value, source, nav_embedded)
select p.id, s.id, '2026-06-30', 'Management', 'TER', 'Annual', '%', 0.835,
  'BPI Ficha Mensal, Jun 2026 (docs/workbook-architecture.md Costs sheet transcription; security_details.ter_pct, 0008)', true
from portfolios p, securities s
where s.name = 'BPI Dinâmico'
  and not exists (select 1 from costs c where c.security_id = s.id and c.cost_name = 'TER' and c.portfolio_id = p.id);

insert into costs (portfolio_id, security_id, date, cost_category, cost_name, frequency, unit, value, source, nav_embedded)
select p.id, s.id, '2026-06-30', 'Custody', 'Depositary Fee', 'Annual', '%', 0.090,
  'BPI Ficha Mensal, Jun 2026 (docs/workbook-architecture.md Costs sheet transcription; security_details.depositary_fee_pct, 0008)', true
from portfolios p, securities s
where s.name = 'BPI Dinâmico'
  and not exists (select 1 from costs c where c.security_id = s.id and c.cost_name = 'Depositary Fee' and c.portfolio_id = p.id);

-- ---------------------------------------------------------------------
-- BPI Universal (Fundo) - TER 1.81% + Depositary Fee 0.025%, real, from
-- security_details (0006, PROD005 - "Portfol.io legacy database (Excel-
-- derived)"). management_fee_pct (0.975%) is deliberately NOT inserted
-- as a separate row: it's a component OF the 1.81% TER, not additive to
-- it (standard fund cost structure - TER = management fee + other
-- operating expenses) - inserting both would double-count the
-- management fee inside itself, the exact anti-double-counting mistake
-- this whole engine exists to avoid, just one level more subtle than
-- the NAV-embedded case. Matched by ISIN (unambiguous for this
-- security, unlike BPI Dinâmico's own flagged ISIN collision - see
-- 0008's header comment). Both NAV-embedded.
-- ---------------------------------------------------------------------

insert into costs (portfolio_id, security_id, date, cost_category, cost_name, frequency, unit, value, source, nav_embedded)
select p.id, s.id, '2026-08-09', 'Management', 'TER', 'Annual', '%', 1.81,
  'security_details.ter_pct (0006, PROD005 - Portfol.io legacy database, Excel-derived) - not yet independently web-cross-checked (unlike the 4 ETFs below), single-sourced', true
from portfolios p, securities s
where s.isin = 'PTYPILLM0003'
  and not exists (select 1 from costs c where c.security_id = s.id and c.cost_name = 'TER' and c.portfolio_id = p.id);

insert into costs (portfolio_id, security_id, date, cost_category, cost_name, frequency, unit, value, source, nav_embedded)
select p.id, s.id, '2026-08-09', 'Custody', 'Depositary Fee', 'Annual', '%', 0.025,
  'security_details.depositary_fee_pct (0006, PROD005 - Portfol.io legacy database, Excel-derived) - not yet independently web-cross-checked, single-sourced', true
from portfolios p, securities s
where s.isin = 'PTYPILLM0003'
  and not exists (select 1 from costs c where c.security_id = s.id and c.cost_name = 'Depositary Fee' and c.portfolio_id = p.id);

-- ---------------------------------------------------------------------
-- The 4 Trading 212 ETFs - real TER, matched by ISIN (stable, unlike a
-- display name that can pick up a "(Acc)" suffix) - each confirmed live
-- 2026-08-28 against its own provider/justETF page, exactly matching
-- the legacy-database figure security_details already carried (0006).
-- All NAV-embedded (an ETF's quoted price already nets its TER out).
-- ---------------------------------------------------------------------

insert into costs (portfolio_id, security_id, date, cost_category, cost_name, frequency, unit, value, source, nav_embedded)
select p.id, s.id, '2026-08-09', 'Management', 'TER', 'Annual', '%', v.ter,
  'UBS/DWS/Avantis/SSGA provider page + justETF, confirmed live 2026-08-28; matches security_details.ter_pct (0006, legacy database)', true
from portfolios p, securities s, (values
  ('IE00BD4TXV59', 0.06),  -- UBS Core MSCI World UCITS ETF USD Acc (UETW)
  ('IE0003R87OG3', 0.39),  -- Avantis Global Small Cap Value UCITS ETF USD Acc (AVWS)
  ('IE00BL25JL35', 0.25),  -- Xtrackers MSCI World Quality UCITS ETF 1C (XDEQ)
  ('IE00B469F816', 0.18)   -- SPDR MSCI Emerging Markets UCITS ETF (SPYM)
) as v(isin, ter)
where s.isin = v.isin
  and not exists (select 1 from costs c where c.security_id = s.id and c.cost_name = 'TER' and c.portfolio_id = p.id);

-- ---------------------------------------------------------------------
-- Trading 212 platform costs - deliberately NOT inserted as a row here.
-- Confirmed live 2026-08-28 (Trading 212's own Help Centre): no
-- commission, no custody fee, no account fee on Invest/ISA - the only
-- fee it can charge is a 0.15% FX conversion fee, applied PER TRADE
-- when the instrument's currency differs from the account's funding
-- currency, not an ongoing annual rate. This schema's frequency enum
-- (One-off/Daily/Monthly/Quarterly/Annual) has no honest fit for
-- "per-transaction, recurring" - forcing it into 'One-off' would read
-- as a single historical event, forcing it into 'Annual' would
-- overstate it as a holding cost. Left out per this app's own "don't
-- force a cost into a category the data doesn't fit" principle -
-- surfaced instead as a qualitative note in the Costs page UI, not a
-- number blended into the weighted cost rate. Revisit if/when actual
-- per-trade FX amounts are recorded as real historical Trading
-- category rows instead (each dated, at the amount actually charged).
-- ---------------------------------------------------------------------
