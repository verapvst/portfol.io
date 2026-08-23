# Vera, Inc. — Personal Finance Architecture

**Status: PROPOSAL, awaiting your review. No code, no migrations, nothing built from this document yet.** Grounded in a full audit of the actual live schema (17 tables, `supabase/migrations/0001`–`0023`) and the four existing architecture docs (`platform-architecture.md`, `migration-plan.md`, `information-architecture.md`, `production-architecture.md`) — not a rewrite of those, an extension. Where this document disagrees with one of them, it says so explicitly and why.

---

## 0. The single most important finding before anything else

**You already have the framework you're asking for.** `platform-architecture.md` §3–4 (written before this session) already establishes exactly the distinction your own §C reinvents: a three-layer model (Presentation / Application / Data) where the Data layer splits into Reference Data, Configuration, an append-only **Event Store**, and **Derived Views** that are computed, never edited. `migration-plan.md` §1 states the same idea again as "Data vs. Intelligence." Your own request's vocabulary maps onto it directly:

| Your term | Existing term | Already real? |
|---|---|---|
| Events | Portfolio Event Store rows | Yes — `transactions` |
| State | Derived Views (current) | Yes — `holdings` (computed in `analytics.js`, never stored) |
| Observations | Event Store rows of a specific shape (dated, sourced, insert-only) | Yes — `valuations` |
| Derived analytics | Derived Views / Materialized Analytics | Yes — TWR, XIRR, weight, everything in `calculations.js` |

The Transaction → Holding → Valuation → Portfolio Value fix from your last request is a **working instance of this exact model**, not a one-off: Buy/Sell are Events, `holdings` (filtered to exclude zero-value positions) is State, a Manual Update row is an Observation, TWR/weight/unrealised P&L are Analytics. Personal finance doesn't need a new philosophy — it needs the *same* philosophy applied to a domain (cash flow, net worth) that Portfol.io hasn't modeled yet. That's the frame for everything below.

**One real divergence to flag honestly:** `production-architecture.md` designed a formal `edit_sessions` table (time-boxed write elevation) and `public_allocation_view`/`public_performance_view`/etc. as the mechanism for Showcase mode. **Neither was ever built.** What's actually live today is simpler: Supabase Auth (signed-in/signed-out) plus RLS grants, and — built this session — anon-safe `SECURITY DEFINER` RPC functions (`public_portfolio_allocation()`, etc.) for aggregate-only public data. This achieves the same goal (anon never touches a raw table with money in it) through a lighter mechanism than the doc specifies. **Recommendation: treat the shipped model as authoritative, not the unbuilt one.** `edit_sessions` was designed for a risk (someone holding your session token from a stale tab) that doesn't materially change with a personal-finance layer added — I'd only revisit it if a second real user or device-sharing scenario becomes concrete, not preemptively.

---

## A. Product architecture

**Recommendation: Personal Finance becomes a top-level nav category inside Portfol.io — not a separate app, not a sub-page of Portfolio.**

Why not a separate app ("Vera Finance" sitting above Portfol.io): you said it yourself in §9 — *"do not duplicate financial data unnecessarily."* A separate app immediately creates two systems that both think they know your cash balance, and the moment they drift (you record an expense in one, a portfolio deposit in the other) you're back to the exact Excel-vs-reality problem `platform-architecture.md` was written to kill. One app, one Supabase project, one auth session, one source of truth for cash. This isn't a stylistic preference — it's the same structural argument that already justified moving off Excel.

Why not folded into "Portfolio": net worth, income, and expenses aren't investment concepts, and burying them under Portfolio would recreate the exact inversion `information-architecture.md` already called out and fixed once (*"the old structure (Overview + Data Hub) inverted that — everything read as 'the dashboard, plus some admin tooling'"*). Personal Finance is a peer of Portfolio, not a subordinate of it — matching your own instinct in §9's diagram.

**Recommended top-level IA** (full reasoning in §I):

