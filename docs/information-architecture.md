# Portfolio.io — Information Architecture Proposal

**Status: proposal, not implemented.** Nothing in this document has been built. `daily_prices` is paused mid-testing (schema + Edge Function exist, EODHD confirmed working for the 4 real ETFs) — nothing about pausing it wastes that work; see §13.

**The reframe, in one line:** stop building "Overview + Data Hub + some new pages bolted on" and build the six-section platform below, where every future page has an obvious home before it's built, not after.

---

## 1. Proposed Information Architecture

Your six sections are the right shape. I'm trimming the sub-page count inside each one — not because the content is wrong, but because several of your sub-items are the same information at a different zoom level, and giving each its own top-level page would fragment things that read better together. Marked **Page** / **Tab** / **Drill-down** / **Fold into X** below, with the reasoning.

### PORTFOLIO
| Your item | Verdict | Reasoning |
|---|---|---|
| Portfolio Overview | **Page** (evolves today's `index.html`) | The landing page. Dense, card-based, exactly the existing pattern — KPIs, growth chart, allocation snapshot, health, benchmark comparison all visible without navigating away. |
| Portfolio Detail (Holdings) | **Page** | Needs real table space (position, quantity, avg cost, weight, return, classification per row) — doesn't fit as a card. |
| Performance | **Drill-down from Overview**, not a page | The existing app already has this pattern (`data-drill-type` cards opening a drawer). TWR/XIRR/cumulative/annualised/benchmark comparison is a deeper version of what the Overview card already shows — a drawer, not a new URL. |
| Allocation | **Drill-down from Overview** | Same reasoning — asset class/geography/sector/currency/market-cap/style are dimensions of one allocation view, already the Allocation card's tab pattern today. |
| Risk | **Drill-down from Overview** | Same reasoning — vol/Sharpe/drawdown/correlation/beta/tracking-error/risk-score belongs as a deep-dive drawer off the Overview's health/risk card, not a 5th top-level page. |

**Net: 2 pages, 3 drill-downs.** Reuses the drawer infrastructure already built rather than adding navigation depth for content that's really "tell me more about this card."

### INVESTMENTS
| Your item | Verdict | Reasoning |
|---|---|---|
| Products | **Remove from here** | This is the same concept as Research/Intelligence's "Product Library" — one library, not two. Keeping both invites drift (which one is the "real" product list?). Product Library lives in Research/Intelligence only (§1.4). |
| Transactions, Costs, Accounts | **Pages** (already built) | Unchanged. |
| Valuations | **Page** (already built, missing from your list) | You dropped this from the list but it's a real, distinct, already-built module — the record BPI's manual updates and any non-automated ETF checks go through. Keeping it separate from Transactions is deliberate (Migration Plan §2.5/§2.4) — a valuation is an observation, a transaction is an event. |

**Net: 4 pages, all already built** (Accounts/Transactions/Valuations/Costs) — this section needs the least new work of anything in this proposal.

### SIMULATOR
Matches your proposal directly — **Page**, with Buy/Sell/Rebalance/Add-product/Compare-scenarios/Market-events as controls and states within that one page, not separate pages. This is a genuinely new page (§6 for the audit-backed reasoning).

### RESEARCH / INTELLIGENCE
| Your item | Verdict | Reasoning |
|---|---|---|
| Product Library | **Page** | The real one. Each product's detail view carries everything: overview, factsheet, scorecard, benchmark, historical price chart (from `daily_prices` once live), documentation. |
| Scorecards | **Fold into Product Library** | A scorecard is a tab on a product's detail view, not a page of its own — nobody browses "all scorecards" independent of a product. |
| Benchmarks | **Fold into Product Library** | A benchmark (S&P 500, MSCI World) is just a Product Library entry with `type = 'Index'`. Filter/tag, not a separate page. |
| Market Data | **Fold into Product Library** | Each product's price history is that product's own tab. A standalone "watchlist" page is plausible later but isn't needed to ship this. |
| Research | **Fold into Product Library** (product-level docs) + a small standalone **Methodology** page (philosophy, glossary — from the old Learn module) | "Research" as its own nav item was the vaguest item on your list; splitting it this way gives every piece of content an obvious, singular home. |
| Investor Profile / Investor DNA | **Page** | Genuinely standalone — an interactive tool, not scoped to one product. The best public-showcase feature in the whole audit (§5.2). |

**Net: 2-3 pages** (Product Library, Investor DNA, optionally Methodology) instead of 6.

### OPERATIONS
Your 5 items (Data Hub, Documents, Classification Review, Import History, Data Quality) are **one page**, not five: this is exactly what today's `data-hub.html` already does well — one page, fund-group cards, each showing its own status/categories/review-queue inline. Splintering it into 5 pages breaks a workflow that's currently coherent (upload → classify → review → commit, all visible together). Add tabs/sections inside Data Hub as each of these needs more room, don't add new pages.

### ADMINISTRATION
**One page: Settings**, with sections (Portfolio config, Assumptions, Institutions, Edit-Mode session management, future integrations). Institutions specifically I'd keep as a tab on *Accounts* rather than Settings — it's tightly coupled to Accounts, edited rarely, and doesn't need its own administrative ceremony.

---

## 2. Navigation Structure

**Recommendation: a real persistent sidebar, grouped by these six sections — not the current LogoButton+overlay-drawer.** The overlay pattern was right for a 2-page app (Overview, Data Hub); it doesn't scale to six sections with 12-14 pages inside them. Concretely:

- Sidebar always visible on desktop/tablet (collapsible to icons-only, not fully hidden), a slide-out drawer on mobile — same breakpoint logic the app already has, applied to a persistent element instead of an overlay-only one.
- Six group headers (Portfolio / Investments / Simulator / Research / Operations / Administration), collapsed/expanded per group — this is, concretely, the `nav-group` pattern already sitting unused in the old prototype's code (`renderNav()`), just redesigned in the new visual language.
- Operations and Administration groups render conditionally — present only in Edit Mode (§4), not just visually de-emphasized. A Showcase or Private visitor never sees "Data Hub" or "Settings" in the nav at all.

---

## 3. Public / Private / Edit — already designed, now mapped onto this sitemap

This isn't a new design — `docs/production-architecture.md` §1 already specified Showcase/Portfolio/Edit Mode with a real mechanism (RLS + a time-boxed `edit_sessions` elevation, not a client-side toggle). What's new here is applying it page-by-page:

| Page | Showcase (no login) | Private (logged in) | Edit |
|---|---|---|---|
| Portfolio Overview | Visible, € masked, % visible | Full | — |
| Portfolio Detail (Holdings) | Visible, € masked | Full | Never directly editable (see §4) |
| Performance/Allocation/Risk drill-downs | Visible, % only | Full | — |
| Investments (Accounts/Transactions/Valuations/Costs) | **Not in nav at all** | Full, read-only | Full CRUD |
| Simulator | Open question — see §11 | Full, clones real portfolio | — (simulator never writes to real data at any access level) |
| Product Library, Investor DNA, Methodology | **Fully public** — no personal data touches these at all | Same | — |
| Operations (Data Hub) | Not in nav | Not in nav | Only here |
| Administration (Settings) | Not in nav | Read-only view of own settings | Full |

---

## 4. Portfolio Detail — the one rule that doesn't change

Restating because it's load-bearing and this redesign doesn't touch it: **Holdings stays a computed view, never an editable table.** "Edit Holding" always resolves to a Command against Transactions or Valuations (Buy/Sell/Dividend → transaction; manual mark → valuation), never a direct field edit. This is already how `js/analytics.js`'s live Holdings computation works today (Migration Plan Phase 3) — the redesign changes where this view is *displayed*, not how it's *computed*.

---

## 5. Old `index.html` — Complete Feature Audit

Consolidating everything found across three passes (general audit, `daily_prices`-specific inspection, this one) into the single authoritative table you asked for.

| Feature | Existing implementation | Verdict | New location | Dependencies | Supabase needed | Priority |
|---|---|---|---|---|---|---|
| Deterministic compounding engine (`simulate()`) | Full, correct, well-commented | **Keep** | Simulator | Holdings (live) | none new | ★★★★★ |
| Correlation-aware risk (`portVol`/`corrEst`) | Real diversification modelling, not naive weighted avg | **Keep** | Simulator, Risk drill-down | Product Library (alloc/exposure fields) | `security_details` | ★★★★★ |
| Portuguese capital-gains tax engine (`portTaxRate`, PPR benefit) | Real CIRS brackets + EBF art. 21 cap, needs a freshness check against current law | **Keep, re-verify numbers** | Simulator, Assumptions | Assumptions table | `assumptions` | ★★★★ |
| 9-dimension scorecards (`productScores()`) | Real, coherent weighting | **Keep, redesign visually** | Product Library (tab per product) | Product Library | `security_details` or computed view | ★★★★ |
| `insight()`/`kpi()` UI primitives | Small, reusable, framework-agnostic | **Keep, restyle** | Everywhere (already the pattern in `ui.js`) | none | none | ★★★★ |
| Investor DNA (`PROFILE_Q` → `computeProfileVector` → `generateTop3`) | Full 12-question → 10D → top-3 engine, already in English | **Keep, redesign visually** | Investor DNA page | Product Library only — never real holdings | none new (optional `profile_sessions`) | ★★★★ |
| `daily_prices` + EODHD collector | Schema + Edge Function built and tested this session | **Keep, resume after this restructure** | Product Library (price tab), Investments (feeds Holdings valuation for ETFs) | Market Data pipeline | `daily_prices`, `price_fetch_log` (exist) | ★★★★★ |
| `__spark()` sparkline | Tiny, zero-dependency, works | **Keep as-is** | Product Library price tab | `daily_prices` | none new | ★★★★ |
| Broker comparison/fit engine | Full (`scoreBroker`, `brokerFitScore`, cost calculator) | **Postpone** | Not in your 6-section list — smallest natural fit is a Research sub-page later | Product Library pattern | new `brokers` table | ★★★ |
| Monte Carlo (`monteCarlo()`) | Present, not fully inspected line-by-line, 10k-path per its own UI copy | **Keep, verify then port** | Simulator (advanced tab) | Simulator core | none new | ★★★ |
| Stress-events table (6 historical shocks) | Small, real, static | **Keep** | Simulator "Market Events" | none | small `stress_events` table or JSON in `assumptions` | ★★★ |
| Admin CRUD + Supabase Auth login (`adminLogin`, `checkAdmin`, `adminSaveProduct`) | Working precedent, different Supabase project | **Redesign, not port** | Administration / Edit Mode elevation | Confirms the already-decided `edit_sessions` design | none new — pattern only | reference only |
| Chatbase widget | Third-party embed, no custom logic, no data access | **Remove**, rebuild for real (§8) | Portfolio Overview (widget) or floating | Claude API, server-side | none new | ★★★ |
| Learn module (quizzes/glossary/XP) | Real content, partially bilingual, gamified | **Postpone**, glossary reusable now | Methodology page | none | none new | ★★ |
| Bilingual `tr()`/`_L()` mechanism | Pattern reusable, content is ~90% Portuguese | **Discard content, note the pattern** | N/A — new app is English-only per your instruction | — | — | ★ (pattern), N/A (content) |
| Vera profile photo (base64 avatar) | One real image | **Keep** | Sidebar profile (already used this way today) | none | Supabase Storage or static asset | ★★★ |
| Institution logos (BPI, Vanguard, iShares, etc. — from the *other* old folder) | Real third-party brand assets | **Keep, use carefully** | Product Library issuer badges | none | Storage | ★★★ |
| Historical S&P500/MSCI index price series | **Does not exist** — confirmed twice now, the chart lines are projections, not real historical closes | **N/A — nothing to migrate** | N/A | N/A | N/A | N/A |

---

## 6. Reuse / Redesign / Remove / Postpone — summary

- **Reuse near-verbatim:** `simulate()`, `portVol()`/`corrEst()`, `__spark()`, `insight()`/`kpi()` component logic, the tax engine's structure (not necessarily its exact numbers).
- **Redesign (keep the logic, rebuild the UI):** scorecards, Investor DNA, admin-CRUD-as-pattern, broker engine (later).
- **Remove:** Chatbase embed, all Portuguese UI copy, the second Supabase project.
- **Postpone, not discarded:** broker comparison, Monte Carlo (needs verification), Learn/gamification, stress-events table.

---

## 7. Chatbot — proposed real architecture

Per Platform Architecture's already-decided AI principle (reads validated data, proposes Commands, never writes directly):

```
User question (Portfolio Overview widget or floating panel)
        │
        ▼
Edge Function ("ask-portfolio")
        │  - fetches relevant derived views server-side (Holdings, Performance, Allocation)
        │  - builds a system prompt grounded in that real data
        │  - calls the Claude API with ANTHROPIC_API_KEY (Supabase secret, never frontend)
        ▼
Streamed response back to the browser
```

No API key ever reaches the client. In Private/Edit mode it can read the real portfolio; a Showcase-mode version (if you want one at all) would only ever be allowed to answer from Product Library data, never real holdings — same RLS-enforced boundary as everything else in Showcase Mode. **★★★ priority, unchanged from the Feature Backlog** — nothing here blocks the restructuring.

---

## 8. Recommended implementation order

1. **Close this proposal** — confirm the sitemap (§12) before any code changes.
2. **Navigation shell** — the new persistent sidebar, six groups, conditional Operations/Administration visibility. Everything else hangs off this.
3. **Portfolio Overview + Portfolio Detail** — migrate the existing `index.html` content into the new shell/visual language first (lowest risk — real data, already computed, just needs a new frame).
4. **Investments** (Accounts/Transactions/Valuations/Costs) — move existing pages into the new shell. Least new work in the whole plan.
5. **Resume `daily_prices`** — finish testing the EODHD collector, schedule the cron. Independent of the shell/nav work, can run in parallel with steps 2-4 if you want two threads going.
6. **Product Library** — needs `daily_prices` live (step 5) to be worth building; scorecards port in at the same time.
7. **Investor DNA** — independent once Product Library exists.
8. **Simulator** — the biggest single build, do it once Product Library gives it real products to add.
9. **Operations shell** (Data Hub restyle) + **Administration** (Settings) — lower urgency, existing Data Hub already functions.
10. **Chatbot, Monte Carlo, brokers, Learn** — genuinely later.

---

## 9. Risks / open questions

- **Simulator in Showcase Mode** — not resolved in your prompt either. Three real options: (a) no simulator for anonymous visitors at all, (b) simulator runs against a demo/sample portfolio, (c) simulator runs against the Investor-DNA-recommended portfolios instead of real holdings. I'd lean (c) — reuses infrastructure you're building anyway, never touches real data, and is a more compelling showcase than a generic demo. Needs your decision before Simulator is built, not urgent now.
- **Drill-down vs. dedicated pages for Performance/Allocation/Risk** (§1) is a real design bet — reusing the drawer pattern keeps navigation shallow but caps how much content fits before a drawer feels cramped. Worth a visual prototype before committing, not just this document's word for it.
- **`security_details` table doesn't exist yet** — several "Keep" items in §5 depend on it (scorecards, correlation risk fields, tax brackets per security). Real, not large, but a prerequisite for Product Library, not something to discover mid-build.
- **Tax bracket/PPR numbers need a legal-currency check** before the Simulator ships — the *structure* ported from the old prototype is right, the *numbers* were last verified whenever that prototype was written, not now.

---

## 10. Proposed final sitemap

```
Portfolio.io
│
├── PORTFOLIO
│   ├── Overview            (landing page, Private/Showcase)
│   └── Detail / Holdings   (Private/Showcase, € masked in Showcase)
│       ↳ Performance, Allocation, Risk — drawers off Overview, not pages
│
├── INVESTMENTS                          (Private only, never Showcase)
│   ├── Accounts
│   ├── Transactions
│   ├── Valuations
│   └── Costs
│
├── SIMULATOR                            (Private; Showcase per §11's open question)
│
├── RESEARCH
│   ├── Product Library     (public — includes Scorecards/Benchmarks/Market Data as tabs)
│   ├── Investor DNA        (public)
│   └── Methodology         (public — philosophy + glossary)
│
├── OPERATIONS                           (Edit Mode only)
│   └── Data Hub            (import/classify/review/commit, all in one page)
│
└── ADMINISTRATION                       (Edit Mode only)
    └── Settings            (portfolio config, assumptions, institutions*, edit-session mgmt)

* Institutions actually lives as a tab on Accounts, not here — see §1.
```

**12 real pages** (Overview, Detail, Accounts, Transactions, Valuations, Costs, Simulator, Product Library, Investor DNA, Methodology, Data Hub, Settings), down from the ~24 sub-items across your original 6 sections — not because the content shrank, but because a lot of it is depth-within-a-page (drawers, tabs), not separate destinations.

---

## 11. Status of `daily_prices` (§13 promised above)

Nothing wasted by pausing. The schema (`daily_prices`, `price_fetch_log`, `securities.data_provider_symbol`) and the Edge Function are provider/UI-agnostic — they slot into Product Library's price tab and Investments' Holdings valuation regardless of which sitemap wins. The only pending step was the manual test invoke (curl with `apikey` header) — safe to leave exactly where it is until this proposal is confirmed.
