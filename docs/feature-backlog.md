# Portfolio.io — Feature Backlog (from the old prototype audit)

**Living document**, not frozen architecture like the other four docs in this folder — this one is expected to change as each row gets built, one piece at a time. Source: the full audit of `~/Downloads/index.html` (the old "Wealth Decision Engine" prototype), reorganized around the three-universe model agreed on 2026-08-07.

## The three universes

```
                 SUPABASE
                     │
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
   MY PORTFOLIO   PRODUCT LIBRARY  MARKET DATA
       │             │             │
       └─────────────┼─────────────┘
                     ↓
                ANALYTICS
                     │
          ┌──────────┴──────────┐
          ↓                     ↓
     REAL PORTFOLIO         SIMULATOR
          │
          ↓
   PUBLIC SHOWCASE
```

- **My Portfolio** — real, private data. Accounts, Transactions, Valuations, Holdings, Performance, Costs, Risk, Allocation. Already built (Migration Plan Phases 1-3).
- **Securities** — data about products, held or not. ETF/Fund/Index/Stock facts, historical prices, scorecards, classification. Can be public — this is the part of the old prototype worth the most, and none of it touches your real holdings.
- **Simulator** — a virtual layer: `My Portfolio + Securities → Simulation`. Never writes to the real ledger.

Market Data feeds all three (a product's live price, my holding's current value, and the simulator's starting point are the same underlying fact, read three ways).

---

## Backlog

Columns match what you asked for: **Feature → Existing code → Dependencies → Supabase table(s) → New module → Priority**.

### Market Data

| Feature | Existing code (old prototype) | Dependencies | Supabase table(s) | New module | Priority |
|---|---|---|---|---|---|
| Automated daily ETF pricing | `loadPriceHistory(id)`, `__spark()` sparkline, `sbGet()` REST pattern — tooltip confirms Alpha Vantage, once-a-day | A market-data API (re-verify Alpha Vantage or pick an alternative — see audit §1) + a scheduler (Supabase Edge Function + `pg_cron`, or a GitHub Action) | **New** `daily_prices` (`security_id`, `date`, `price`, `change_pct`) | Not a page — a background job. Feeds Securities + Performance | ★★★★★ |
| BPI (private product) valuations | N/A — already the right model | None new | `valuations` (already built) | Valuations page (already built) | done — no change needed, just don't force Alpha Vantage onto these |

### Securities

| Feature | Existing code | Dependencies | Supabase table(s) | New module | Priority |
|---|---|---|---|---|---|
| Extended product metadata (issuer, domicile, benchmark, TER, tax brackets, allocation %, geo exposure) | `PRODUCTS`/`products_app` shape — 18 real products already populated | none | Extend existing `securities` (has `isin`/`domicile`/`benchmark` already) + **new** `security_details` for fields not yet in schema | **New** `products.html` (list) + product detail view | ★★★★★ |
| "Held by me" vs "Research only" | none directly — new framing from this conversation | Securities table above | none new — computed: `exists(select 1 from transactions where security_id = ...)` | Securities page, filter/badge | ★★★★ |
| Scorecards (9-dimension, 0-100) | `productScores()` — costs/tax/diversification/liquidity/transparency/scale/efficiency/risk/return | Securities table, Daily Prices (for vol/return-based dimensions) | Computed on read (Intelligence) — optionally cached in a `security_scorecards` view | Product detail page | ★★★★ |
| Scorecard documentation ("every score explains itself") | none — ties to the already-decided `metric_definitions` concept (Migration Plan §4) | Scorecards row above | `metric_definitions` (already scoped, not yet built) | Same popover pattern already used for KPIs on Overview | ★★★★ (bundle with Scorecards, not separate work) |

### Simulator

| Feature | Existing code | Dependencies | Supabase table(s) | New module | Priority |
|---|---|---|---|---|---|
| Clone real portfolio into a sandbox; buy/sell/rebalance/swap/new-assumptions without touching the ledger | `simulate()` (deterministic compounding), `portVol()`/`corrEst()` (correlation-aware risk), `portReturn()`, `normWeights()`, full PT tax-bracket engine (`portTaxRate`, PPR benefit) | My Portfolio's Holdings view (already built), Securities (to add a product not currently held) | None written to — simulator state is session-local by design | **New** `simulator.html` | ★★★★★ |
| Save named scenarios (Base Case, More Equities, Add Small Cap Value, 80/20, "sell BPI?", "€500/month?") | none directly — `STATE.portfolioB`/comparator hints at two-scenario compare, not named multi-save | Simulator above | **New** `simulation_scenarios` (`user_id`, `name`, `positions` jsonb, `assumptions` jsonb, `created_at`) | Simulator page, "save scenario" action | ★★★ |

### Investor DNA / Recommendation Engine (public-safe)

| Feature | Existing code | Dependencies | Supabase table(s) | New module | Priority |
|---|---|---|---|---|---|
| 12-question profiling → 10D Investor DNA → Top-3 personalised portfolios, reasoning + trade-offs | `PROFILE_Q`, `computeProfileVector`, `scoreProduct`, `buildOneStrategy`, `computeSuitability`, `generateTop3`, `buildReasoning`, `buildInsights` — already in English | Securities (operates only on the product universe — never reads real holdings, which is exactly what makes it public-safe) | None required — stateless questionnaire. Optional `profile_sessions` if you want to persist visitor answers | **New** public page (`discover.html`, or a tab on Securities) | ★★★★ |

### Events

| Feature | Existing code | Dependencies | Supabase table(s) | New module | Priority |
|---|---|---|---|---|---|
| Portfolio timeline (buy/sell/dividend/valuation/contribution) | none directly reusable as code — maps conceptually to existing tables | Transactions + Valuations + Costs (already built) | None new — a `union`/view over existing tables, ordered by date | Timeline view, on Overview or its own page | ★★★ |
| Market events (ECB, Fed, earnings, economic calendar) | **none found in the audit** — this part doesn't exist anywhere in the old prototype | A new external API (not yet chosen) | **New** `market_events` | Same Timeline view, second event type | ★★ — genuinely new work, not a migration |

### Chatbot

| Feature | Existing code | Dependencies | Supabase table(s) | New module | Priority |
|---|---|---|---|---|---|
| Real AI portfolio assistant ("why did my portfolio fall today?", "what's my US exposure?") | **none reusable** — old version is a Chatbase embed with no custom logic, no data access | Platform Architecture's AI principle (reads validated data, proposes Commands, never writes — already decided, not new); ideally Simulator + Securities exist first for richer answers | None new — reads existing derived views | A chat surface using the Claude API directly, not Chatbase | ★★★ |

---

## Suggested execution order

1. **Daily Prices** — highest leverage, smallest surface area, everything else in Securities/Simulator gets better once real prices exist.
2. **Securities** (extended `securities` fields + the list/detail page) — Daily Prices needs somewhere to attach to; this is that somewhere.
3. **Scorecards** — cheap once Securities exists, mostly porting `productScores()`.
4. **Simulator** — the biggest single feature, but the math is close to a direct port; do this once Securities gives it real products to add.
5. **Investor DNA / Recommendation Engine** — independent of the above once Securities exists; good candidate to build in parallel if you want two threads going.
6. **Portfolio Timeline, Saved Scenarios, Market Events, real Chatbot** — smaller, later, none of them block anything else.

Nothing here has been built yet. This is the plan, not the work.
