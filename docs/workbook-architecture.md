# Portfolio Management Database Architecture

## Design Report & Data Model

### Version 1.3

*This revision refines the `Costs` sheet: a cost is not just a value, it's a value plus how it applies over time and what unit it's denominated in. See Section 16 for what changed. The architecture remains closed — this is a structural detail on one sheet, not a reopening.*

---

## 1. Executive Summary

### Objective

The objective of this workbook is to create a single source of truth for the entire Portfol.io ecosystem.

Rather than functioning as a traditional investment tracker, this workbook acts as the central financial database from which every calculation, chart, KPI and dashboard visualization is derived.

The design philosophy is based on three principles:

- Minimal manual input
- Maximum automation
- Complete historical traceability

Every piece of information should only be entered once whenever possible, with all other metrics being calculated automatically.

This is the last planned revision of the architecture itself (see Section 16). From here, the highest-value work moves to implementation: wiring `01_Portfolio AI`'s adapter to this workbook and gradually replacing mock data with real data, sheet by sheet.

---

## 2. Design Philosophy

The workbook has not been designed around reports.

Instead, it has been designed around events.

Every new piece of information received by the investor falls into one of only four categories:

- Static information
- Investment transactions
- Portfolio valuations
- Periodic reports

Once these events are stored, the workbook derives every other metric automatically.

This minimizes maintenance while maximizing analytical capability.

---

## 3. Information Lifecycle

The complete lifecycle of portfolio information can be represented as follows:

```
Product created
        │
        ▼
Static Product Information
        │
        ▼
Investment Transactions
        │
        ▼
Portfolio Value Updates
        │
        ▼
Monthly Reports
        │
        ▼
Automatic Analytics
        │
        ▼
Portfol.io Dashboard
```

---

## 4. Data Categories

The workbook is organized into five logical groups: *Reference Data*, *Events*, *Imported Data*, *Derived Data*, *Configuration*.

### Reference Data

Information that rarely changes.

**Sheets:** `Accounts`, `Assets`

Examples:

- Asset metadata
- Account information
- ISIN
- Ticker
- Broker
- Currency
- Fund manager
- Launch date
- Benchmark
- Risk classification

This information is generally entered only once.

**Design principle — Cash is an Asset.** Cash is not a special case and is never inferred from a subtraction. Cash is simply another row in `Assets`, exactly like an ETF or a mutual fund — for example `Cash EUR`, `Cash USD`, `Cash GBP`. It is held in an account, it has a currency, and it gets a value like any other asset. Treating cash this way means, for free and without special-case logic anywhere else in the architecture:

- Portfolio Values snapshots contain cash positions the same way they contain fund positions
- Cash ratio is a normal derived calculation (cash assets ÷ portfolio total), not a separate code path
- Historical liquidity is preserved, because cash has its own row in `Portfolio Values` over time
- Deposits that have not yet been invested are naturally represented — a contribution just increases a `Cash EUR` position until it's deployed
- Multi-currency portfolios are supported without special logic — `Cash USD` and `Cash GBP` behave identically to `Cash EUR`

### Events

The most important layer of the workbook. Every row represents something that happened.

**Sheets:** `Transactions`, `Portfolio Values`

#### Transactions

Whenever an asset is bought or sold.

Example fields: Date, Asset, Transaction Type, Units, Price, Amount, **Fees, Tax, FX Cost**, Currency, Account.

