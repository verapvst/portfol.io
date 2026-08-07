# Portfolio.io — Production Architecture

**Version 1.0** — the third document in the `02_` family, alongside the Platform Architecture (the constitution) and the Migration Plan (workbook → Supabase, module by module, including per-module schema — the former Core Modules Specification is merged into it as of Migration Plan v1.1). This document is the one that turns the project from "an app that runs on my machine" into "an app in production": the three-mode access model, a full repository audit, and a deployment recommendation.

---

## 1. The Three-Mode Model

This replaces Owner Access entirely — not just renames it. That distinction matters more than it looks: Owner Access is explicitly documented in its own source (`shell.js`) as *not real access control* — a client-side toggle that ships in plain-text JS to anyone who opens dev tools. That was a defensible choice when Overview had no live backend to protect. **It stops being defensible the moment Overview reads from Supabase** (Migration Plan Phase 3, not yet built) — at that point, a client-side money-mask protects nothing at all, because the real numbers are one `supabase.from('valuations').select()` call away in the browser console, mask or no mask. This review is catching that before it becomes a real exposure, not after.

### 1.1 Showcase Mode

**Public URL, no authentication, read-only.** This is the anonymous `anon` role, and the design rule is absolute: **anon never touches a raw table.** Not "the UI hides the euro column" — RLS denies `anon` `SELECT` on `portfolios`, `accounts`, `transactions`, `valuations`, `costs`, `documents`, `securities` entirely, full stop. What Showcase Mode shows instead comes from a small set of purpose-built views, each one hand-picked to answer exactly what you listed and nothing else:

- `public_allocation_view` — dimension, category, weight_pct. No euros, no account names.
- `public_performance_view` — TWR %, XIRR %, drawdown %. No invested capital, no portfolio value.
- `public_risk_view` — volatility, Sharpe, whatever risk metrics Migration Plan §3.5 eventually computes. Pure ratios.
- `public_exposure_view` — country/region/sector weight_pct, sourced from Allocations + Security Classifications, no security names or market values.
- Methodology, philosophy, and documentation content doesn't need a view at all — it's static (either hand-written HTML/Markdown, or the `metric_definitions` table from the Core Modules doc §4, which is already meant to be safe, generic content).

Each view is granted `SELECT` to `anon` explicitly; nothing else is. This means even a bug in the frontend JS can't leak a balance — the data literally isn't retrievable by an unauthenticated request, at the database level, independent of what the UI happens to render.

**Concrete UI implication:** the topbar's `"Good evening, Vera"` greeting and any other name/email surface has to become mode-aware — Showcase Mode shows a generic heading, not your name. Small detail, but it's exactly the kind of "personal data" leak your own requirement calls out, and it's currently hardcoded in `app.js`/`data-hub.js`'s `init()`.

### 1.2 Portfolio Mode

**Authenticated, full visibility, read-only.** This is today's `authenticated` role and today's RLS `SELECT` policies — already built, already working (Accounts/Transactions/Valuations/Costs all read this way right now). No change needed here beyond making sure every table's `SELECT` policy stays scoped to `portfolio_id in (select id from portfolios where user_id = auth.uid())`, which it already is.

### 1.3 Edit Mode

**Entered from within Portfolio Mode, enables CRUD, can always step back down.** This is the one piece that needs a real mechanism, not a toggle — otherwise Edit Mode is just Owner Access wearing a new name, and the whole point of this review was to stop doing that.

**The problem with a pure UI toggle:** RLS policies check the session's JWT, not which buttons the page happens to be showing. If `authenticated` alone is enough to satisfy a write policy, then anyone holding your session token — including you, accidentally, from a stale browser tab still "in Edit Mode" from yesterday, or literally anyone typing into the browser console — can write regardless of what the visible UI says. "Portfolio Mode is read-only" has to be true at the database, not just true in the common case.

**Recommended mechanism — a real, time-boxed elevation:**