```
Portfolio                    Personal Finance             Investments/Admin        Data
├─ Overview                  ├─ Cash Flow                 ├─ Accounts               └─ Data Hub
├─ Portfolio                 ├─ Net Worth                 ├─ Transactions
├─ Performance                └─ Calendar (Phase 3+)       └─ Costs
├─ Research
└─ Lab (Phase 5+)
```

`Overview` stays investment-focused for now — it already has a clear job. Net worth/cash-flow gets its own landing page inside the new category rather than diluting Overview's purpose. Revisit only once both sides are mature enough that a genuinely unified "how is Vera, Inc. doing" dashboard earns its keep — premature today, real feature creep if built now.

---

## B. Data architecture

### The one design decision everything else depends on

**How do personal cash flow and Portfol.io's existing Cash tracking relate?** Two real options, not a false choice:

**Option 1 — Unify them.** Your bank/spendable cash *is* the same Cash security Portfol.io already tracks (`securities.type = 'Cash'`, valued via the same `valuations` table). Income = a `deposit` transaction. Every expense — mobile bill, groceries, everything — = a `withdrawal` transaction, extended with a new nullable `category` column. Investment allocation = a `buy` (already correctly modeled, confirmed by your last request's fix).

**Option 2 — Separate, lightweight, monthly-grain.** New `income_events`/`expense_events` tables, independent of `transactions`, tracking income/spending at a coarser grain (a monthly total per category, not every coffee). Only the *final* step — "I'm investing €X this month" — becomes a real Portfol.io transaction (a `deposit` into Cash, then a `buy`), bridging the two systems at exactly one point.

**My recommendation: Option 2.** Your own §5 diagram already implies this — it shows Income → Expenses → Available Cash → Investment Allocation → Portfolio as a sequence where only the *last arrow* touches Portfolio. Option 1 is more elegant on paper (one ledger, zero duplication) but means recording every mobile-phone-bill as a formal `withdrawal` transaction against your investable cash — real day-to-day friction for a system whose stated goal is a lighter weekly/monthly cadence, not more manual entry. Option 2 keeps `transactions` scoped to what it's actually good at (security-level events with cost-basis/TWR implications) and gives Personal Finance its own event grain, connected to Portfolio at exactly the one moment money actually crosses the boundary — which is also the one moment where double-counting risk would actually exist, so that's exactly where the bridge belongs.

This isn't irreversible — if monthly-grain tracking turns out to feel too coarse later, Option 1's schema is a strict extension of Option 2's (add `category` to `transactions`, backfill), not a rewrite.

### New entities (Option 2)

**Event Store (new, same append-only/void+replace discipline as `transactions`):**
- `income_events` — date, source (`allowance`/`salary`/`other`, extensible), amount, currency, notes.
- `expense_events` — date, category (`mobile`/`subscriptions`/`transport`/`food`/`entertainment`/..., extensible), amount, currency, is_recurring (bool), recurring_expense_id (nullable fk), notes.
- `liability_events` — mirrors `transactions`' shape for debt: date, liability_id, type (`draw`/`repayment`/`interest_accrued`), amount.

**Observations (new, same insert-only/latest-wins discipline as `valuations`):**
- `liability_valuations` — date, liability_id, balance. Exactly `valuations`' shape, applied to debt instead of an asset.
- `durable_asset_valuations` — only if you ever want to track a car/property's value over time; same shape again. **Not built until you actually own something worth tracking this way** — see §G.

**Configuration (current-state preference, not a fact — same category as `assumptions`, `target_allocations`):**
- `recurring_expenses` — name, category, amount, frequency, active/cancelled, start_date. A subscription's *existence* is a preference-like fact (what you've committed to), not an event each month — the monthly `expense_event` it generates *is* the event.
- `liabilities` — name, type, original_amount, interest_rate, opened_date, status. The debt's existence/terms are Configuration; its balance over time is the Observation above.
- `financial_targets` (optional, Phase 3+) — target monthly investment amount, target savings rate. One row per goal, editable.