**Design note — transaction-level costs don't need a `Frequency`.** `Costs` (below) has to say *how often* a cost applies, because it's describing a standing condition (a fund's ongoing TER, say) that exists independent of any single event. A transaction's `Fees` / `Tax` / `FX Cost` are different: each is already scoped to one dated event, so there's nothing to say about frequency — it happened once, on this row, by construction. Splitting cost-that-recurs (`Costs`) from cost-that-happened (`Transactions`) rather than merging them into one sheet is deliberate.

These records allow calculation of:

- Invested Capital
- Average Cost
- Realised Gains
- Cash Flows
- Portfolio Value History

#### Portfolio Values

*(named `Capital` in Version 1.0/1.1 — renamed in this revision; see Section 16.)*

A chronological record of portfolio valuations — arguably the most important table in the workbook. Nearly every portfolio performance metric is derived from it. Per the *Time as a First-Class Dimension* principle (Section 5), every row is a dated snapshot — there is no "current value" field anywhere.

| Date | Asset | Value |
|---|---|---|
| 01/08/2026 | BPI Dinâmico | 335€ |
| 01/08/2026 | VWCE | 42€ |
| 01/08/2026 | Cash EUR | 6€ |
| 05/08/2026 | VWCE | 44€ |

(The `Cash EUR` row above is the direct consequence of the "Cash is an Asset" principle: an uninvested deposit is just another `Portfolio Values` snapshot, not a formula subtracting invested value from portfolio total.)

Examples of what this table derives:

- Portfolio Value
- Daily Return
- Weekly Return
- Monthly Return
- Annual Return
- CAGR
- Historical Performance
- Drawdown
- Growth Charts

The more frequently values are recorded, the richer the analysis becomes — see Section 12's *Frequency Independence* principle, which formalizes that this is a matter of richness, not a requirement.

**Design note — Performance metrics are separated from capital flow metrics, and neither is separated from raw value by accident.** Three genuinely different questions get asked about the same holdings, and this architecture keeps three genuinely different metrics to answer them, never collapsing one into another for convenience:

- **Portfolio Value** measures the current value of the portfolio — how much is held, right now. It is expected to move when money is deposited or withdrawn; that is not noise, it is the point of this metric.
- **Performance metrics** (e.g. **TWR** — Time-Weighted Return) measure investment performance independently of deposits and withdrawals, by chain-linking the return of each period between cash flows. A deposit's size and timing must never distort this number.
- **Investor return metrics** (e.g. **MWR / XIRR**) measure the investor's actual return considering the timing of their cash flows — a genuinely different question from TWR ("how did the investment perform"). Implemented as of Version 1.6 via a generic XIRR solver reading every dated cash flow straight from `Transactions`, plus current value as a hypothetical terminal payout — nothing hardcoded to today's specific flows, so a new contribution is one more `Transactions` row, never a recalculation of the method. Always annualised, unlike TWR's cumulative percentage — the two numbers reading very differently in magnitude is expected, not a discrepancy to reconcile.

The failure mode this guards against is real and easy to fall into by accident: computing return as `(current value − invested capital) ÷ invested capital` silently dilutes toward 0% every time fresh capital is deposited (new money has had no time to gain or lose anything but is already counted in the denominator) — and a raw value-over-time chart has the opposite failure, going up on every deposit as if it were a gain. Both are the same underlying error: conflating capital (how much is held) with return (what it earned). Concretely today: `Portfolio Values` for BPI Dinâmico has exactly one cash flow (the 2017 subscription) and no interim contributions since, so its own value trajectory already *is* a valid TWR series; the moment a second holding (e.g. Trading212) has its own return history, computing a correct blended TWR means chain-linking sub-periods across every cash-flow date, not just reading the combined value curve. `Portfolio Value` and `Investment Performance` (TWR) are deliberately two different numbers on the dashboard for this reason — they should never be reconciled into one, and a future `Investor Return` (MWR/XIRR) surface should join them as a third, not replace either.

### Imported Data

Raw extractions from monthly provider reports — stored close to the source format, before normalization.

**Sheets:** `Detailed Portfolio`, `Costs`

#### Detailed Portfolio

Complete monthly portfolio composition. The parser developed for the BPI Detailed Portfolio should extract as much information as possible.

The philosophy is simple: store everything. Fields that are not currently useful may become valuable in future versions of Portfol.io.

**`Exposure Country` / `Exposure Region`** — the single source of truth for every geographic exposure visualization on the dashboard (Country/Region tabs). Every security gets exactly one value in each, determined by what it actually *is* (issuer, ETF benchmark index, fund mandate) - never inferred from the regulatory `Category Path` field, never distributed by guess across countries a fund happens to be domiciled or regulated in. A global tracker fund gets `World`, a single-country government bond gets that country, a security whose real geographic exposure can't be determined from its name gets `Unknown` rather than a guessed one - `Unknown` is a first-class, honestly-labelled value, not an error state. Today this covers all 122 real holdings (BPI Dinâmico's 118 Detailed Portfolio rows + the 4 Trading212 ETFs, each added as its own single 100%-weight row so the sheet is genuinely comprehensive across the whole portfolio, not just BPI). Classified manually for the Version 1.7 pass; Version 1.8 (below) automated classifying every *future* import.

