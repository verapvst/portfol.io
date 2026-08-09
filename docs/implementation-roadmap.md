# PORTFOLIO.IO — MASTER IMPLEMENTATION PLAN

**Status: COMPLETE, awaiting your review.** Nothing in this document is an instruction to start building — per the governing rule below, no implementation resumes until this plan is reviewed and confirmed.

---

## 0. Governing rule

**The current visual design, architecture, and already-built pages are not renegotiable in this pass.** Every decision below assumes:

- light/white background, glass cards, gradient accents, current typography/spacing — unchanged
- current sidebar (open/close at every breakpoint, mobile/tablet overlay+blur, desktop pushes content) — unchanged
- current Showcase/Private concept, current pages (Overview, Portfolio Detail, Performance, Allocation, Accounts, Transactions, Valuations, Costs, Data Hub) — unchanged, kept

```
OLD APP (~/Desktop/Portfol.io/, ~/Downloads/index.html)
        │
        ↓  source of FEATURES, DATA, and BUSINESS LOGIC only
        │
NEW APP (~/Desktop/Portfolio.io/)
        │
        ↓  source of UI, ARCHITECTURE, and DESIGN — authoritative
```

Nothing from the old app's HTML/CSS/layout gets copied. Formulas, data shapes, and feature concepts do, adapted into the new architecture.

---

## A. New App Audit — file by file