**Derived (never stored, computed on read — same category as TWR/XIRR):**
- Net worth = latest Cash valuation + latest investment holdings value (both already exist) + optional durable assets − latest liability balances.
- Monthly income/expense totals, savings rate, investment rate — aggregates over `income_events`/`expense_events`/existing `buy` transactions.
- Cash Flow Statement (Operating/Investing/Financing) — see §E.

### What should explicitly NOT become a table

- **Net worth** — always derived, exactly like current holdings value. Storing it would recreate the "current state stored somewhere" problem this whole architecture exists to avoid.
- **Savings rate, investment rate** — pure derived percentages.
- **"Vera, Inc." as an entity** — there's one portfolio, one person; don't model a company/person distinction that has no second instance to distinguish from. `platform-architecture.md` §4.1 already flags this exact trap for classification data ("shared reference data... avoids a painful re-scope the moment a second user exists") — the same logic argues the *opposite* way here: don't build for a multi-entity future you don't have and don't need yet.

---

## C. Event vs. State vs. Observation vs. Analytics

Confirmed correct, and — per §0 — already the operating model, not a new one. Applied to Personal Finance specifically:

| Category | Personal Finance examples | Existing precedent |
|---|---|---|
| **Events** | Income received, expense incurred, liability drawn/repaid | `transactions` (buy/sell/deposit/withdrawal) |
| **State** | Current liabilities, current subscriptions, current net worth | `holdings` (computed, not stored) |
| **Observations** | Weekly portfolio check-in, monthly BPI snapshot, liability balance | `valuations` (insert-only, latest-wins) |
| **Derived analytics** | Savings rate, net worth, investment rate, cash-flow statement | TWR, XIRR, weight (`calculations.js`) |

Nothing here needs a new mechanism — every row above reuses a pattern this app already enforces correctly.

---

## D. Financial calendar architecture

**Recommendation: a genuinely small table, not a scheduler.** Exactly what you proposed — expected date, frequency, status, completed date — and nothing more yet:

```
financial_calendar_items:
  id, item_type (weekly_checkin / monthly_bpi_snapshot / monthly_close / income / recurring_expense / portfolio_review),
  frequency (weekly / monthly / quarterly), expected_date, status (upcoming / due / completed / skipped),
  completed_at, related_id (nullable — fk to whatever event/observation closing this item produced)
```

No automation, no notifications, no cron in Phase 1 — this table's only job is to answer "what's due, what did I do about it" on a Calendar/Checklist page. A scheduled reminder (email, push) is real future work (`platform-architecture.md` §5.4 already reserves "Notifications" as an Application-layer concern) — don't build it now; the table shape above doesn't block it later.

---

## E. Accounting model

Direct answers to your explicit questions, challenging where warranted as you asked:

**Income:** allowance, salary, any money genuinely received. Straightforward.

**Expense:** operating expenses (mobile, subscriptions, transport, food, entertainment) — recurring or one-off, consumed, no residual value, no asset created.

**Transfer:** money moving between your own accounts/pools without leaving your net worth — e.g., moving cash from checking into your brokerage's cash sub-account. Worth its own category precisely so it never gets miscounted as either income or expense (it's neither — net worth is unchanged).

