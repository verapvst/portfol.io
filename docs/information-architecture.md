# Portfolio.io — Information Architecture

**Status: CONFIRMED (2026-08-08), not implemented.** This supersedes the earlier "proposal" version of this document — refined and approved with one explicit correction: Performance, Allocation and Risk are full pages, not drawers off Overview. Nothing below has been built. `daily_prices` remains paused exactly where it was (schema + Edge Function exist, EODHD confirmed working for the 4 real ETFs, manual test invoke still pending) — see §7.

**The governing principle, restated because it's the reason this document exists:** Portfolio.io is a portfolio platform first, a data-management tool second. The old structure (Overview + Data Hub) inverted that — everything read as "the dashboard, plus some admin tooling." This map fixes the inversion: Portfolio and Research are what a visitor sees; Investments, Operations and Administration are how you keep them true.

---

## 1. The two universes, not "public vs. private"

Restating your own framing because it's the correct one and shouldn't get lost in the page map below: this is **one application**, not three products stapled together.

```
SHOWCASE  →  PORTFOLIO (Private)  →  EDIT
```

- **Showcase** — `vst.portfol.io`, no login. Same visual experience as Private, with monetary amounts, account identity and transaction detail removed — never a separate "public site."
- **Private** — logged in. Everything Showcase shows, plus € values, account balances, transactions, valuations, costs, detailed P&L.
- **Edit** — a time-boxed elevation *within* a Private session (the `edit_sessions` mechanism already specified in `docs/production-architecture.md` §1.3 — real re-authentication, 30-minute expiry, enforced by RLS, not a client-side flag). Not a separate login, not a separate app.

Nothing new to design here — this section exists only to confirm the already-decided mechanism now applies uniformly across the full sitemap below, not just to Overview.

---

## 1.5. The interaction system — one vocabulary, applied everywhere

**14 pages does not mean 14 isolated experiences.** Every page in §2 below is built from the same small set of patterns, never a bespoke one-off:

- **Navigation** → pages. The sidebar's only job.
- **Page** → tabs / sections. A page can subdivide, but a tab never gets its own URL/nav entry.
- **Cards** → drill-down. A summary tile that opens more detail without leaving the page.
- **Drawer / modal** → quick detail or edit. Never a full page transition for "tell me more" or "add one record."
- **Product** → product-specific tabs (Overview/Scorecard/Performance/Risk/Allocation/Market Data/Documents) — one component, reused for every entry in Product Library, never a bespoke page per product.
- **Data Hub** → Import → Review → Classification Review → Commit, all inside one page, per §2's Operations section.
- **Simulator** → Scenario → Results → Comparison — one flow, whether it started from Investor DNA (Showcase) or a cloned real portfolio (Private).

### The rule that matters most in the whole application

Every page, regardless of which of the 14 it is, obeys exactly this matrix — no page defines its own access logic:

| Mode | Read | Financial values | Write | Import |
|---|---|---|---|---|
| **Showcase** | Public/sanitised | ❌ | ❌ | ❌ |
| **Private** | Full | ✅ | ❌ | ❌ |
| **Edit** | Full | ✅ | ✅ | ✅ |

Concretely: a page component never asks "am I on the Showcase version of Overview or the Private version" — it asks "what mode is the current session in" once, and every page answers from the same table. This is what `edit_sessions` + RLS already enforce server-side (§1) — this matrix is the client-side mirror of that same rule, not a second, separate one.

---

## 2. Complete page/module map

Every row answers your eight questions at once: **Type** covers page/tab/drawer; **Access** covers admin-only/private/public in one column since they're the same three-tier system (Showcase/Private/Edit); the last two columns cover Supabase dependency and legacy reuse.

### 01 — Portfolio *(the product — what a visitor sees first)*