#### Security Classifications

The persistent dictionary the automated classifier (Version 1.8) checks first, before ever pattern-matching or guessing. `Security Name → Exposure Country | Exposure Region | Classification Method | Date Added | Notes`, one row per distinct security name ever seen. This is a Reference Data sheet (Section 8), not an Imported Data one - it doesn't come from a report, it accumulates from the classifier's own output plus manual corrections made in the Data Hub UI.

**Design principle - the dictionary only ever grows by a human confirming a row, never by the importer writing to the workbook on its own.** Data Hub's classifier runs entirely client-side against an in-memory copy of this sheet (`js/importer/geoClassifier.js`'s `SECURITY_DICTIONARY`, transcribed from this sheet the same "real but not live" way `repository.js` mirrors other real figures). A newly-classified security - whether by pattern/issuer/government-bond detection, or by a manual choice in the Unclassified Securities list - becomes a "pending dictionary addition" the user reviews and copies into this real sheet themselves. Nothing is appended to the workbook automatically; the same rule that governs every other Data Hub write applies here too.

#### Costs

Historical record of every recurring investment cost. Per Section 5, there is no "current cost" — every row is a dated `Cost` observation, valid *from* that date until superseded by a later row for the same `Asset` + `Cost Name`.

**Design principle — a cost is not just a value, it's a temporal characteristic.** The dashboard can't correctly interpret a cost unless it also knows *how that cost applies*: is 0.835% an annual drag, or a one-off charge? Is 5 a percentage or 5 euros? Storing the bare number and assuming the reader will infer the rest is exactly the kind of implicit knowledge this architecture exists to eliminate (see the *Dashboard Principles*, Section 13). So every `Costs` row carries its own frequency and unit, not just its own value.

**Frequency** — one of: `One-off`, `Daily`, `Monthly`, `Quarterly`, `Annual`. In practice ~95% of rows will be `Annual` or `One-off`, but the column exists so an unusual product (a flat monthly custody charge, say) doesn't need special-case handling anywhere downstream.

**Unit** — one of: `%`, `EUR`, `USD`, or another ISO currency code. Not every cost is a percentage — a TER is `%`, a trading commission is often a flat `EUR`, a monthly custody charge might be `EUR` per month. Storing the unit alongside the value is what lets the dashboard combine costs correctly instead of assuming everything is a percentage.

**Cost Type is split into two columns**, not one: `Cost Category` (a small fixed set — e.g. `Management`, `Trading`, `Custody`) and `Cost Name` (the specific line item — e.g. `TER`, `Depositary Fee`, `Commission`, `Spread`). This is what lets the dashboard answer "how much do I pay in trading costs vs. management costs vs. custody?" by grouping on `Cost Category`, instead of pattern-matching free text in a single `Cost Type` field.

Structure: `Date | Asset | Account | Cost Category | Cost Name | Frequency | Unit | Value | Source`

Example:

| Date | Asset | Account | Cost Category | Cost Name | Frequency | Unit | Value |
|---|---|---|---|---|---|---|---:|
| 2026-06-30 | BPI Dinâmico | BPI | Management | TER | Annual | % | 0.835 |
| 2026-06-30 | BPI Dinâmico | BPI | Management | Depositary Fee | Annual | % | 0.090 |
| 2026-06-30 | BPI Dinâmico | BPI | Trading | Subscription Fee | One-off | % | 0.000 |
| 2026-06-30 | BPI Dinâmico | BPI | Trading | Redemption Fee | One-off | % | 0.000 |

Maintaining historical costs this way allows long-term fee analysis that's genuinely comparable across products — a flat-fee broker and a percentage-fee fund end up in the same table without either one needing to be normalized by hand first.

### Derived Data

Data that is *computed*, never entered by hand.

**Sheet:** `Allocations`

**Design principle — Allocations are derived, not imported.** The user should never manually populate the `Allocations` sheet. It is always generated by a parser reading `Detailed Portfolio`:

```
Detailed Portfolio
        │
        ▼
Portfolio Importer
        │
        ▼
Normalized Allocations
```

Rather than creating separate tables for Countries, Sectors, Asset Classes, and Currency Exposure, the workbook stores every allocation inside a single normalized table. Per Section 5, there is no "current allocation" — every row is a dated observation:

`Date | Asset | Dimension | Category | Weight`