**Investing:** buying/selling securities. **Already correctly modeled** — this is exactly what your `buy`/`sell` transaction types already are, confirmed by the fix you just had me make (buy/sell don't change total value, they reallocate it).

**Financing:** borrowing and repaying debt. New territory (`liabilities`/`liability_events` above).

**Capital asset — the CapEx/depreciation question, directly:** your own instinct (laptop maybe, shoes no) is correct, and I'd go further: **don't build a depreciation/amortization engine at all — it's accounting theater for a personal system.** Corporate depreciation exists to match an asset's cost against the *revenue it helped generate* over its useful life — there's no personal equivalent of that matching problem. What's actually useful is much simpler:
- A **"Durable Purchase"** category (distinct from Operating Expense) for large one-off buys, so a €1,500 laptop doesn't spike your "monthly expenses" trend line the way a recurring cost would. That's a *display/categorization* concern, not an accounting one.
- If — and only if — something has genuine, trackable resale value you actually care about (a car, property), model its value the **same way this app already models everything with a changing value**: a `durable_asset_valuations` table, exactly shaped like `valuations`, updated whenever you actually know its worth. That's an *observation*, not a *schedule* — no formula guessing what a laptop is "worth" on paper. This is more consistent with the rest of the architecture than depreciation would be, not less.
- A €40 pair of shoes: Operating Expense, full stop. No asset, no schedule, nothing to track after the purchase.

**Investment contributions:** already correct in your own framing and in the existing schema — a `buy` transaction, capital allocation, never conflated with income.

**Net worth:** Cash + Investment Assets (both already computed) + optional Durable Assets − Liabilities. Always derived, never stored (§B).

**On EBITDA/EBIT, explicitly:** **don't use them.** They exist to compare companies with different capital structures and tax situations on operating performance alone — there's no analogous "different capital structure" problem for one person. The one genuinely useful concept from that family is **Operating Surplus** (Income − Operating Expenses, *before* investment allocation) — keep that, drop the corporate label. Plain terms throughout: Income, Operating Expenses, Operating Surplus (or Disposable Income), Investment Allocation, Net Cash Flow. This also matches something you already got right without corporate vocabulary: **investment returns are portfolio performance, never Income.** Unrealised gains aren't income in *any* accounting system, corporate or personal — that instinct doesn't need correcting, it needs reinforcing: never let a "personal income statement" sum in TWR or unrealised P&L. They stay entirely inside the Portfolio domain.

**Cash Flow Statement, Operating/Investing/Financing — is it useful?** Yes, and it maps cleanly onto what already exists:
- **Operating:** income minus operating expenses.
- **Investing:** `buy`/`sell` transactions — already real, already correctly classified by the TWR fix from your last request.
- **Financing:** liability draws/repayments (new).

Where the corporate model gets fuzzy for personal use is the boundary between "Operating" and the transfer into your brokerage — I'd keep it simple and call that transfer **Investing** outright (money leaving your operating cash to become an investment), matching your own §5 diagram, rather than inventing a personal "Financing" category for it.

---

## F. Portfol.io (investment side) — how it evolves without breaking anything

Nothing described above touches `scopedPerformance()`, `PORTFOLIO_EXTERNAL_CASH_FLOW_TYPES`, `buildComparisonSeries()`, or any existing calculation. The two new cadences from your §2 and §4 are **both already the exact shape `valuations` and `security_details` already use** — no new mechanism required, only new *rows*, and in one case a genuinely new table:

**Weekly Portfolio Check-in (§2):** this is just... `valuations`, at a Sunday cadence, for the securities that make sense to check weekly (portfolio total isn't a security — it's derived from BPI/Trading212/Cash's own valuations, already true today). **Nothing new to build here except UI**: a "Weekly Check-in" view that prompts for BPI/Trading212/Cash on Sundays, writing through the exact same `recordValuations()` every other update already uses. Your explicit caution — *"don't confuse valuation date with market trading date"* — is already partially handled: `benchmark_history.frequency` already distinguishes `'daily'` vs `'monthly'` observation density for market data (0018/0019). The same `frequency` column, added to `valuations` (a small additive migration, matching the pattern `0007`'s `updated_at` trigger already used), gives you `'weekly'` explicitly, so nothing downstream ever has to infer coverage density from point spacing.

**Monthly BPI Snapshot (§4):** this is **not** `valuations` — it's a fundamentally different shape (a full composition breakdown, many rows per report date, not one number). It already has a home in the existing architecture, unbuilt but fully specified: `migration-plan.md` §2.6, `detailed_portfolio_holdings` — *"Asset ID · Report Date · Category Path · Security Name · ... Weight % ... Exposure Country · Exposure Region"* — literally your own worked example (Security A 12.4%, Security B 8.7%, ...) from over a week before this request, never built. **This is the single clearest "reuse, don't invent" finding in this whole document.** The Data Hub PDF pipeline (`js/importer/*.js` — `monthlyFactsheetParser.js`, `holdingsReportParser.js`, `consolidate.js`) already parses exactly this BPI document shape; what's missing is the Supabase table for it to land in and a real commit path (today's Data Hub writes costs directly but has no destination for composition rows — confirmed in this session's audit of `data-hub.js`). Build `detailed_portfolio_holdings` almost exactly as `migration-plan.md` already specified it — this document doesn't need to redesign that, only confirm it's still the right target.

Your five-way cadence split (Weekly / Monthly BPI / Transaction / Market data / Performance) is correct and is really a restatement of "different Observation grains for different domains" — no new architectural category needed, just the two new Observation streams above.

---

## G. Future-proofing — what today's schema should (and shouldn't) anticipate

Direct answers, matching your "tiny foundational change only, don't build the feature" framing:

- **Alpha/Beta/Sharpe/Sortino/correlation:** already unblocked. `benchmark_history` + `risk_free_rates` (0021, already built) are the only two dependencies these formulas need, and both are live. `scopedQuantMetrics()` already exists in `calculations.js` (confirmed in this session's own work on the Performance page) — this is arguably *already* Phase 4, not future work. No schema change needed.
- **Portfolio optimisation / efficient frontier:** needs nothing new structurally — operates on the same holdings/weights/covariance data Sharpe already needs. Pure computation, no new table.
- **Portfolio Lab:** the one thing worth a tiny foundational decision *now*: a hypothetical scenario needs to hold a **synthetic set of weights**, never write to real tables. `feature-backlog.md` already scoped this exactly (`simulation_scenarios`: user_id, name, `positions jsonb`, `assumptions jsonb`) — a single JSON-holding table is sufficient; don't build more than that until the Lab itself is being built. The important guarantee, worth stating explicitly in code once this exists: the calculation engine (`scopedPerformance()`, `buildComparisonSeries()`, quant metrics) must accept a hypothetical `securityHistories`/weights object exactly as it accepts the real one today — confirmed already true, since these functions are already pure and take their data as parameters, never read Supabase directly.
- **Monte Carlo:** needs nothing today beyond what Alpha/Beta already needs (a return distribution to sample from). Explicitly do not build a parametric or bootstrap engine now — you said so yourself, and there's no foundational schema gap blocking it later.
- **Net-worth forecasting / financial independence scenarios:** needs the Personal Finance layer's own historical `income_events`/`expense_events` to exist first (a projection needs a real trend to project from) — sequencing dependency, not an architecture gap. Nothing to pre-build.

**The one real "don't skip this or it's expensive later" item:** if you want Weekly Check-ins to be genuinely queryable as "weekly" data later (vs. inferring density from point spacing), add the `frequency` column to `valuations` now, in the same migration that introduces the weekly workflow — cheap now, a backfill problem later.

---

## H. Migration strategy

**Nothing gets thrown away.** Concretely:

1. **What remains, unchanged:** `portfolios`, `institutions`, `accounts`, `securities`, `security_details`, `transactions`, `valuations`, `costs`, `documents`, `benchmarks`, `benchmark_history`, `daily_prices`, `price_fetch_log`, `brokers`, `fx_rates`, `benchmark_fetch_log`, `risk_free_rates`. Every calculation in `calculations.js`/`analytics.js` you've already validated stays exactly as-is.
2. **What gets a small additive extension:** `valuations` gains a nullable `frequency` column (§F) — same pattern as `benchmark_history.frequency` (0018) and `security_details.updated_at` (0007). Non-breaking, defaults preserve current behaviour.
3. **What gets merged:** nothing — Personal Finance genuinely doesn't overlap with an existing table (confirmed: no income/expense/liability concept exists anywhere in the current schema or in any prior doc — checked `workbook-architecture.md`/`legacy-feature-inventory.md` directly, this is new ground, not a rename).
4. **New entities needed:** `income_events`, `expense_events`, `recurring_expenses`, `liabilities`, `liability_events`, `liability_valuations`, `financial_calendar_items` (Phase 3+), `detailed_portfolio_holdings` (already specified in `migration-plan.md`, just never built — Phase 2 here).
5. **What should remain derived, never a table:** net worth, savings rate, investment rate, cash-flow-statement totals, current liabilities balance (always the latest `liability_valuations` row, never a stored "current balance" field on `liabilities` itself — same discipline as never storing "current value" on `securities`).
6. **How historical data is preserved:** it isn't touched. This is purely additive — no existing row changes shape, no existing query breaks. Even `valuations.frequency` defaults to a value that doesn't change what any current query returns.

---

## I. UX / navigation — recommended IA, with reasoning

Your draft was close; here's what I'd change and why:

```
PORTFOLIO
├─ Overview
├─ Portfolio
├─ Performance
├─ Research
└─ Lab                          (Phase 5 — not yet)

PERSONAL FINANCE                (new)
├─ Cash Flow                    (Phase 3 — income/expenses/savings rate)
├─ Net Worth                    (Phase 3 — balance sheet)
└─ Calendar                     (Phase 3/4 — the checklist from §D)

INVESTMENTS
├─ Accounts
├─ Transactions
└─ Costs

DATA
└─ Data Hub

Settings
```

Changes from your draft, explained:
- **Dropped "Budget" and "Goals" as separate nav items for now.** Both are real, both belong eventually, but neither has a data model yet beyond what `financial_targets` (§B, optional) sketches. Adding nav items before there's a page worth opening behind them is exactly the "dead `href=\"#\"` reads honestly as not built" pattern `implementation-roadmap.md` already uses deliberately for Risk/Simulator/Settings today — I'd rather fold an early "target vs. actual" view into Cash Flow itself than ship two more placeholder pages.
- **Kept Data Hub under its own top-level category**, not nested under Investments — this matches the current, live nav exactly (confirmed: `shell.js`'s `NAV_UTILITIES` already treats Data Hub as a persistent, always-visible utility, not buried in a category) and there's no reason to change something that's already working and already discoverable.
- **Net Worth and Cash Flow as two separate pages, not one**, even though they're closely related — matches your own §4/§5 framing exactly ("What is my portfolio worth?" vs. "What does my investment actually contain?" — the same "different question, different page" instinct that's already why Portfolio/Performance/Allocation are separate pages today, not one mega-page).

---

## J. Implementation roadmap

Re-sequenced against what's actually in the codebase today, not a generic phase list.

### Phase 0 — Architecture foundation (this document)
**Objective:** agree the model above before any table exists. **DB/calc/UI changes:** none. **Risk:** none — this is the checkpoint. **Do NOT build:** anything below until this is confirmed.

### Phase 1 — Weekly valuation workflow
**Objective:** stop daily manual updates; make Sunday check-ins the real cadence.
**DB:** add `frequency` to `valuations` (additive, non-breaking).
**Calc:** none — `scopedPerformance()`/chain-linking already handle irregular observation spacing correctly (confirmed multiple times this session, including for the monthly benchmark data).
**UI:** a lightweight "Weekly Check-in" entry point (could be a Data Hub section, or its own small flow) prompting BPI/Trading212/Cash, writing through the existing `recordValuations()`.
**Dependencies:** none. **Risk:** low. **Do NOT build yet:** the Calendar/checklist table (§D) — track this manually for now; automating "is it Sunday" isn't worth a table until Phase 3's calendar exists anyway.

### Phase 2 — Monthly BPI snapshot
**Objective:** capture fund composition history, not just fund value.
**DB:** `detailed_portfolio_holdings` (already fully specified in `migration-plan.md` §2.6 — build it as documented).
**Calc:** none new yet — composition *comparison* ("did US equity exposure increase?") is a Phase 2.5/3 query over this table once enough monthly snapshots exist to compare; the table is the prerequisite, the comparison view is separate, smaller work once real data exists.
**UI:** Data Hub gains a real commit path for the parser output it already produces (`monthlyFactsheetParser.js`/`holdingsReportParser.js` already work — they currently have nowhere real to write).
**Dependencies:** none on Phase 1. Can run in parallel. **Risk:** low — pure addition, existing pipeline already does the hard parsing work.

### Phase 3 — Personal Finance layer
**Objective:** Cash Flow + Net Worth pages, real income/expense tracking.
**DB:** `income_events`, `expense_events`, `recurring_expenses`, `liabilities`, `liability_events`, `liability_valuations`.
**Calc:** monthly income/expense aggregation, savings rate, investment rate, net worth (Cash + Investments + Liabilities, all already-existing pieces plus the new liability observations).
**UI:** two new pages (Cash Flow, Net Worth) under the new Personal Finance nav category.
**Dependencies:** Phase 1 not required but recommended first — Net Worth's "Cash" figure is more meaningful once weekly check-ins are the live habit. **Risk:** medium — this is genuinely new domain, more design decisions will surface once real data starts flowing (e.g., how to categorize an ambiguous expense) than can be fully anticipated here. **Do NOT build yet:** the Calendar table, Budget/Goals pages, any forecasting.

### Phase 4 — Quant analytics
**Objective:** Alpha/Beta/Sharpe/Sortino/correlation surfaced in the UI.
**DB:** none — `benchmark_history`/`risk_free_rates` already exist.
**Calc:** minimal — `scopedQuantMetrics()` already exists per this session's own Performance-page work; confirm exact current coverage before assuming a full rebuild.
**UI:** the actual Risk page (`information-architecture.md` already scoped this, never built).
**Dependencies:** none new. **Risk:** low — mostly UI work on top of already-real calculation.

### Phase 5 — Portfolio Lab
**Objective:** hypothetical scenarios, never touching real data.
**DB:** `simulation_scenarios` (id, name, positions jsonb, assumptions jsonb) — already scoped in `feature-backlog.md`.
**Calc:** none new — reuses `scopedPerformance()`/quant metrics against synthetic weights instead of real ones (already parameter-driven, confirmed).
**UI:** the Lab page, scenario builder, comparison view.
**Dependencies:** Phase 4 (Lab needs the same risk metrics Phase 4 surfaces, applied hypothetically). **Risk:** medium — biggest single UI build in this roadmap.

### Phase 6 — Monte Carlo / optimisation
**Objective:** probabilistic projections, portfolio optimisation.
**DB:** none anticipated. **Calc:** parametric simulation first (as you said — don't over-engineer); historical bootstrap only once enough real return history exists to bootstrap from. **UI:** extends the Lab. **Dependencies:** Phase 5. **Risk:** highest in this roadmap — genuinely new math, worth its own focused design pass when you get there, not pre-specified now.

---

## Summary of the three decisions that actually need your call before Phase 1

1. **§B — Option 1 vs. Option 2** for how personal cash relates to Portfol.io's existing Cash tracking. I've recommended Option 2 (separate, monthly-grain, bridged at the investment-allocation moment) — confirm or override.
2. **§I — the trimmed nav** (dropped standalone Budget/Goals for now). Confirm, or tell me you want them as real placeholder pages anyway.
3. **§J — phase order.** I sequenced Weekly Valuation (Phase 1) and Monthly BPI (Phase 2) ahead of Personal Finance (Phase 3) because both reuse 100% existing mechanisms and Monthly BPI in particular was already fully designed and just never built — cheapest, lowest-risk wins first. If Personal Finance is what you actually want to see live soonest, say so and I'll resequence.

Nothing else in this document should need a decision before Phase 1 can start — everything else is either already-decided (reused from existing docs) or explicitly deferred with a stated reason.