| Item | Type | Access | Supabase table/view | Legacy functionality reused |
|---|---|---|---|---|
| **Overview** | Page (landing) | Showcase (% only) / Private (full €) | Live computation (`analytics.js`): `transactions`, `valuations`, `securities`, `accounts` | `kpi()`/`insight()` component patterns |
| **Portfolio Detail** | Page | Showcase (structure + %, no €/cost-basis) / Private (full, incl. avg. cost, unrealised P&L) | Computed Holdings view (Migration Plan §3.1) — never a stored table | none from old prototype (already built, live) |
| **Performance** | Page | Showcase (%, TWR/XIRR/cumulative, no € growth) / Private (full, € included) | `valuations` (TWR), `transactions` (XIRR cash flows); benchmark line needs `daily_prices` for the chosen index | Old prototype's benchmark-comparison chart pattern (`viewBenchmarks()`), not its data |
| **Allocation** | Page | Showcase = Private (ratio-based, nothing to mask) | Asset-class split: live from `securities.asset_class`. Geography/sector: still `repository.js` until Migration Plan Phase 4/5 lands `Allocations`/Detailed Portfolio in Supabase | Allocation tile patterns from `viewDashboard()` |
| **Risk** | Page | Showcase = Private (ratio-based) | **Not computed anywhere yet** — blocked on Assumptions + Benchmark History (Migration Plan §3.5, Phase 5) | `portVol()`/`corrEst()` — direct, high-value port |

Every metric on these five pages carries the "What is this?" popover (definition/formula/source/methodology/data used/last updated) — this is `metric_definitions` (Migration Plan §4), not new scope, just applied consistently here for the first time across a whole section instead of one KPI at a time.

### 02 — Investments *(where you manage the data — never Showcase)*

| Item | Type | Access | Supabase table/view | Legacy functionality reused |
|---|---|---|---|---|
| Accounts | Page | Private, Edit for writes | `accounts`, `institutions` | none (already built) |
| Transactions | Page | Private, Edit for writes | `transactions` | none (already built — own void/replace pattern) |
| Valuations | Page | Private, Edit for writes | `valuations` | none (already built — insert-only) |
| Costs | Page | Private, Edit for writes | `costs` | none (already built — insert-only) |

Unchanged rule, restated because it's load-bearing: **Holdings is never directly edited.** Every one of these four pages is where a Buy/Sell/Dividend/Valuation/Fee actually gets recorded; Portfolio Detail only ever displays what falls out of them.

### 03 — Research *(the part worth showing off)*