| Date | Asset | Dimension | Category | Weight |
|---|---|---|---|---|
| 31/07 | BPI Dinâmico | Asset Class | Equity | 42% |
| 31/07 | BPI Dinâmico | Country | USA | 18% |
| 31/07 | BPI Dinâmico | Sector | Technology | 14% |
| 31/07 | BPI Dinâmico | Currency | USD | 62% |

The parser should extract every allocation dimension possible from the monthly reports — not just the four shown above. Examples: Asset Class, Country, Region, Sector, Currency, Credit Rating, Duration, Market Cap.

This makes the database future-proof in two ways:

- Unlimited allocation types without changing the database structure — the dashboard simply filters by `Dimension`.
- Source independence — whether allocations originate from BPI Detailed Portfolio, ETF Holdings, or a future broker's report, they all land in the same schema. The HTML dashboard never knows the source.

### Configuration

Contains assumptions used by financial models.

**Sheet:** `Assumptions`

Examples: Risk Free Rate, Inflation, Expected Returns, Bull/Bear/Base Scenario, Long-term Tax Assumptions.

These values feed forecasting tools but remain editable.

---

## 5. Time as a First-Class Dimension

This is close to a philosophy of the database, not just a design choice.

**There is no "current state" stored anywhere in the database.** The current state is always derived — by taking the latest observation available.

This applies uniformly:

| Never stored | Instead, always |
|---|---|
| Current Allocation | `Allocation` + `Date` |
| Current Cost | `Cost` + `Date` |
| Current Value | `Portfolio Values` (`Value` + `Date`) |

Concretely: no sheet in this workbook has a "Current X" column that gets overwritten in place. Every sheet is append-only observations, and "current" is a query — *the most recent row for this asset* — not a stored field. This is what makes the *Frequency Independence* and *Product Lifecycle* principles (Section 12) possible without any special-case logic: a value that hasn't changed in three years and a value that changed yesterday are read exactly the same way.

---

## 6. Identifier Principles

Primary identifiers never change. Every entity receives a permanent ID at creation, independent of its name, and the ID is never reused or reassigned.

Examples:

```
Account            ACC-001
Asset              AST-001
Transaction        T212-UETW-000014
Allocation         ALLOC-000421
```

Even if a name changes — an asset gets renamed by its provider, an account gets renamed, a sheet itself gets renamed (see the `Capital` → `Portfolio Values` rename in Version 1.2) — the ID remains constant. Anything that references an entity (a `Transaction` referencing an `Asset`, an `Allocation` row referencing an `Asset`) references it by ID, never by name.

**Not every sheet needs a row-level ID.** The rule above is about entities that get *referenced* — an `Asset` or `Account` is pointed to by other sheets, so it needs a stable handle that survives a rename. `Portfolio Values` rows are the opposite: nothing else in the workbook ever points at a specific valuation snapshot by ID, so the ID was pure overhead with no reference to protect. As of this revision, `Portfolio Values` rows carry no ID column (the `CAP-` prefix from Version 1.2 is retired) and no `Account ID` column either — every asset today lives in exactly one account, so `Asset ID` alone already identifies the row unambiguously; `Account` is a lookup via `Assets`, not a second key. If an asset is ever split across two accounts, `Account ID` would need to come back to disambiguate — that's a real, known limitation of this simplification, not an oversight.

---

## 7. Data Quality Principles

Every imported or manually entered record should preserve its provenance. Whenever possible, imported data should carry:

- **Source** — which provider/document the value came from
- **Import Date** — when it was brought into the workbook
- **Report Date** — the date the source document itself covers (not the same as Import Date — a report imported on the 5th usually covers the previous month-end)
- **Import Method** — Manual / Parser
- **Import Version** — which version of the parser (or manual process) produced it

This ensures every value can always be traced back to its original document.

This matters concretely, not abstractly: three years from now, the question *"why did BPI show 41.8% equities in March 2028?"* should have an answer — the exact source document and the exact process that produced that number — rather than an unrecoverable number sitting alone in a cell.

---

## 8. Workbook Structure

The workbook contains nine operational sheets, grouped as follows:

**Reference Data**
- Accounts
- Assets
- Security Classifications — the geographic classification dictionary (Section 4); a lookup table, not a per-period import, so it belongs here alongside `Accounts`/`Assets` rather than under Imported Data.

