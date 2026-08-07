# Portfolio.io — Complete Migration Plan

**Version 1.1** — the bridge document in the `02_` family: takes every real sheet in the workbook, plus the calculated concepts that were never sheets at all, and assigns each one a final home in Portfolio.io. As of v1.1, this is also the *only* per-module/per-page reference doc — `02_Portfolio.io - Core Modules Specification.md` (an earlier, less-grounded first pass at the same ground) has been merged in and retired; its one genuinely unique contribution, the Data Hub import-pipeline schema, now lives in §2.11 below.

Grounded in the actual current workbook (`02_Portfolio Workbook.xlsx`, read directly, not from memory): 9 sheets, 96 columns total, listed in full below. Nothing in this plan invents a column that doesn't already exist, except where explicitly marked **(new)**.

---

## 1. The Governing Distinction

Every module below is exactly one of two things. This isn't a style preference — it's the same rule already fixed in the Platform Architecture doc (§4.4), applied now to literally everything.

| | **Data** | **Intelligence** |
|---|---|---|
| What it is | Facts someone recorded | Numbers computed from Data |
| Storage | A real table, written through CRUD | A view, or a table written *only* by an automated process — never a hand-edit form |
| Editable? | Yes, by Admin | Never, by anyone, ever |
| If wrong | Fix the record, or add a correcting record | Fix the Data it's computed from — the number follows automatically |
| Examples | Transactions, Valuations, Costs, Accounts | Current Positions, TWR, Allocations, Country Exposure, Risk, Portfolio Health |

One subtlety worth naming explicitly: **Allocations** and **Documentation** each occupy a table in Supabase, yet both are Intelligence, not Data — a table is where something is *stored*, not proof of who's allowed to *write* to it. Allocations is written exclusively by the import pipeline's parser step; a human never opens a form and types an allocation. That's what keeps it Intelligence despite living in an ordinary table.

---

## 2. Data Modules — every sheet in the real workbook today

### 2.1 Accounts
**Sheet today:** `Accounts` — Account ID · Name · Institution · Jurisdiction · Currency · Account Type · Date Opened · Source · Import Method · Notes (10 cols, 3 accounts on record)

**Supabase:** `accounts` (id, portfolio_id, institution_id→`institutions`, name, jurisdiction, currency, account_type, opened_date, status, created_at) + `institutions` (id, name, logo_url, country) as shared reference data, normalizing the free-text `Institution` column.