| Item | Type | Access | Supabase table/view | Legacy functionality reused |
|---|---|---|---|---|
| **Product Library** | Page, with internal tabs per product (Overview / Scorecard / Performance / Risk / Allocation / Market Data / Documents) | Fully Showcase — no personal data touches this section at all | `securities` (extended with a new `security_details` table), `daily_prices`, `security_classifications` | Heaviest reuse in the whole audit: `productScores()` (Scorecard tab), the product metadata shape, `__spark()` (Market Data tab), `viewComparison()`'s sortable/filterable table, `viewDatabase()` |
| **Benchmarks** | Page (thin — a filtered view over Product Library's own component, `type = 'Index'`) | Showcase | Same tables as Product Library | `viewBenchmarks()`'s comparison-chart pattern |
| **Market Data** | Page (thin — an aggregate/watchlist across every tracked security's latest price, distinct from one product's own price tab) | Showcase | `daily_prices`; `price_fetch_log` visible Edit-only (it's an ops log, not visitor content) | `__spark()`, `loadPriceHistory()` |
| **Simulator** | Page | Private (clones real Holdings) / Showcase — open question, see §5 | Reads Holdings (Private) or, if Showcase is enabled, Investor-DNA output instead; Product Library for "add a product"; writes nothing to real Data (optional `simulation_scenarios` if you want saved scenarios) | `simulate()`, `portVol()`, `portTaxRate()`, `normWeights()` |

**One deliberate change from your list, flagged rather than silently made:** Investor DNA isn't its own page in this version — it becomes **Simulator's entry point for a first-time or Showcase visitor** ("answer 12 questions → get 3 recommended portfolios → open one in the Simulator to explore further"). A logged-in Private session skips straight to cloning the real portfolio instead. This uses the same infrastructure either way and gives the DNA engine a natural landing spot instead of being an island. Tell me if you'd rather it stay a fully separate page — easy to split back out.

### 04 — Operations *(behind the scenes — Edit only)*

| Item | Type | Access | Supabase table/view | Legacy functionality reused |
|---|---|---|---|---|
| Data Hub | Page | Edit only | Existing Costs write path; future `detailed_portfolio_holdings`/staged-import tables (Migration Plan §2.11) | none (already built, real) |
| Classification Review | **Tab within Data Hub**, not a separate page | Edit only | `security_classifications` | Already built exactly this way today (`unclassifiedBlockHTML`) — keeping it as a tab, not splitting it out, per the same "don't fragment a working flow" reasoning as the original Operations consolidation |

### 05 — Administration *(only you)*

| Item | Type | Access | Supabase table/view | Legacy functionality reused |
|---|---|---|---|---|
| Settings | Page, with tabs: **General** (portfolio config, assumptions), **Integrations**, **User & Access** | Edit only (read-only glimpse in Private, e.g. seeing your own currency setting) | `portfolios`, `assumptions`, `auth.users`, `edit_sessions` | `SCENARIOS`/tax-bracket constants — move from hardcoded JS into the `assumptions` table, don't keep them as code |

Same reasoning as Operations: three small admin concerns collapse into tabs of one page rather than three routes nobody bookmarks separately.

---

## 3. Net page count

**14 real pages**: Overview, Portfolio Detail, Performance, Allocation, Risk, Accounts, Transactions, Valuations, Costs, Product Library, Benchmarks, Market Data, Simulator, Data Hub, Settings.

(That's 15 listed — Settings' three tabs count as one page. Classification Review is a tab, not counted separately.)

---

## 4. Feature audit and reuse summary

Unchanged from the previous version of this document — still the authoritative table, nothing in this round's refinement touches it:

- **Reuse near-verbatim:** `simulate()`, `portVol()`/`corrEst()`, `__spark()`, `insight()`/`kpi()` components, the tax engine's structure.
- **Redesign (keep logic, rebuild UI):** scorecards, Investor DNA (now folded into Simulator, §2), admin-CRUD-as-pattern, broker engine (later).
- **Remove:** Chatbase embed, all Portuguese UI copy, the second Supabase project.
- **Postponed, not discarded:** broker comparison, Monte Carlo (needs verification), Learn/gamification, stress-events table.
- **Confirmed nonexistent, nothing to migrate:** real historical S&P 500/MSCI index price series — the old chart lines were always projections.

Full per-feature table (implementation, verdict, dependencies, priority) is unchanged from the prior pass — ask if you want it reprinted here rather than cross-referenced.

---

## 5. Still open — needs your call before it blocks anything

- **Simulator in Showcase mode.** My recommendation stands: clone the Investor-DNA-recommended portfolios rather than a generic demo or nothing at all. Not urgent — only blocks Simulator itself, which is late in the build order anyway.
- **Investor DNA as Simulator's entry point vs. its own page** (§3's flagged change) — confirm or revert.

---

## 6. Recommended implementation order

Unchanged in spirit from the prior version, re-sequenced for the confirmed 14-page structure:

1. **Navigation shell** — persistent sidebar, five groups (01-05), Operations/Administration rendered only in Edit mode.
2. **Portfolio section** — Overview first (migrate existing content into the new shell/visual language), then Portfolio Detail, then Performance/Allocation/Risk as their own pages (all mostly real data already, lowest risk).
3. **Investments section** — move the four already-built pages into the new shell. Least new work in the whole plan.
4. **Resume `daily_prices`** — finish the paused EODHD test, schedule the cron. Can run in parallel with 2-3.
5. **Research: Product Library** — needs `daily_prices` live to be worth building; Scorecards/Benchmarks/Market Data tabs land with it.
6. **Research: Simulator** (incl. Investor DNA entry flow) — the biggest single build; do it once Product Library gives it real products.
7. **Operations, Administration** — lower urgency; Data Hub already functions today under the old shell.

---

## 7. Status of `daily_prices`

Unchanged: nothing wasted by pausing. Schema and Edge Function are page-map-agnostic — they feed Product Library's Market Data tab and Investments' Holdings valuation regardless of which section owns the page. Pending step was the manual test invoke (curl with the `apikey` header) — resume whenever this document is done informing the build.