**Events**
- Transactions
- Portfolio Values

**Imported Data**
- Detailed Portfolio
- Costs

**Derived Data**
- Allocations

**Configuration**
- Assumptions

This intentionally keeps the workbook compact while remaining highly scalable.

---

## 9. Data Sources

The workbook receives information from only three external sources.

**Trading 212** — retrieved manually whenever desired. Provides: Current Portfolio Value, Holdings, Transactions.

**BPI Detailed Portfolio** — imported monthly. Provides: Holdings, Countries, Sectors, Asset Allocation, Currency Exposure, Security Breakdown.

**BPI Monthly Factsheet** — imported monthly. Provides: Costs, Risk Class, Asset Allocation, Fund Characteristics.

---

## 10. Data Flow

```
Trading212
        │
        ▼
Transactions
Portfolio Values

BPI Monthly Report
        │
        ▼
Allocations
Costs

BPI Detailed Portfolio
        │
        ▼
Detailed Portfolio

Everything
        │
        ▼
Automatic Calculations
        │
        ▼
Portfol.io Dashboard
```

---

## 11. Excel Colour Standards

To maximise usability, every workbook follows a strict visual convention.

| Cell Type | Purpose | Colour |
|---|---|---|
| Manual Input | User editable | White |
| Imported Data | Data extracted from reports | Light Blue |
| Derived Values | Calculated fields | Light Grey |
| Assumptions | Model parameters | Soft Yellow |
| Protected Formula | Locked calculations | Dark Grey |
| IDs & Keys | Database identifiers | Soft Purple |

This ensures users can immediately distinguish between editable cells and automatically generated values.

---

## 12. Design Principles

The workbook follows eight fundamental principles:

1. Every piece of information is entered only once.
2. Historical data is never overwritten.
3. Every calculation must be reproducible.
4. Manual input should be kept to an absolute minimum.
5. The HTML dashboard is purely a visualization layer; the Excel workbook remains the single source of truth.
6. **Cash is an asset.** It is never inferred by subtraction — it is stored as ordinary `Portfolio Values` rows for a `Cash EUR` / `Cash USD` / `Cash GBP` asset, exactly like any fund or ETF. See Section 4.
7. **Products, accounts, and transactions are never deleted.** Historical values are never deleted. If an investment is completely sold, its value simply becomes `0` in the next `Portfolio Values` snapshot — the product remains in the database forever. The dashboard determines active/inactive status from the latest available value, not from whether a row exists. Historical integrity is a core principle, not an implementation detail.
8. **Frequency independence.** Portfolio values can be updated daily, weekly, monthly, or irregularly, and the database works identically regardless of cadence. The dashboard always reads the most recent value available for each asset. More observations simply produce richer analytics — the architecture never assumes a fixed reporting frequency.

---

## 13. Dashboard Principles

The dashboard should never require additional manual input.

Every visualization must be reproducible using only the workbook.

**If a metric cannot be derived from the database, the missing data belongs in the database — not inside the dashboard.**

That last sentence is short, but it is probably the single most important rule in the whole project. It's the line that rules out the failure mode this architecture exists to prevent: a dashboard that quietly grows its own parallel copy of "just this one number" because deriving it properly felt like too much friction in the moment. Every time that's tempting, the fix is to add the number to the workbook, not to the dashboard — even if that means the number sits unavailable for a while until the workbook catches up.

---

## 14. Separation of Responsibilities

This separation is one of the strongest parts of the architecture and is made explicit here.

**Importers / Parsers**
Responsible only for transforming external documents into the database schema. They should never perform financial calculations.

**Excel Database**
Single source of truth. Stores historical information. Calculates derived data.

**HTML Dashboard**
Pure visualization layer. Reads data. Never stores business logic. Never becomes the source of truth.

Each layer does exactly one job and trusts the layer below it to have already done its own.

---

## 15. Future Development

The current architecture has been designed to support future expansion without structural changes, including:

- Multi-currency portfolios
- Multiple brokers
- Additional investment products
- Automatic report parsers
- Portfolio optimisation
- Risk analytics
- Monte Carlo simulations
- Retirement planning
- Tax analysis
- AI-generated portfolio insights
- Full synchronization with the Portfol.io dashboard