**CRUD:** Admin create/edit; archive via `status='closed'`, never delete (Transactions/Valuations reference it forever, per the workbook's own "never delete" principle, §12.7).

**Depends on:** nothing. **Depended on by:** Transactions, Valuations, Costs.

**Page:** *Accounts*.

**Future automation:** broker-connection status and last-sync timestamp reserved on this table for Trading212/IBKR API integration.

---

### 2.2 Assets (→ Securities)
**Sheet today:** `Assets` — Asset ID · Name · Type · ISIN · Ticker · Asset Class · Category · Region · Domicile · Currency · UCITS · Replication Method · Distribution Type · Provider · Benchmark · Sub-Portfolio · Source · Import Method (18 cols, 7 assets)

**Supabase:** `securities` (id, name, type, isin, ticker, asset_class, category, region, domicile, currency, ucits, replication_method, distribution_type, provider, benchmark_id→`benchmarks`, sub_portfolio, created_at/updated_at).

**Important, easy-to-miss distinction:** `Assets.Region` here is the security's own stated **mandate/regulatory region** ("this fund's charter says World"). It is a *completely different field* from `Detailed Portfolio.Exposure Region` (§2.5) and the look-through `Exposure Country` — the workbook architecture doc is explicit that these must never be reconciled into one number (§4, Version 1.9 note). This plan keeps them in different tables for exactly that reason: `securities.region` (Data, this table) versus `security_classifications.exposure_region`/`exposure_country` (a separate Reference Data table, §2.3) versus the look-through decomposition (Intelligence, §3.4).

**CRUD:** Admin create/edit. `Type = 'Cash'` rows (Cash EUR/USD/GBP) are created here exactly like any fund, per the workbook's "cash is an asset" principle (§12.6) — no special-case table, no special-case code, ever.

**Depends on:** `institutions` (Provider), `benchmarks` (§2.8). **Depended on by:** Transactions, Valuations, Costs, Detailed Portfolio, Security Classifications.

**Page:** *Holdings* (reference-data tab).

---

### 2.3 Security Classifications
**Sheet today:** `Security Classifications` — Security Name · Exposure Country · Exposure Region · Classification Method · Date Added · Notes (6 cols, 122 rows)

**Supabase:** `security_classifications` (security_name text pk, or fk→securities once every name is matched 1:1, exposure_country, exposure_region, classification_method enum(exact/pattern/issuer/government/manual/unknown), date_added, notes).

**CRUD:** the dictionary the classifier checks first (§4 of the workbook doc). Admin can add/correct rows directly, but the *normal* path is the classifier proposing a row and Admin approving it in the Data Hub review queue — this table is the persistent memory that means no security is ever classified twice.

**Depends on:** nothing. **Depended on by:** Detailed Portfolio import, every Country/Region Intelligence module.

**Page:** *Holdings* (classification tab) + the review queue lives in *Data Hub*.

---

### 2.4 Transactions
**Sheet today:** `Transactions` — Transaction ID · Date · Account ID · Asset ID · Type · Units · Amount · Fees · Tax · FX Cost · Currency · Source · Import Method · Notes (14 cols, 6 rows)

**Supabase:** `transactions` (id, account_id, security_id, type enum(buy/sell/dividend/split/fee/deposit/withdrawal), date, units, amount, fees, tax, fx_cost, currency, source, import_job_id→null, voided bool default false, corrected_by→transactions null, notes, created_at).

**CRUD:** Admin creates freely. "Edit" = void original + insert replacement (the `TransactionVoided` compensating-event pattern from the Platform Architecture doc, §5.1) — the row is never actually rewritten in place, only ever superseded, matching the workbook's own "historical data is never overwritten" rule (§12.2).

**Depends on:** Accounts, Securities. **Depended on by:** Current Positions, Performance (TWR + XIRR), Costs (per-transaction Fees/Tax/FX Cost already live here, not a separate frequency-bearing record — see the workbook doc's own note on why transaction costs don't need a `Frequency` column, §4).

**Page:** *Transactions*.

---

### 2.5 Portfolio Values (→ Valuations)
**Sheet today:** `Portfolio Values` — Date · Asset ID · Value (EUR) · Units · Source · Import Date · Report Date · Import Method · Import Version · Notes (10 cols, 118 rows — the largest sheet by far, "arguably the most important table in the workbook")

**Supabase:** `valuations` (id, security_id, date, value_eur, units, source, import_date, report_date, import_method, import_version, import_job_id→null, notes, created_at). No `account_id` — the workbook doc documents this exact simplification and its known limitation (§6): every asset lives in one account today, so `security_id` alone disambiguates; the column comes back if that ever stops being true.

**CRUD:** insert-only. A valuation is an observation, never edited — a correction is a new dated row for the same security, exactly as documented in §5 ("no current state stored anywhere").

**Depends on:** Securities. **Depended on by:** Current Positions, TWR, XIRR (terminal value), every performance chart.

**Page:** *Valuations* — this is the module your own quick-entry example ("today's value €12,584, Trading212, today, Save") maps to directly.

---

### 2.6 Detailed Portfolio
**Sheet today:** `Detailed Portfolio` — Asset ID · Report Date · Category Path · Security Name · Currency · Quantity/Nominal · Price · Price Type · Market Value · Weight % · Source · Import Method · Import Version · Exposure Country · Exposure Region (15 cols, 123 rows)

This is genuinely different in kind from Transactions/Valuations: it's not one event, it's a **full monthly composition snapshot** — every underlying holding inside a fund-of-funds, at one report date. Classified Imported Data in the workbook doc (§4), not Events.

**Supabase:** `detailed_portfolio_holdings` (id, security_id [the *parent* fund, e.g. BPI Dinâmico], report_date, category_path, holding_name, currency, quantity, price, price_type, market_value, weight_pct, exposure_country, exposure_region, source, import_job_id, created_at).

**CRUD:** Admin never types these rows by hand at any real volume — this table is populated almost exclusively through the Data Hub import pipeline (PDF parse → classify → review → commit). Manual entry stays technically possible (for a one-off correction) but isn't the intended path, so it's still Data, not Intelligence — a human *could* CRUD it, even though in practice the parser always does.

**Depends on:** Securities (parent fund), Security Classifications (the exposure columns). **Depended on by:** Allocations (§3.3), the entire Country/Region/Sector Exposure Intelligence layer (§3.4).

**Page:** raw rows live in *Data Hub* (as staged/committed import output); a read-only drill-down surfaces from *Holdings* when you open a fund-of-funds position.

---

### 2.7 Costs
**Sheet today:** `Costs` — Asset ID · Account ID · Date · Cost Category · Cost Name · Frequency · Unit · Value · Source · Report Date · Import Method · Import Version · Notes (13 cols, 5 rows)

**Supabase:** `costs` (id, security_id, account_id, date, cost_category, cost_name, frequency enum(one-off/daily/monthly/quarterly/annual), unit enum(%/EUR/USD/...), value, source, report_date, import_job_id, notes, created_at).

**CRUD:** standard Admin CRUD, append-a-new-dated-row-on-change rather than overwrite — the closest of all nine sheets to a direct 1:1 table translation.

**Depends on:** Securities, Accounts. **Depended on by:** expense-ratio/cost-drag Intelligence, Portfolio Health.

**Page:** *Costs*.

---

### 2.8 Benchmarks / Benchmark History **(new — flagged, not yet built)**
**Sheet today:** none — `Assets.Benchmark` is only a name today. The workbook doc explicitly reserves this shape for later (§15): *"Future analytics — Alpha, Beta, Tracking Error, Information Ratio — will need the benchmark's own historical values, not just its name."*

**Supabase:** `benchmarks` (id, name, provider, description) as reference data, + `benchmark_history` (id, benchmark_id, date, value, return_pct) as a dated-observation table, structurally identical to Valuations.

**CRUD:** Admin adds benchmarks; `benchmark_history` is populated by a future importer or manual entry, same insert-only discipline as Valuations.

**Depends on:** nothing. **Depended on by:** Risk Intelligence (Alpha/Beta/Tracking Error — none of which can be computed at all until this exists).

**Page:** a tab inside *Holdings*, since a benchmark is metadata attached to a security, not a first-class nav item on its own.

**Status:** genuinely not needed for Phase 1–4 below — Assets.benchmark (a name) is enough until Risk/Alpha/Beta work actually starts.

---

### 2.9 Assumptions
**Sheet today:** `Assumptions` — Category · Assumption · Value · Notes (4 cols, 7 rows)

**Supabase:** `assumptions` (id, category, assumption, value, notes, updated_at). Small, flat, Configuration — not an Event, not append-only; this is the one table in the entire schema that's legitimately just overwritten in place when a number changes, because it's explicitly a model parameter, not a fact about what happened.

**CRUD:** Admin edits directly.

**Depends on:** nothing. **Depended on by:** Risk (risk-free rate), any forecasting/Monte-Carlo work (§15 of the workbook doc).

**Page:** a tab inside *Portfolio Details* (Configuration), not its own nav item — too small to deserve one.

---

### 2.10 Documents **(new — no workbook equivalent)**
Doesn't exist in the workbook at all; it's the piece that becomes necessary the moment uploaded PDFs need to be *kept*, not just parsed and discarded. `documents` table, Supabase Storage-backed, parent of one `import_jobs` row per parse attempt.

**Page:** *Documents*.

---

### 2.11 Data Hub / Import Pipeline **(new — merged in from the retired Core Modules Specification, 2026-08-07)**
The schema behind Data Hub once it's staging real records instead of writing straight to `costs`/`valuations` the way today's "Load to Database" does for Ficha Mensal fees. Three tables:

- **`import_sources`** (reference data) — `id`, `name` ("BPI PDF Parser", "Manual Entry", "Trading212 API"), `type` (document/api/manual).
- **`import_jobs`** — `id`, `portfolio_id`, `import_source_id`, `document_id` (null for API/manual sources), `status` (pending/staged/reviewed/committed/failed), `started_at`/`completed_at`, `actor`.
- **`staged_import_records`** — `id`, `import_job_id`, `entity_type` (transaction/valuation/cost/detailed_portfolio_holding), `payload` jsonb, `classification_confidence`, `duplicate_flag`, `conflict_flag`, `resolution_status` (pending/approved/rejected/edited).

**Flow:** Documents → Import Jobs → Staged Records → (on commit) real rows in Transactions/Valuations/Costs/`detailed_portfolio_holdings`, each carrying `import_job_id` — that FK *is* the Source/Import Date/Import Method provenance columns from the Excel schema, now relational instead of textual. Broker API integrations plug into the identical staging → review → commit path (an `import_jobs` row with `import_source = 'trading212_api'` and no `document_id`) — no separate code path ever gets built for a "trusted" source.

**Page:** *Data Hub*.

**Status today:** partially superseded by what's actually built — Costs already commits directly (§2.7's real "Load to Database" flow, no staging table involved) because a single fee figure per report doesn't need a review queue. This staging model is for when Detailed Portfolio holdings (many rows per report, real classification uncertainty) get their own Supabase table and a real commit path, not a placeholder.

