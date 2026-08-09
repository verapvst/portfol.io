# Portfolio.io — Legacy Feature Inventory

**Living document**, same status as the `feature-backlog.md` it replaces (kept alongside it for now, per `docs/implementation-roadmap.md` §E — nothing gets deleted until this is confirmed to carry everything useful).

Two old sources, both audited, both feature/data references only — **never a UI reference**:

1. **`~/Downloads/index.html`** — a single-file prototype ("Wealth Decision Engine," ~3,687 lines). First audited into the original `feature-backlog.md`.
2. **`~/Desktop/Portfol.io/`** — a fuller, separately-modularized old app (`js/engine.js` 1,348 lines, `js/views.js` 1,281 lines, `js/app.js` 361 lines), Excel-driven via `database/Portfol.io_Master_Database.xlsx` → `parser.py` → `database.json`. This turned out to be the richer source — genuinely structured code with a real 18-product/10-broker database, not a single-file prototype. Most rows below cite this one; rows citing the Downloads prototype are marked.

Both are superseded, unmaintained, and visually a completely different (older) design. Nothing about their CSS, layout, or navigation is reused anywhere.

---

## The real product database (from `~/Desktop/Portfol.io/`)

Source of truth was `Portfol.io_Master_Database.xlsx`, 8 sheets joined by `Product_ID`, converted by `parser.py` into `database.json`. This is the concrete shape a future Supabase product schema should absorb:

- **18 real products** — 6 ETF, 5 Fundo (BPI mutual funds), 5 PPR, 2 Seguro/Unit-Linked.
- **10 real brokers** — XTB, Trading 212, Trade Republic, IBKR, DEGIRO, Lightyear, Scalable Capital, Saxo, Freedom24, Revolut.
- **4 scenarios** (conservador/base/otimista/custom) and **6 stress tests** (2008 GFC, COVID, classic bear, stagflation, high rates, global recession) — **not actually sourced from the Excel workbook**; `parser.py` hard-codes both because the workbook's `FACT_SCENARIOS` sheet has a different shape than the app needs. Needs a real schema decision before porting, not a straight copy.

**Per-product fields**: identity (`name`, `isin`, `domicile`, `issuer`, `benchmark`, `sfdr`, `launched`), a `quality` provenance flag (`Real`/`Parcial`/`Estimado` — worth keeping as a trust column, not just the numbers), costs (`ter`, `riy`, `mgt`, `dep`, `red`, `aum`), performance (`p1`/`p3`/`p5`, `vol`, `sharpe`, `sortino`, `beta`, `te`, `mdd`, `alpha`, `stars`, full annual-return history), allocation/exposure (`alloc.{stocks,bonds,other}`, `exp.{us,eu,em}`, `hold`, `conc`), and tax (`tax.b` — a **4-element array** of PT capital-gains rates by holding-period bracket, `tax.ded` for PPR entry deduction, `tax.eff` 1–10 score).

**Per-broker fields**: regulator, deposit protection, custodian, six fee types, six 1–10 sub-scores (tax simplicity/beginner/advanced/cost/safety/UX), pros/cons.

---

## Product Intelligence

| Feature | What it does | Source | Real data? | Keep/Adapt/Drop | New location |
|---|---|---|---|---|---|
| Product database (18 products) | Full ETF/Fund/PPR/Insurance metadata, costs, performance, allocation, tax | `database.json` via `parser.py` (Portfol.io) | Real | **Keep** | Research → Product Library. Schema above informs `security_details` |
| Broker database (10 brokers) | Regulator, protection, fees, 6 sub-scores, pros/cons | `database.json` (Portfol.io) — **not in the original feature-backlog at all** | Real | **Keep** | New `brokers` table — no equivalent exists yet anywhere in the current app or plan |
| TER | Simple weighted-average cost across portfolio slices | `analyze()`, `engine.js:` `ter=slices.reduce(...)` (Portfol.io) | Real | **Keep** | Cost Engine — the small annual input number |
| **Cost Drag (≠ TER)** | Cumulative lifetime impact: `(fees ÷ wealth-if-fee-free) × 100`, compounded over the horizon | `analyze()`'s `costDrag` calc (Portfol.io) | Real, computed | **Keep — and label distinctly from TER** | Cost Engine. **This answers your "~19-20%" question — see the note below.** |
| Product classifications / `quality` flag | `Real`/`Parcial`/`Estimado` provenance per product, promised transparency on the old app's own "About" page | `database.json` `quality` field (Portfol.io) | Real | **Keep** | Carry as a trust/provenance column on any new product table |
| PPR | 5 real PPR products, entry-deduction tax modelling (20% of contributions, capped €400/yr, cites CIRS art. 43/72 + EBF art. 21) | `pprEntryBenefit()` (Portfol.io) | Real, PT-law-specific | **Keep** | Cost Engine / Product Library |
| Insurance / Unit-Linked | 2 real Seguro products, same field shape as funds/ETFs | `database.json` (Portfol.io) | Real | **Keep** | Product Library |
| Scenarios (conservador/base/otimista) | Named forward-looking return/vol assumption sets | `parser.py` — **hard-coded, not from Excel** (Portfol.io) | Placeholder-ish | **Adapt** — needs a real schema decision, not a straight copy | Simulator assumptions |
| Stress tests (2008/COVID/etc.) | Named equity/bond shock + recovery-years scenarios | `parser.py` — **hard-coded, not from Excel** (Portfol.io) | Placeholder-ish | **Adapt** | Simulator / Risk |