**Benchmark History (future extension).** `Assets` today only stores benchmark *metadata* (a benchmark name per asset). Future analytics — Alpha, Beta, Tracking Error, Information Ratio — will need the benchmark's own historical values, not just its name. This is not being implemented now; the anticipated shape is a future table:

`Benchmark History` — `Date | Benchmark | Value | Return`

Flagging the shape now keeps the architecture extensible without adding complexity today.

---

## 16. Revision History

**Version 1.9** — Real look-through decomposition for the Exposure > Country tab, using live-fetched official index/fund factsheets. Changes in this revision:

1. **Country-specific attribution rose from 18.13% to 50.59% of the portfolio, using only real, dated, cited sources** - no new inference or guessing. Every security whose Exposure Country is a broad mandate (World / Emerging Markets) that genuinely tracks a real published index gets decomposed into that index's own country weights: MSCI World, MSCI World Sector Neutral Quality, and MSCI Emerging Markets (official MSCI index factsheets, msci.com, as of 31 Jul 2026), plus Avantis' own real fund factsheet for AVWS specifically (avantisinvestors.com, as of 30 Jun 2026, since it's actively managed and doesn't track an index exactly - its own disclosed top-5-country table was used instead of a proxy index).
2. **The Region tab is deliberately unaffected** - a security classified `World` still counts as World there (answers "what's this fund's mandate"); its real look-through country weight now separately shows up on the Country tab (answers "which countries does it hold"). Both are correct, different questions - documented in both tabs' info popovers so the two views not matching isn't mistaken for a bug.
3. **Every source index/fund factsheet only discloses its own top 5 countries plus a lump "Other"** - MSCI and fund providers don't publish the full country table on these documents. That real-but-undisclosed residual, plus BPI Dinâmico's ~25 actively-managed/thematic World/Europe/Emerging-Markets fund-of-fund positions (each would need its own individually-researched factsheet, not an index's - real future work, not attempted this pass), stay honestly inside `notCountrySpecificWeight` (49.41%) - a real number, never a placeholder.
4. **No workbook changes** - this is a dashboard-layer (`repository.js`) enrichment on top of Version 1.7/1.8's real per-security classification; the `Detailed Portfolio`/`Security Classifications` sheets are unchanged.

**Version 1.8** — Automated geographic classification engine, so Version 1.7's manual research pass never has to be repeated by hand. Changes in this revision:

1. **Added the `Security Classifications` sheet** (Section 8, Reference Data) - the persistent `Security Name → Exposure Country/Region` dictionary, seeded with all 121 distinct securities classified in Version 1.7 (122 real Detailed Portfolio rows, two of which share a name - two tranches of the same `XTRACKERS MSCI WORLD` holding).
2. **Built `js/importer/geoClassifier.js`** - a 5-tier cascade (exact dictionary match → keyword pattern match → corporate bond issuer detection → government/supranational bond detection → `Unknown`) that classifies any security name, not just the 122 already seen. Verified against the real `2026-06 - Carteira Detalhada.pdf` fixture: all 118 holdings resolved via exact match (0 unclassified, since every one was already in the dictionary), and separately verified against invented-but-realistic new security names to confirm the pattern/issuer/government tiers generalise correctly to securities the dictionary has never seen.
3. **Wired into the real Data Hub import pipeline** - every "BPI Detailed Portfolio" import now runs its holdings through the classifier automatically. A new "Geographic Exposure" row in the detected-categories list shows the classified/total count; a security the classifier couldn't resolve appears in an "Unclassified Securities" list with an inline dropdown (Data Hub UI, not the workbook) to classify it manually. Manual classifications are queued as "Pending Dictionary Additions" - copied into the real `Security Classifications` sheet by the user, never written automatically (same rule as every other Data Hub write).
4. **The "Fund Holdings" raw table now includes `Exposure Country`/`Exposure Region`**, matching `Detailed Portfolio`'s real schema exactly so "Copy to Excel" pastes in alignment - computed in `data-hub.js`, not inside `consolidate.js`, keeping the parser/mapping layer itself untouched.
5. **Fixed a real, pre-existing bug found while testing this**: Data Hub's "Copy to Excel" button had never actually worked for any table - its group-key parsing (`btn.dataset.copy.split("|")`, destructured to 2 values) silently truncated every real group key, which is itself a `"<slug>|<period>"` string containing a `|`. Fixed to split on the *last* `|` instead. Confirmed working end-to-end against the real PDF fixture after the fix (clipboard content captured and verified programmatically, since the automated test browser can't hold document focus for a real clipboard write).

