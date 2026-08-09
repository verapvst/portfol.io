# Portfol.io

A personal investment portfolio platform — dashboard, transaction ledger, and document importer, backed by Supabase. Migrated 2026-08-07 from a years-old development folder (`Portfolio Management/`) into this clean, flat repository; see `docs/production-architecture.md` for the full audit that preceded the move.

## Structure

Deliberately flat — this is a static HTML/CSS/JS app with no build step, so there's no `src/` to separate from tooling:

```
Portfolio.io/
├── index.html            Overview (dashboard)
├── data-hub.html         PDF import + (soon) direct-to-database loading
├── accounts.html         Accounts CRUD
├── transactions.html     Transactions CRUD
├── valuations.html       Valuations (insert-only)
├── costs.html            Costs (insert-only)
├── css/                  One file per page + shared theme/layout/components
├── js/                   One file per page + shared db.js/auth.js/shell.js/utils.js
├── assets/               Images
├── vendor/               d3, topojson, world map data (Overview's exposure map)
├── supabase/migrations/  The full schema, in order, run once each in the Supabase SQL Editor
├── docs/                 Architecture documentation (see below)
├── data/                 Portfolio Workbook.xlsx + the monthly reports inbox
├── scripts/              open-portfolio.command — local dev launcher
├── netlify.toml          Deployment config (headers, publish dir)
└── .gitignore
```

**Run it locally:** double-click `scripts/open-portfolio.command`, not `index.html` directly — the app fetches local files (world map data, PDF parser scripts) that a browser blocks under a plain `file://` URL; the script starts a local server and opens `http://localhost:5177`.

**Supabase connection:** `js/supabaseConfig.js` holds the project URL and public anon key — safe to commit, never the `service_role` key. Schema lives in `supabase/migrations/`, run in order (`0001` → `0002` → `0003`) in the Supabase SQL Editor.

## Documentation

- `docs/platform-architecture.md` — the constitution: three layers (Presentation/Application/Data), Commands/Events, the Portfolio Event Store, the single write path.
- `docs/workbook-architecture.md` — the Excel schema `data/Portfolio Workbook.xlsx` follows; still the real source for anything not yet migrated to Supabase.
- `docs/migration-plan.md` — the concrete bridge from the workbook's 9 sheets to Supabase, module by module: table structure, CRUD, owning page, build order.
- `docs/production-architecture.md` — the pre-deployment checkpoint: the Showcase/Portfolio/Edit access model, the repository audit that led to this migration, and why Netlify.
- `docs/feature-backlog.md` — **living document**, unlike the four above. Feature-by-feature backlog from auditing an old prototype (`~/Downloads/index.html`): what code already exists to reuse (a real automated daily ETF-pricing pipeline, a deterministic simulator engine, a Portuguese capital-gains tax engine, a 12-question Investor-DNA recommendation engine, 9-dimension product scorecards), organized around three universes — My Portfolio (private), Securities (public-safe), Simulator (a virtual layer on both). Execution starts with Daily Prices.

## Current state (2026-08-07)

Real data, not a demo: 1 portfolio, 2 accounts, 6 securities, 5 transactions, 117 valuations (2017-06-21 → 2026-08-04), 4 costs — all live in Supabase, gated by Row Level Security. `index.html` reads Supabase directly when signed in (Migration Plan Phase 3), computing TWR/XIRR/holdings/allocation live; signed out, it falls back to a real (not mock) data snapshot in `js/repository.js` for the same reason a public visitor shouldn't see an empty page. Asset Class Allocation and Country/Region Exposure still come from that snapshot either way — their source data (the workbook's Allocations/Detailed Portfolio/Security Classifications sheets) hasn't migrated to Supabase yet (Migration Plan Phase 4-5); `repository.js` shrinks as each piece migrates and disappears entirely once the last one does, not before.

`data-hub.html` parses real BPI monthly report PDFs end-to-end and writes the fee fields it reliably extracts (TER, Depositary, Subscription, Redemption) straight into `costs`. Allocations/Detailed Portfolio import isn't wired yet — no Supabase table for them exists.