```sql
create table edit_sessions (
  user_id    uuid primary key references auth.users(id),
  expires_at timestamptz not null
);
alter table edit_sessions enable row level security;
create policy "own session only" on edit_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- **"Enter Edit Mode"** re-prompts for your password (a real re-authentication, not a stored flag) and calls an RPC that upserts `edit_sessions` with `expires_at = now() + interval '30 minutes'`.
- **Every write policy** on every table (`accounts`, `transactions`, `valuations`, `costs`, `documents`, `securities`, `institutions`) gets its `INSERT`/`UPDATE`/`DELETE` `USING`/`WITH CHECK` clause extended:
  ```sql
  ... and exists (select 1 from edit_sessions where user_id = auth.uid() and expires_at > now())
  ```
- **"Exit to Portfolio Mode"** deletes the row immediately — no waiting for expiry.
- Idle expiry (30 minutes, or whatever feels right) means even forgetting to exit isn't a standing exposure.

This is a small, single-table addition, not a rebuild — every CRUD page's write calls stay exactly as they are today; only the RLS policies they run against change. It's proportionate to a single-owner app while still being *real*: the elevation is enforced in Postgres, expires on its own, and is revocable from any device by anyone holding your login, not just the tab that granted it.

**What this replaces concretely:** `OWNER_PASSWORD`, `isOwnerMode()`/`setOwnerMode()`, the owner-modal in `shell.js`, and every `formatMoney()`/`money-mask` call site (24 references across `shell.js`/`app.js`/`data-hub.js`/CSS) — all of that logic collapses into "are you signed in" (Portfolio Mode) and "is there a live row in `edit_sessions`" (Edit Mode). One real distinction instead of one real + one fake.

### 1.4 One app, mode-derived, not URL-derived

Per your framing — one application, one database — Showcase/Portfolio/Edit shouldn't be three deployments or three subdomains. The mode is simply a function of session state at page load: no session → Showcase; session, no `edit_sessions` row → Portfolio; session with a live `edit_sessions` row → Edit. **The public CV URL is just the production URL itself** — a recruiter visiting it while you're not logged in on their machine sees Showcase Mode automatically, with no separate build or route to maintain.

---

## 2. Repository Audit

Read directly off disk, not from memory — here's what's actually there and what it should become.

**Status update (2026-08-07, Production Repository Cleanup pass):** §2.2's four obsolete candidates are deleted (`01_Portfolio AI/archive/`, `01_Portfolio AI/data/`, `04_Trading Data/`, `03_Monthly Reports/parsed/`). The docs move proposed informally in the companion Repository Cleanup Audit is done (`README.md` at root, architecture docs under `docs/`), and Core Modules Specification is merged into Migration Plan (v1.1). **Not done, deliberately held back:** `01_Portfolio AI/` → `src/` (needs careful path rewriting across every HTML/JS file plus full re-verification — its own pass, not bundled into a cleanup that also touched everything else); deleting `05_Research/`, `T212 Key Information/`, `06_BPI Report Parser/`, `99_Archive/`, or the Lovable reference project (all real, non-dead content per two separate audits — permanently deleting them with zero git history to recover from is a different risk category than deleting confirmed-empty/confirmed-dead folders); and removing `repository.js` (Overview and Data Hub still depend on it — Migration Plan Phase 3, which replaces it, hasn't been built).

### 2.1 A finding that has to come first

**None of "Portfolio Management/" is currently tracked in git.** The last real commit was the "Reorganize into Portfol.io/ (app) + Research/" rename — but the folder was renamed again since (`Portfol.io/` → `Portfolio Management/`, `01_Portfolio AI/` etc.) and that second rename was never committed. `git status` at the repo root shows 183 files as deleted (the old `Portfol.io/...` paths) and the entire current tree as one untracked folder. **Every real feature built this session — Accounts, Transactions, Valuations, Costs, Data Hub's database wiring, the Supabase migrations — exists only on disk, not in git history.** This isn't something to fix as a side effect of this review (it's a large, deliberate commit you should review, not something I should bundle into a file-audit pass), but any deployment plan is moot until it's committed and pushed — flagging it now so it's not a surprise when we get to §3.

### 2.2 Obsolete — candidates to remove

| Path | Why |
|---|---|
| `01_Portfolio AI/archive/` (`components/accountBars.js`, `components/goals.js`, `data/historicalRegistry.js`, `data/historical/bpi-dinamico.js`, `utils/historyMetrics.js`) | Confirmed via grep: not referenced by any current HTML or JS file — only mentioned in a `repository.js` comment as a historical design note. Also confusingly shares a name with the real `99_Archive/` at the repo root. |
| `01_Portfolio AI/data/` | Empty directory, no references found. |
| `04_Trading Data/` | Empty directory, no references found. |
| `lovable-project-e5110752-.../` | 333MB, 332MB of it `node_modules/`. Already fully extracted into `css/*.css` per the README's own note — this looks like a completed one-time design reference, not an ongoing dependency. Not git-tracked, so no history cost, but it's real disk clutter next to the actual app. **Confirm before deleting — I haven't touched it, just flagging it's very safe-looking.** |

### 2.3 Correctly documentation-only already (no change needed)

- `docs/workbook-architecture.md`, `docs/platform-architecture.md`, `docs/migration-plan.md` — pure docs, correctly placed. (`Core Modules Specification`, listed here in v1.0 of this doc, is retired as of Migration Plan v1.1 — merged in, not deleted-and-lost.)
- `06_BPI Report Parser/` — already labelled in `README.md` as "reference only... not needed day to day."
- `99_Archive/` — already the correct home for retired prototypes.

### 2.4 Shifting role, not obsolete

- **`02_Portfolio Workbook.xlsx`** — for everything already migrated (Accounts, Assets, Transactions, Portfolio Values, Costs), this file is now a historical snapshot, not a live source. For what's *not* migrated yet (Detailed Portfolio, Allocations, Security Classifications, Assumptions — Migration Plan Phase 4/5), it's still the real, live source until those modules exist in Supabase too. Once Phase 5 closes, its role finishes shifting to purely what you described at the very start of this: import format, export format, historical reference — never source of truth again.

### 2.5 Should become — import templates (don't exist yet)

Nothing today is a blank template — `02_Portfolio Workbook.xlsx` is full of real historical data, not something to hand someone (or your future self) as a starting structure. Worth creating, once Detailed Portfolio/Allocations/Assumptions are in Supabase too: a small `07_Import Templates/` folder with one blank CSV or XLSX per table (`accounts_template.csv`, `transactions_template.csv`, ...) — headers only, matching the Supabase schema exactly, so a manual bulk-import (or a future contributor, or you in six months) never has to reverse-engineer the column order from the real workbook.

### 2.6 What to .gitignore

Already applied (`/Users/verasousateixeira/Desktop/Finance/.gitignore`):

```gitignore
.DS_Store
**/.DS_Store