Legend: **LIVE** (real Supabase, no mock in the loop) · **LIVE\*** (real Supabase, with a documented, intentional partial-mock exception) · **PARTIALLY BUILT** (real for part of its scope, honestly incomplete for the rest) · **MOCK/FALLBACK** (exists specifically to serve as the Showcase/offline fallback, not a gap) · **PLANNED** (nav entry exists, page doesn't) · **DEAD** (nothing found this pass — see note at the end of this section).

### Shared core (loaded by every page that needs it)

| File | Status | Notes |
|---|---|---|
| `js/utils.js` | LIVE | Pure design tokens, palette, formatting (`fmtEUR`/`fmtPct`), icon set. No Supabase, no mock, no dead code. |
| `js/calculations.js` | LIVE | `costBasisFromTransactions()`, `unrealisedPnL()` — pure functions, called identically by both the mock and live paths. This is the one place the "single calculation layer" principle is already fully real. |
| `js/repository.js` | **MOCK/FALLBACK by design** | `getMockPortfolioData()` is (1) the Showcase/signed-out fallback and (2) — see `analytics.js` below — still the *live* source for `assetClassAllocation`/`regions`/`countries`/`notCountrySpecificWeight` even when signed in, because their real source (Allocations/Detailed Portfolio/Security Classifications sheets) hasn't migrated to Supabase yet. This file also holds the old hand-written historical `valueSeries` with linear interpolation (`real:false` points) — **this interpolated series is never used once you're signed in and the live fetch succeeds** (see Section B). `xirr()` (the Newton-Raphson/bisection solver) also lives here, shared by both paths. |
| `js/analytics.js` | **LIVE\*** | `getPortfolioDataLive()` computes holdings, TWR, XIRR, cost basis/P&L, account/currency allocation live from Supabase. `getPortfolioDataAuto()` is the single entry point every page calls. The 3-field mock exception above is the one honest, documented gap. **This session's fix:** a live-fetch failure while signed in now tags `metadata.source = "mock-fallback-error"` instead of silently returning indistinguishable mock data (previously just a `console.warn`). |
| `js/shell.js` | LIVE | Navigation (just fixed — toggles at every breakpoint, not just mobile/tablet), topbar, generic drill-down drawer, `METRIC_DOCS` (the self-documentation system), `formatMoney()`/`isOwnerMode()` (Showcase/Private masking, derives from real Supabase auth only). Two real bugs fixed this session: `accountDrill`/`currencyDrill` were matching holdings via a hardcoded `"BPI"/"Trading212"` check instead of the real account record — harmless while those drill types were unreachable, broken once Allocation's Account/Currency views made them live. |
| `js/auth.js` | LIVE | Real Supabase email/password auth (`signIn`/`signUp`/`signOut`, session-based). No separate "Owner Access" mechanism exists anywhere anymore (fully removed in an earlier pass, re-confirmed by grep this session). |
| `js/db.js` | LIVE | `ensurePortfolio()`, `findOrCreateInstitution()`, `findOrCreateSecurity()`, `loadAccountsForPortfolio()`, `loadSecurities()` — shared by every CRUD page. The portfolio-duplication race condition (three "My Portfolio" rows created concurrently) is fixed at both the code and DB-constraint level (`0003_portfolio_unique_and_dedupe.sql`). |
| `js/charts.js` | LIVE | Hand-rolled SVG line chart (now renders `real:false` points dashed with a "interpolated between known values" legend note, not silently identical to observed data), donut, and a hex-grid world map (D3 + topojson). No charting library, no dead code. |
| `js/ui.js` | LIVE | Overview-specific renderers (`renderSnapshot`, `renderAllocationSummary`, `renderHoldingsTable`, `renderPortfolioHealth`, `renderInsights`) plus `renderExposure`/`EXPOSURE_GROUPINGS`, which were dormant after Overview's redesign and are now actively reused by the Allocation page — no longer dead code, just moved. |

### Pages

| Page | Status | Notes |
|---|---|---|
| Overview (`index.html` + `js/app.js`) | LIVE | Redesigned to be a summary hub — cards link out to Portfolio Detail/Performance/Allocation rather than duplicating their content. |
| Portfolio Detail | LIVE | Full holdings list, avg. cost basis, unrealised P&L — both via `calculations.js`, verified identical mock vs. live. |
| Performance | LIVE | TWR/XIRR stat tiles, value-over-time chart with range filters, honest "insufficient history" states, honest "benchmark not available" state (no invented benchmark data), and (new this session) the mock-fallback warning banner. |
| Allocation | LIVE | Asset Class (donut), Security, Account (ranked bar lists), Top Concentrations, Geographic Exposure (Country/Region/Currency tabs, restored world map). |
| Accounts / Transactions / Valuations / Costs | LIVE | Real Supabase CRUD. Transactions uses void+replace (never overwrites in place); Valuations and Costs are insert-only by UI convention (no edit modal, matching the "never edit history, only supersede" principle). |
| Data Hub | **PARTIALLY BUILT** | The BPI PDF pipeline (`js/importer/*.js`: `pdfReader`, `classifier`, `monthlyFactsheetParser`, `holdingsReportParser`, `consolidate`, `geoClassifier`) is real and working — it classifies geography automatically via a 5-tier cascade (exact match → pattern → issuer → government bond → honestly Unknown, never guessed) and writes real fee rows (TER, Depositary, Subscription, Redemption) straight into `costs` via Supabase. **What's not wired:** Allocations and Detailed Portfolio import all the way to parsed tables + "Copy to Excel," but there's no Supabase table for either yet (Migration Plan Phase 4/5) — clicking Import surfaces this honestly instead of silently no-oping. **Classification Review** exists only as inline per-row manual classification inside Data Hub's import flow, not the separate reviewable tab the information architecture doc describes. |

### Not built yet (PLANNED — nav entries exist, pages don't)

Risk, Securities, Benchmarks, Market Data, Simulator, Settings — all `href="#"` in `NAV_GROUPS` (`js/shell.js`), by design ("a dead link reads honestly as 'not built yet'").

### Supabase (`supabase/migrations/`, `supabase/functions/`)

| Migration | Status |
|---|---|
| `0001_initial_schema.sql` | LIVE — `portfolios`, `institutions`, `accounts`, `securities`, `transactions`, `valuations`, `documents`, full RLS. |
| `0002_costs.sql` | LIVE — `costs` + RLS. |
| `0003_portfolio_unique_and_dedupe.sql` | LIVE — the race-condition fix above. |
| `0004_daily_prices.sql` + `fetch-daily-prices` Edge Function | **BUILT BUT PAUSED, exactly where left.** Migration ran successfully; Edge Function code is finalized but was never deployed/invoked. Explicitly on hold per standing instruction — not touched this pass, not touched in this plan. |

### Dead code

**None found this pass.** Grepped for `TODO`/`FIXME`/`dead`/`unused`/`not wired`/`not connected` across every `.js`/`.css` file — every hit is either a comment honestly describing a real, intentional gap (documented above) or the `mock`/`fallback` machinery working as designed. The app has stayed clean through each prior pass (Owner Access, old filter-pills CSS, etc. were already fully removed, and re-verified absent here).

### Designed but not built (from `docs/production-architecture.md`, still true)

- **`edit_sessions`** — the real Private-vs-Edit RLS split. Today, "signed in" grants full read+write everywhere; there is no time-boxed elevation yet. The "· Edit" tag on Operations/Administration nav groups is an honest placeholder for this gap, not the real thing.
- **`public_allocation_view` / `public_performance_view` / `public_risk_view` / `public_exposure_view`** — real anon-safe Postgres views for Showcase mode. Today's Showcase is "signed out → client-side masking + `repository.js` fallback," not RLS-enforced at the database level. A determined visitor could still query Supabase directly for anything `anon` currently has grants on — worth checking in the Supabase dashboard directly, independent of this plan.

---

## B. Supabase Data-Flow Trace

The exact path requested:

```
Supabase (valuations table)
        │  .select("*").eq("portfolio_id", portfolioId)     [analytics.js:34]
        ▼
transactionsRaw / valuationsRaw  (raw rows, this session's fetch)
        │  grouped by security_id, sorted by date            [analytics.js:48-54]
        ▼
holdingsRaw[]  { security, accountId, value: latest.value_eur, history: [...] }
        │
        ├─→ twrDriver = the holding with the LONGEST valuation history
        │        │  totalReturnPct from twrDriver.history[first]/[last]
        │        ▼
        │   valueSeries = twrDriver.history.map(v => { date, value: v.value_eur, real: true })
        │                                                     [analytics.js:93-97]
        ▼
data.history.valueSeries   (part of the object getPortfolioDataAuto() returns)
        │
        ▼
performance.js: renderValueChart(data)  — reads data.history.valueSeries directly,
        no hardcoded values anywhere in this file (re-confirmed by full re-read this session)
        │
        ▼
charts.js: renderLineChart(points, …) — draws exactly the points it's given;
        a point with real:false draws dashed, real:true draws solid
```

**`calculations.js` is not actually part of this specific path** — it only supplies `costBasis`/`unrealisedPnL` per holding, a separate branch of the same `getPortfolioDataLive()` function. Worth naming since the requested trace assumed it sat between `analytics.js` and `performance.js`; in the current architecture it doesn't, and that's fine — it's not supposed to.

### Does this update in real time on refresh?

**Yes, provided two conditions hold:** you're signed in (`currentUser()` truthy) *and* the live fetch succeeds. Every value in the chain above is re-fetched fresh on every `getPortfolioDataAuto()` call — nothing is cached beyond the current page load, no hardcoded historical values exist in the live path at all (only `repository.js`'s mock has those, and the mock is provably unreachable once both conditions above hold — see the `if (window.db && currentUser())` gate in `analytics.js`).