---

## 3. Intelligence Modules — everything that was never a sheet

None of these get a table a human writes to. Each row below states exactly what Data it's computed from, so "this number looks wrong" always has one correct next step: go check the Data, never edit the number.

### 3.1 Current Positions (Holdings)
Computed from Transactions (units held) + Valuations (latest value/price) + Securities (identity). A view, per §0.1 of the prior modules doc — restated here because it's the anchor example for this entire section. **Page:** *Holdings*.

### 3.2 Performance — TWR, XIRR, Unrealised Gain
Three genuinely different numbers, none collapsible into another (workbook doc §4, "Design note" under Portfolio Values — this is the most-litigated principle in the whole project and stays exactly as fixed there):
- **TWR** — chain-linked from Valuations, cash-flow-neutral.
- **XIRR** — Newton-Raphson solver over Transactions' dated cash flows + current value as terminal payout.
- **Unrealised Gain** — simple `gain ÷ invested`, kept, but only ever shown honestly labelled, never as "the" return.

**Page:** *Overview* (the existing dashboard).

### 3.3 Allocations
Sheet today: `Allocations` — Allocation ID · Date · Asset ID · Dimension · Category · Weight % (10 cols, 13 rows) — already documented in the workbook doc as Derived Data (§4), generated exclusively by a parser reading Detailed Portfolio, never hand-populated. In Supabase this becomes a table (`allocations`: id, security_id, date, dimension, category, weight_pct) written *only* by the import pipeline's commit step — the table/view distinction doesn't matter here, the write-access rule is what makes it Intelligence (§1 above). **Depends on:** Detailed Portfolio. **Page:** *Overview* (Allocation card) + read-only drill-down from *Holdings*.