lovable-project-*/
node_modules/

*.log
```

Confirmed no `.DS_Store` was ever tracked, so nothing needs removing from history. **`js/supabaseConfig.js` deliberately stays out of `.gitignore` and gets committed normally** — it only holds the Supabase URL and the public `anon`/`sb_publishable_...` key, which are meant to ship in client code by design (RLS is what protects data, not hiding this file). Don't confuse it with a real secret.

---

## 3. Deployment Architecture

The app is a static site by construction — plain HTML/CSS/JS, no bundler, no build step, every "backend" concern (auth, data, RLS, storage) already lives in Supabase. That one fact does most of the deciding: this doesn't need a platform built around server-side rendering or serverless functions, because there's nothing server-side left for the *host* to do. All three candidates can serve static files adequately; the real differences are in the edges.

| | GitHub Pages | Netlify | Vercel |
|---|---|---|---|
| Cost for this project | Free | Free | Free |
| Git-connected auto-deploy | Yes | Yes | Yes |
| Custom domain + HTTPS | Yes | Yes | Yes |
| Custom response headers (CSP, X-Frame-Options) | **No** (no native way to set headers on served files) | Yes (`_headers` file or `netlify.toml`) | Yes (`vercel.json`) |
| Deploy previews per branch/PR | Limited | Yes | Yes |
| Built for | Pure static sites | Static sites + optional edge functions | Primarily framework apps (Next.js etc.), static sites supported |

**Recommendation: Netlify.**

The deciding factor is custom response headers, not deploy previews or DX polish. Once Showcase Mode is a real public surface with client-side auth flows running against it, a Content-Security-Policy header (restricting which scripts can execute) and `X-Frame-Options`/`X-Content-Type-Options` are genuinely worth having — they're a real, cheap defense-in-depth layer on top of RLS, not decoration. GitHub Pages has no native mechanism to set these at all (workarounds exist — `<meta>` tag CSP, which is weaker than a real header — but that's a workaround, not a feature). Netlify gets this for free with a three-line `_headers` file.

Vercel would do the same job equally well, but it doesn't do it *better* for a no-build-step static site — its strengths (edge functions, framework-aware builds, ISR) are all things this project deliberately doesn't need, per the same "no framework, no bundler" choice made everywhere else in this codebase. Adding a third hosting account with no net capability gain over Netlify isn't worth it.

GitHub Pages remains a perfectly reasonable zero-extra-account fallback if you'd rather not add Netlify to the list of services this project depends on — it will genuinely work, just with weaker header control, which matters more here than it would for a purely private tool.

**Before either GitHub Pages or Netlify can deploy anything real: the repository has to actually be committed (§2.1).** That's the one blocking dependency ahead of any deployment work.

---

## 4. Summary — what's decided, what's next

**Decided in this document:**
1. Showcase/Portfolio/Edit replace Owner Access, enforced by RLS and a real `edit_sessions` elevation — not a client-side toggle.
2. One app, one database, mode derived from session state — no separate public deployment.
3. `01_Portfolio AI/archive/`, `01_Portfolio AI/data/`, `04_Trading Data/`, and the Lovable reference project are dead weight, pending your confirmation to remove.
4. `.gitignore` updated for the Lovable reference and defensive `node_modules`/`.log` rules.
5. Netlify is the deployment target, chosen specifically for header control now that Showcase Mode is a real public surface.

**Not yet done, and deliberately not started without your go-ahead:**
- Committing the ~185 pending file changes at the repo root.
- Deleting the flagged obsolete files/folders.
- Building the `public_*` views, `edit_sessions` table, and updated RLS write policies.
- Rewiring `shell.js`/`app.js`/`data-hub.js` off Owner Access and onto the three real modes.
- Setting up the Netlify project itself.