---

## Portfolio Intelligence

| Feature | What it does | Source | Real data? | Keep/Adapt/Drop | New location |
|---|---|---|---|---|---|
| Portfolio Builder | Reactive multi-row product+weight builder, 5 one-click strategies (Normalize/Equal/Risk-Balanced/Cost-Optimized/Tax-Optimized) | `builderHTML()`, `applyStrategy()` (Portfol.io) | Real | **Keep** | Simulator |
| Allocation math | `alloc.{stocks,bonds,other}`, `exp.{us,eu,em}` per product, portfolio-weighted | `database.json` + `analyze()` (Portfol.io) | Real | **Keep** | Allocation (already built) / Simulator |
| Diversification | Effective position count via inverse-Herfindahl | `effectiveN()` (Portfol.io) | Real | **Keep** | Simulator diagnostics |
| Correlation | Pairwise estimate from equity-weight difference + geo overlap + shared benchmark (base 0.95, floor 0.55/cap 0.99) | `corrEst()` (Portfol.io), also cited in original `feature-backlog.md` from the Downloads prototype | **Heuristic, not historical covariance** | **Adapt** — flag as an estimate; decide later whether real historical correlation (needs Daily Prices) is worth it | Simulator/Risk |
| Risk (vol/Sharpe/Sortino/Beta/TE/MDD/Alpha) | Full risk-metric set per product and portfolio-level | `portVol()`, product fields (Portfol.io) | Real | **Keep** | Risk page (not yet built) |
| Performance (1/3/5yr, annual history) | Real annual-return series per product | `database.json` `FACT_PERFORMANCE` (Portfol.io) | Real | **Keep** | Performance / Product detail |
| Simulation (compounding) | Deterministic monthly-compounding projection given contributions + assumptions | `analyze()` (Portfol.io), `simulate()` (Downloads prototype) | Real, formula-based | **Keep** | Simulator |
| Monte Carlo | 10,000-path Box-Muller simulation, P10/25/50/75/90 fan chart + probability-of-loss | `gauss()`, `monteCarlo()` (Portfol.io) — **not in the original feature-backlog** | Real | **Keep** | Simulator advanced section |
| Sensitivity matrix | Return × horizon heatmap of final wealth | `sensitivityHTML()` (Portfol.io) — not previously catalogued | Real | **Keep** | Simulator |

---

## Investor Intelligence

| Feature | What it does | Source | Real data? | Keep/Adapt/Drop | New location |
|---|---|---|---|---|---|
| Investor DNA (12 questions → 10D profile) | `PROFILE_Q` → `computeProfileVector` → 10-dimension vector (`riskTol`, `riskCap`, `liqNeed`, `taxSens`, `costSens`, `cmplx`, `divers`, `concTol`, `behDisc`, `goalUrg`) | `engine.js` (Portfol.io); also in the Downloads prototype per original `feature-backlog.md`, but **this version is materially fuller** | Real, functioning | **Keep** | Simulator entry point (already the agreed plan) |
| Build preferences + constraints | User-adjustable 6-slider 100-pt budget (return/risk/costs/tax/diversification/simplicity) + hard caps (maxETF/maxPPR/maxFundo/maxSingle %) + per-product exclusion | `buildOneStrategy()` (Portfol.io) — **not in the original feature-backlog** | Real | **Keep** | Investor DNA flow, advanced options |
| Recommended portfolios (Top-3) | Suitability-scored, deduplicated Top-3 with generated reasoning + trade-offs | `generateTop3`, `buildReasoning`, `buildInsights` (Portfol.io + Downloads prototype) | Real | **Keep** | Investor DNA → Simulator handoff |
| Portfolio diagnostics narrative | Rule-based strengths/weaknesses/hidden-risks text (TER, Sharpe, concentration, correlation >0.90, EM exposure, active-mgmt dependency) | `buildDiagnostics()` (Portfol.io) — **not in the original feature-backlog** | Real | **Keep** | Simulator "Scorecard" or Overview-style insights |

---

## Research