### 3.4 Country / Region / Sector / Currency Exposure
Computed from Allocations + Security Classifications, plus the look-through decomposition logic already built and running today in `repository.js`/`geoClassifier.js` (real MSCI/fund-factsheet data, not inference — workbook doc §4, Version 1.9). Country and Region are deliberately different, non-reconciled answers (mandate vs. real underlying weight) — that distinction carries into Supabase unchanged: two separate queries, never merged into one. **Page:** *Overview* (Exposure card).

### 3.5 Risk
Not a sheet today, and mostly not buildable yet — volatility and drawdown only need Valuations' return series, but Sharpe Ratio needs Assumptions' risk-free rate, and Alpha/Beta/Tracking Error need Benchmark History (§2.8), which doesn't exist yet. **Depends on:** Valuations, Assumptions, (future) Benchmark History. **Page:** *Overview*, once the dependency chain is real.

### 3.6 Diversification / Portfolio Health
Computed from Allocations (concentration), Costs (fee drag), Current Positions (position count/sizing). Objective structural facts, per the existing card's own subtitle. **Page:** *Overview*.

---

## 4. Documentation — the system, not a page

You asked for every metric to explain itself: Definition, Formula, Data Sources, Workbook equivalent, Academic reference. This already exists in embryonic form — `shell.js`'s `METRIC_DOCS` object, wired to every card's info popover today. The migration isn't building this from nothing; it's moving it from a JS object (edit code, redeploy) to real data (edit a row, no deploy).