**Where it can silently break** (both already existed; the second is what this session's fix targets): (1) you're viewing while signed out — Showcase always shows the mock, correctly, by design; (2) you're signed in but the fetch throws for any reason (a malformed row, an RLS mismatch, a transient network error) — this now surfaces as the honest banner on Performance instead of silently rendering the old mock series with no explanation.

### The `twrDriver` question — needs your decision, not an assumption

You flagged this precisely right: **"a security com a maior história de valuations" is a real architectural simplification, not full multi-holding TWR.** Concretely:

- Today it degenerates correctly to "just show BPI Dinâmico's own trajectory" because it's the only holding with more than one valuation — every other holding (bought same day, one valuation each) can never win the "longest history" comparison, so the code never actually needs to chain-link anything yet.
- **This stops being correct the moment a second holding accumulates real interim valuation history.** At that point, "longest history wins" would either (a) silently switch the whole portfolio's TWR to track a single different holding once its history overtakes BPI Dinâmico's, or (b) keep showing BPI Dinâmico's return alone even though it's no longer the full picture — neither is real portfolio-level TWR.
- **Real fix, not yet built:** true TWR chain-links sub-period returns across *all* holdings, weighted by each holding's share of total portfolio value at the start of each sub-period. This needs a valuation observation for every holding on (or near) the same set of dates to compute clean sub-periods — which is exactly the kind of thing worth deciding now that you're entering real historical data for more than one security.

**This needs your call before Performance/Risk go further:** keep the current single-driver simplification a while longer (fine as long as only one holding has real interim history), or prioritize real multi-holding chain-linked TWR now. Flagging this explicitly rather than quietly building more on top of the simplification.

**Decision taken this session (autonomous pass): kept the single-driver simplification, unchanged.** You asked me to inspect the actual current data situation before deciding rather than assume — I couldn't do that this pass, honestly: inspecting live valuation counts per holding needs an authenticated Supabase session, and this pass ran without your session token. Rather than guess at the data or rebuild TWR on an unverified premise, I left `twrDriver` exactly as it was and did not build Risk or anything else on top of it. **Next time you're here with a live session, the one-question check that resolves this:** in Valuations, does any holding other than BPI Dinâmico now have 2+ dated observations? If no — the simplification is still correct today, no rebuild needed yet. If yes — that's the trigger to prioritize real multi-holding chain-linked TWR before Risk goes further, per your own rule above ("never knowingly build a major new feature on top of an architectural shortcut already invalidated by the current data").

---

## C. Legacy Feature Inventory — complete

Full detail now lives in **`docs/legacy-feature-inventory.md`**, built from both old sources (`~/Downloads/index.html`, already covered by the original `docs/feature-backlog.md`, plus a deep audit of the fuller `~/Desktop/Portfol.io/` app — `js/engine.js`/`js/views.js`/`database.json`, which turned out to be the richer source: a real 18-product/10-broker database and already-modularized calculation engine, not a single-file prototype). Headlines:

- **The real product database schema** (18 products, 10 brokers, full field list) is now concretely specified — informs the Supabase `securities`/`security_details`/new `brokers` table design directly.
- **Your Cost Engine question is answered.** TER in the real data is always small (0.07%–2.22% annual). The "~19-20%" figures are **Cost Drag** — `(fees ÷ fee-free wealth) × 100`, a cumulative lifetime-impact metric — and a ~1.0–1.3% TER product held 25-30 years lands right at 18-20% Cost Drag in the old engine's own math. These are two different, both-worth-keeping metrics, not the same number twice.
- **Genuinely new, not in the original backlog**: a full switching-cost engine ("cost of changing your mind" — exit fees, capital-gains tax at the switch-year bracket, PPR early-exit warnings), a 10-broker comparison/recommendation system, a Strategy Lab A/B portfolio comparator, a rule-based portfolio-diagnostics narrative generator, and a Learn & Earn gamification module.
- **Confirmed placeholder, not real data**: scenarios and stress-test presets are hardcoded in the old app's Excel parser, not actually read from the workbook — needs a real schema decision before porting, not a straight copy. Benchmark comparison uses an approximated `+2.5%` offset, not real index data.

---

## D. Single Source of Truth — target architecture

```
                   ┌───────────────┐
                   │   Supabase    │   ← source of truth for real portfolio data
                   └───────┬───────┘
                           ↓
                    repository.js  ← mock/Showcase fallback ONLY (3 fields still
                           │           live here honestly, see Section A)
                           ↓
                    calculations.js ← pure, shared formulas (cost basis, P&L, [future: TWR/XIRR])
                           ↓
                      analytics.js  ← the one seam every page reads through
                           ↓
                            UI
```

Already true today: the mock never silently substitutes for real data in a signed-in session where the fetch succeeds (confirmed in Section B). Already fixed this session: it no longer does so silently even when the fetch *fails* — that failure is now visible. Not yet true: `assetClassAllocation`/`regions`/`countries` are Supabase-shaped work that hasn't happened yet (Migration Plan Phase 4/5), not a violation of this principle — it's the honestly-labeled exception described in Section A.

---

## E. Documentation cleanup — plan only, nothing deleted yet

Target `docs/` structure once this phase is done:

```
docs/
├── README.md                      (new — index of what's where)
├── information-architecture.md    (keep — still authoritative)
├── production-architecture.md     (keep — Showcase/Private/Edit model, still the target)
├── platform-architecture.md       (keep — the constitution)
├── migration-plan.md              (keep — Supabase schema, module by module)
├── legacy-feature-inventory.md    (new — replaces/absorbs feature-backlog.md once complete)
├── implementation-roadmap.md      (this document)
├── product-database.md            (new — once the schema is decided in Section C's follow-up)
├── data-architecture.md           (new — once Section D's diagram needs more than one page)
├── metric-definitions.md          (new — once METRIC_DOCS outgrows living in shell.js, per Migration Plan §4)
└── workbook-architecture.md       (keep for now — still real history of the source spreadsheet)
```

`feature-backlog.md` gets folded into `legacy-feature-inventory.md`, not deleted outright, until the new document is confirmed to carry everything useful from it. **No file gets removed in this pass** — this is a target shape, not a to-do list executed yet.

---

## F. Implementation order (confirmed, not started)

Matches the phase order you specified. Not resuming Risk or any other page build until this whole document is reviewed and confirmed.

1. **Audit & Recovery** — this document (in progress)
2. **Data foundation** — resolve the `twrDriver` decision (Section B), confirm Supabase read/write end-to-end with your real session, establish the product database shape (pending Section C)
3. **Shell** — done this session (toggleable sidebar, all breakpoints)
4. **Existing pages** — Risk is next once Phase 2 lands (Risk needs Section B's TWR decision resolved first — its own volatility/Sharpe/drawdown math depends on the same valuation-history question)
5. **Research** (Securities → Product Detail → Scorecard → Costs → Benchmarks → Market Data)
6. **Investments** — already live, revisit only if Phase 2 changes their contract
7. **Simulator** (Investor DNA → recommendations → Portfolio Builder → simulation → Monte Carlo → Strategy Lab → switching-cost tool → broker comparison) — see `docs/legacy-feature-inventory.md` for exactly what's being ported into each
8. **Operations** (Data Hub completion, real Classification Review, Administration, Edit permissions/`edit_sessions`)
9. **Polish** (mobile, accessibility, loading/empty/error states, performance, security, cleanup)
10. **Remove legacy** — only after everything above is confirmed stable

---

## G. Autonomous implementation pass (this session) — what actually shipped

Per your "stop auditing, start building" directive. Concrete, not another plan:

- **Product database, Supabase-backed** (`supabase/migrations/0005_product_database.sql`, `0006_seed_products_and_brokers.sql`, not yet run against your live database — you need to paste both into the SQL Editor). `security_details` extends `securities` 1:1, per the Migration Plan's already-decided convention — not a parallel `products` table, not static JSON. `brokers` is standalone. Both `authenticated`-only for now (see the migration's own RLS comment for why anon access needs the `public_*` views project first, not solved this pass). Seeded with the real 18 products / 10 brokers from `~/Desktop/Portfol.io/database/database.json`, transcribed verbatim (verified column-by-column against the source file) and translated to English. The 4 products matching your actual held ETFs (UETW/AVWS/XDEQ/SPYM, by ISIN) attach to their existing `securities` row; the other 14 get a new one. **BPI Dinâmico has no 1:1 match in this dataset** — none of the 18 legacy products is literally that fund — so it has no `security_details` row. Honest gap, not an oversight.
- **Securities** (`products.html`/`js/products.js`) and **Product Detail** (`product-detail.html`/`js/product-detail.js`) — wired to the nav placeholder that already existed at `js/shell.js`'s Research group. Search + type filter, "Held" badge (a real `transactions` check, not inferred), star rating, data-quality badge. Detail page: costs, an interactive Cost Drag calculator (5/10/20/30y), performance/risk stats, calendar-year returns, allocation/exposure bars (reusing Allocation's own `.bar-row` primitive), Portuguese tax brackets, philosophy and provenance. Supabase-only, no mock fallback — signed-out visitors see a sign-in prompt, not fabricated products (same simplification as the rest of the app today; real Showcase access is the same future `public_*`-views work as above).
- **`costDrag()`** (`js/calculations.js`) — the TER-vs-cumulative-cost-drag distinction your directive asked for, as a pure function: `((1+gross)^n − (1+gross−TER)^n) / (1+gross)^n × 100`, computed from each product's own assumed gross return and TER over a chosen horizon. Never a flat "~20%" constant.
- **Interpolation/real-data wording** — reviewed, not changed. The live Supabase path already tags every point `real:true` unconditionally (`analytics.js`'s `getPortfolioDataLive()`); interpolation (`real:false`, dashed on the chart) only ever happens in `repository.js`'s Showcase mock. This was already correct and already clearly worded from an earlier pass ("- - - interpolated between known values", the mock-fallback warning banner) — nothing needed changing.
- **TWR decision** — not changed, see Section B above for why and what to check next time you're signed in.
- **Cache-busting** bumped to `v=53` on every page (new JS/CSS added this pass).
- **Nothing deleted.** Legacy apps/docs untouched.