**Version 1.7** — Geographic exposure made a first-class, security-level data source (Section 4, `Detailed Portfolio`), replacing every inferred/illustrative country in the real dashboard. Changes in this revision:

1. **Added `Exposure Country` / `Exposure Region` columns to `Detailed Portfolio`** - every one of BPI Dinâmico's 118 real holdings manually classified by issuer/ETF benchmark/fund mandate (never by the sheet's existing regulatory `Category Path` field, which is not a geography). 17 holdings (7.62% of the total portfolio) couldn't be determined with real confidence and are honestly `Unknown`, not guessed.
2. **Extended `Detailed Portfolio` to cover Trading212's 4 ETFs too** - each added as its own single 100%-weight row (`UBS Core MSCI World` → World, `Avantis Global Small Cap Value` → World, `Xtrackers MSCI World Quality` → World, `SPDR MSCI Emerging Markets` → Emerging Markets, from their real benchmark indices) - the sheet is now genuinely the single source of truth for the whole portfolio's geography, not just BPI's.
3. **Real dashboard's Country/Region tabs rebuilt to read exclusively from this data** - the previous approach (Version 1.6 and earlier) inferred Portugal from a regulatory-market field and filled the rest of the map with clearly-flagged illustrative countries; that entire mechanism (illustrative country arrays, the `real:false` flag, the "illustrative" legend tag) is deleted. Country tab: 9 real countries with map dots, plus one honest "Not attributable to a single country" figure (81.86% - most real holdings are broader than one country by nature, e.g. an MSCI World tracker or an EU-issued bond, which is real information, not a gap). Region tab: 7 real categories (World, Europe, North America, Unknown, Emerging Markets, Asia, Global) aggregated directly from `Exposure Region`, not derived from the country list.
4. **Fixed a real bug found in the process**: two independently-hardcoded "which countries count as Europe" lists (one in `ui.js`, one in `shell.js`) had already drifted out of sync. Consolidated into one `COUNTRY_TO_REGION` map in `utils.js`, referenced by both.
5. **Deferred to future work, tracked separately from the workbook schema**: an automated classification engine in the PDF importer (pattern-matching on security name, issuer detection, a persistent learning dictionary so a security is never classified twice, a manual-override correction flow) so `Exposure Country`/`Region` don't need re-populating by hand on every monthly import.

**Version 1.6** — Investor Return (XIRR) implemented, applied to the real dashboard. Changes in this revision:

1. **Investor return metrics are no longer a placeholder** (Section 4) — a generic XIRR solver (Newton-Raphson with a bisection fallback) reads real dated cash flows straight from `Transactions` (the €250 BPI subscription, the €160 Trading212 buys) plus current total value as a hypothetical "sold today" terminal flow, and solves for the annualised rate. Generic on purpose: a new contribution is one more entry in the cash-flow list the solver takes, never a rewrite of the method.
2. Real dashboard updated to match: a fifth KPI, **Investor Return**, showing the XIRR (+3.27% annualised) alongside the existing four. Explicitly labelled "annualised (XIRR)" and documented in its info popover *why* it reads so much smaller than Investment Return's +34.40% (cumulative, not annualised - different time bases, not a disagreement) to head off the obvious "why don't these match" confusion before it happens.
3. No workbook schema changes — `Transactions` already had everything this calculation needed (Section 4, Version 1.5).

**Version 1.5** — Return methodology clarified (Section 4), applied to the real dashboard. Changes in this revision:

1. **Added a design note separating three metrics that were getting conflated** (Section 4, under `Portfolio Values`): **Portfolio Value** (current holdings, expected to move on deposits/withdrawals), **Performance metrics** (e.g. TWR — chain-linked, cash-flow-neutral, measures the investment), and **Investor return metrics** (e.g. MWR/XIRR — considers the investor's actual cash-flow timing; not yet implemented, but `Transactions` already has every dated cash flow an XIRR calculation would need). Deliberately phrased generically ("e.g. TWR" / "e.g. MWR/XIRR") rather than committing to one formula, so adding Investor Return later is a new metric, not a philosophy change.
2. Real dashboard updated to match: `analytics.performance.totalReturnPct` now holds BPI Dinâmico's TWR (+34.40%) instead of the old diluted `gain ÷ invested` figure (+21.01%, understated by the just-deposited, zero-return Trading212 sleeve). The simple `gain ÷ invested` figure wasn't deleted — it's `unrealisedGainPct` (+20.84%), shown as its own honestly-labelled "Unrealised Gain", never as the return headline. Renamed for clarity: `Portfolio Performance` → **Investment Performance**, `Total Return` → **Investment Return**, `Total Invested` → **Net Invested**. The chart no longer ends on `totalValue` (that drew a fake jump for the T212 deposit); `Portfolio Value` keeps showing the real current total separately.
3. No workbook schema changes — this is a computation-methodology and labelling fix, not a new column or sheet.

**Version 1.4** — `Portfolio Values` simplified, applied to the real workbook. Changes in this revision:

1. **Dropped the `Portfolio Value ID` column** (Section 6) — no other sheet references a `Portfolio Values` row by ID, so the `CAP-` primary key introduced in Version 1.2 was overhead with nothing to protect. Retired, not replaced.
2. **Dropped the `Account ID` column** — every asset today lives in exactly one account, so `Asset ID` alone already identifies the row; `Account` is a lookup via `Assets`, not a second key. Documented as a known limitation in Section 6: if an asset is ever held across two accounts, `Account ID` would need to come back.
3. Real workbook updated to match: both columns removed from `Portfolio Values`, remaining columns' formatting (ID purple / imported-data blue / white) preserved in their new positions.
4. No other structural changes.

**Version 1.3** — `Costs` sheet structural refinement, applied to the real workbook. Changes in this revision:

1. **Costs are now temporal characteristics, not bare values.** Added `Frequency` (`One-off` / `Daily` / `Monthly` / `Quarterly` / `Annual`) and `Unit` (`%` / `EUR` / `USD` / ...) columns to `Costs`, so the dashboard knows how a stored number applies without guessing.
2. **Split `Cost Type` into `Cost Category` + `Cost Name`** (Section 4) — enables grouping by category (management / trading / custody) without text-matching a free-form field.
3. **Added `Tax` and `FX Cost` columns to `Transactions`**, alongside the existing `Fees` — and documented explicitly why per-transaction costs don't need a `Frequency` column the way `Costs` does (Section 4): a transaction cost is already scoped to one dated event.
4. Real workbook updated to match: `Costs` repopulated with the real BPI Dinâmico TER/Depositary/Subscription/Redemption figures under the new structure; `Transactions` gained `Tax`/`FX Cost` (0 for all five recorded transactions — no withholding or FX cost on record for any of them).
5. No other structural changes.

**Version 1.2** — architecture closed. This is the intended final revision before implementation; further changes should be genuinely new requirements, not clarifications. Changes in this revision:

1. Added **Data Quality Principles** (Section 7) — Source, Import Date, Report Date, Import Method, Import Version on every imported/manual record, so any value is traceable back to its original document.
2. Added **Identifier Principles** (Section 6) — permanent, immutable IDs per entity (`ACC-`, `AST-`, `CAP-`, `ALLOC-`, plus the existing broker-derived transaction ID scheme), independent of names. Used the `Capital` → `Portfolio Values` rename (this same revision) as a live example of ID stability surviving a name change.
3. Added **Time as a First-Class Dimension** (Section 5) — no "current state" is ever stored; every sheet is append-only dated observations, and "current" is always a query (latest row), never a field. Cross-referenced from `Portfolio Values`, `Costs`, and `Allocations` in Section 4.
4. Added **Dashboard Principles** (Section 13) — the dashboard never requires manual input beyond the workbook, every visualization must be reproducible from the workbook alone, and a metric that can't be derived belongs in the database, not the dashboard.
5. **Renamed `Capital` to `Portfolio Values`** throughout (Sections 4, 8, 9, 10) — "Capital" is financially ambiguous (invested capital? equity? share capital? available capital?), while the sheet is actually a history of portfolio valuations. Row-level ID prefix (`CAP-`) intentionally kept unchanged — see point 2 above.
6. No other structural changes: same eight sheets, same colour standard, same data sources, same data flow.

**Version 1.1** — added Cash-as-Asset, Allocations-as-derived-data, Benchmark History (future note), Product Lifecycle, Frequency Independence, Separation of Responsibilities; regrouped four data categories into five.

**Version 1.0** — initial design report.