**Supabase:** `metric_definitions` (metric_key text pk, name, definition, formula, data_sources text[], workbook_equivalent, academic_reference, category enum(data/intelligence)). One row per KPI — TWR, XIRR, Sharpe, Country Allocation, etc.

**How it's used:** every card's info-popover trigger (`data-info="..."` attributes already exist on every card in `index.html` today) resolves to a `metric_key` and renders straight from this table. Because the table carries `category`, a Data-module popover ("Transactions: what this records, where it's editable") and an Intelligence-module popover ("Sharpe Ratio: formula, inputs, academic reference") render from the exact same component — the self-documentation isn't a KPI-only feature bolted on top, it's the same mechanism the whole platform uses to explain itself, extended to cover Data modules too (what a Transaction *is*, why Fees/Tax/FX Cost are separate columns) as much as Intelligence ones.

**CRUD:** Admin-editable, but this is documentation content, not portfolio data — realistically a one-time seed (transcribing the existing `METRIC_DOCS` content plus the gaps this plan surfaces) rather than a page anyone visits often.

**Depends on:** nothing structurally — but *conceptually* depends on everything else in this document, since it's the layer that explains all of it.

---

## 5. Complete Page Ownership Map

| Page | Data modules (CRUD) | Intelligence surfaced here |
|---|---|---|
| **Overview** *(exists)* | — | Performance, Allocations, Exposure, Risk, Diversification/Health |
| **Portfolio Details** | Portfolio config, Assumptions (tab) | — |
| **Accounts** | Accounts, Institutions | — |
| **Holdings** | Securities, Security Classifications, Benchmarks (tab) | Current Positions |
| **Transactions** | Transactions | — |
| **Valuations** | Portfolio Values | — |
| **Costs** | Costs | — |
| **Documents** | Documents | — |
| **Data Hub** *(exists)* | Detailed Portfolio (staged/committed), Security Classifications (review queue) | Allocations (generation, read-only) |

Eight editable pages plus the existing Overview and Data Hub — unchanged from the count in the prior modules doc, now with every one of the 96 real workbook columns and every non-sheet Intelligence concept explicitly assigned a home. Nothing from the workbook, and nothing from your list at the top of this request, is unaccounted for.

---

## 6. Build Order (supersedes §9 of the prior modules doc)

Same five phases, now with the two modules that were missing (Detailed Portfolio, Assumptions) placed correctly:

1. **Foundation** — `institutions`, `accounts`, `securities`, `assumptions`. Auth + RLS. Pages: *Accounts*, *Holdings* (reference-data tab only), *Portfolio Details*.
2. **The ledger** — `transactions`, `valuations`, `costs`. Pages: *Transactions*, *Valuations*, *Costs*.
3. **Positions & Performance** — the `current_holdings` view, TWR/XIRR re-pointed at Supabase. *Overview*'s Performance card goes live on real data.
4. **Composition & Exposure** — `detailed_portfolio_holdings`, `security_classifications`, `allocations`, the Documents module. This is where *Data Hub* becomes real (staging → review → commit) instead of clipboard-based, and *Overview*'s Allocation/Exposure cards go live.
5. **Depth** — `benchmarks`/`benchmark_history`, Risk Intelligence, `metric_definitions` fully seeded, broker API integrations.

Phase 5 is explicitly the only phase with no workbook precedent to migrate — everything in Phases 1–4 has a real sheet, real rows, and a real column list behind it today.