| Feature | What it does | Source | Real data? | Keep/Adapt/Drop | New location |
|---|---|---|---|---|---|
| Product scoring (9-dimension) | 0–100 per product: costs×1.3, tax×1.0, diversification×1.1, liquidity×0.7, transparency×0.8, scale×0.6, efficiency×1.2, risk×1.0, return×1.3 — portfolio-level weighted average | `productScores()` (Portfol.io + Downloads prototype) | Real | **Keep** | Product detail Scorecard tab |
| Product Explorer | Sortable/searchable/filterable table + detail drawer | `viewDatabase()`, `dbRows()` (Portfol.io) | Real | **Keep** | Product Library |
| Strategy Lab (A/B comparator) | Portfolio A vs B, 9-metric win/lose/tie table + grounded trade-off sentence | `comparePortfolios()` (Portfol.io) — **fuller than the Downloads prototype's unnamed two-portfolio hint** | Real | **Keep** | New: Strategy/Scenario comparison, alongside Simulator |
| Benchmarks | Portfolio vs. MSCI World / S&P 500 | `viewBenchmarks()` (Portfol.io + Downloads prototype) | **Approximation** — hardcoded `+2.5%` offset for S&P, not real index data | **Adapt** — needs real benchmark price history (ties to Daily Prices, paused) | Performance (already has an honest "not available" state for this) |
| Market Data | Daily/latest prices, sparklines | `loadPriceHistory()`, `__spark()` (Downloads prototype, per original feature-backlog) | Placeholder in the prototype | **Adapt** — deferred, tied to Daily Prices (explicitly paused) | Research → Market Data (not built) |

---

## Tools

| Feature | What it does | Source | Real data? | Keep/Adapt/Drop | New location |
|---|---|---|---|---|---|
| Cost Engine (TER + Cost Drag + tax) | See Product Intelligence rows above, combined into one module in the old app | `engine.js` (Portfol.io) | Real | **Keep** | Cost Engine |
| Switching-cost engine | Per-switch breakdown (exit fee, 2× broker commission, spread, capital-gains tax at that year's bracket, PPR early-exit warning), compounded forward, 5 preset scenarios | `calcOneSwitchCost()`, `simulateWithSwitches()` (Portfol.io) — **entirely absent from the original feature-backlog** | Real | **Keep** | New — "cost of changing your mind," inside Simulator or its own tool |
| Broker comparison/recommendation | Cost model + composite score (cost 35%/safety 25%/UX 15%/tax-simplicity 15%) + auto-recommendation + 4-question fit quiz + radar-chart comparator | `calcBrokerCosts`, `scoreBroker`, `brokerFitScore` (Portfol.io) — **entirely absent from the original feature-backlog** | Real, 10 real brokers | **Keep** | New — Broker comparison, likely inside Cost Engine or Accounts |
| Simulator | Portfolio Builder + Monte Carlo + sensitivity, one coherent tool | `views.js` `viewSimulator()` (Portfol.io) | Real | **Keep** | Simulator (already planned) |
| Calculators (compound interest, "Cost Killer" TER slider, risk comparator) | Interactive standalone playgrounds | `lnPlayground` (Portfol.io, part of Learn & Earn) | Real, illustrative | **Adapt** | Could live standalone or inside relevant pages (Cost Engine, Simulator) |
| Learn & Earn (gamification) | XP/levels, 8 quiz questions, 4 live-portfolio-checked challenges, glossary | `LQ`, `CH`, `lnQuizzes` etc. (Portfol.io) — **whole category absent from the original feature-backlog** | Real | **Adapt** — lower priority | New, later — matches the original backlog's own "smaller, later" execution guidance for similar items |
| Chatbot (Chatbase) | Floating widget, no custom logic or data access | `viewAI()` (Portfol.io); confirmed same verdict independently for the Downloads prototype | Embed only, no real integration | **Drop** | Superseded by the already-planned real Claude-API chat surface (reads validated data, proposes Commands, never writes — per Platform Architecture's AI principle) |

---

## The Cost Engine question, answered

You asked to separate **cost percentage** from **cumulative cost over time** before assuming "19-20% = TER." Confirmed directly from the old engine's code, by simulation:

- **TER** in the real product data ranges **0.07%–2.22%** — always a small annual figure. It is never itself a "19-20%" number.
- **Cost Drag** — `(fees ÷ wealth-if-fee-free) × 100`, i.e. what fraction of your *fee-free potential wealth* the fees actually consumed by the end of the horizon — is the cumulative metric. Verified by re-running the exact formula: a product with **~1.0–1.3% TER held 25–30 years lands right at 18-20% Cost Drag.**

**So the "~19-20%" figures you had for Funds/ETFs almost certainly describe Cost Drag on typical ~1–1.3%-TER products, not TER itself.** PPR's "~8% after 8 years" and Insurance's "~11%" fit the same pattern (shorter/differently-costed products, less compounding time or lower TER, less drag). Both metrics are worth keeping, clearly labelled as two different questions ("what's the annual fee" vs. "what did fees actually cost me by the end") — exactly the same discipline this app already applies to TWR vs. Unrealised Gain.

---

## Execution order (unchanged in spirit from the original backlog, now with everything above folded in)

1. Product database schema (Supabase `securities`/`security_details` — this is now well-specified, see above)
2. Product Library (list + detail, Scorecard tab)
3. Cost Engine (TER + Cost Drag, clearly distinguished)
4. Simulator (Portfolio Builder + Monte Carlo)
5. Investor DNA (public-safe entry point)
6. Strategy Lab, Switching-cost tool, Broker comparison (all genuinely new, none blocking anything else)
7. Learn & Earn, real Chatbot (later, smaller, independent)

Daily Prices/Market Data/real Benchmarks stay exactly where the standing instruction put them: paused, revisited later.
