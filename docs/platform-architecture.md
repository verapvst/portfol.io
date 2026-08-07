# Portfolio.io — Platform Architecture

**Version 1.0**

## 1. Executive Summary

Portfolio.io is not a dashboard that reads an Excel file. It is an investment operating system: a small number of pages (Overview, Portfolio, Analytics, Data Hub, Import Centre, Reports, Settings) sitting on top of one data engine, fed by many possible sources (manual entry, Excel, PDF statements, broker APIs, CSV, future integrations) through exactly one write path.

This document is the platform-level constitution — the principles every future feature gets evaluated against, so the architecture doesn't get reinvented each time a new capability is added. It sits alongside, not in place of, `docs/workbook-architecture.md`, which remains the correct reference for one specific thing: the schema of the Excel *import/export adapter*. Excel's role changes under this document (see Section 9); its internal design does not need to.

The single sentence this document reduces to, if it had to be one:

**Portfolio.io should never ask "where did this data come from?" It should only ask "what facts do I currently know about this portfolio?"**

A PDF, an Excel upload, a broker API, and a manual edit are four different ways of *discovering* the same kind of fact. Once a fact is validated and committed, its origin stops mattering to the rest of the system. The analytics engine that computes a valuation's contribution to performance does not know or care whether that valuation came from Trading212, a scanned PDF, or being typed in by hand.

## 2. Why Excel Cannot Remain the Source of Truth

This isn't a judgment on Excel's quality — the workbook's own schema (events not snapshots, immutable IDs, provenance columns, cash-as-asset, no "current state" ever stored) is genuinely good design, and that design survives the move described in this document almost unchanged. Excel fails specifically as the *storage engine* for what Portfolio.io is becoming, for four structural reasons:

- **No concurrency control.** A single human editing one file by hand never collides with themself. A broker sync job and a manual edit, touching the same file at the same time, will.
- **No live query surface.** A browser cannot query an `.xlsx` file the way it queries a database. This is not hypothetical — it is why the current dashboard reads a hand-transcribed JS mirror of the workbook (`repository.js`) instead of the workbook itself. That workaround is a symptom, not a design choice.
- **No enforcement, only convention.** Every discipline the workbook has today — immutable IDs, provenance, "never overwrite, always append a new dated row" — is enforced by whoever is editing the file being careful. A real database enforces referential integrity, atomicity, and constraints at the storage layer, so the discipline survives writers who aren't a careful human (a parser, a sync job).
- **No API surface.** Every future integration would otherwise mean "open the file, find the row, rewrite it, save it back" — fragile, non-atomic, and incompatible with more than one concurrent writer.

The moment any of the following became true, Excel stopped being able to be the centre: *"I want to upload PDFs," "I want to connect Trading212," "I want to manually edit values from a form."* All three are already true.

## 3. The Three Layers

```
──────────────────────────────
Presentation Layer
──────────────────────────────
Overview · Portfolio · Analytics · Data Hub · Reports · Settings · Import Centre

──────────────────────────────
Application Layer
──────────────────────────────
Commands · Validation · Business Rules · Import Pipeline
Conflict Resolution · Review · Permissions · Automation · Scheduling · Notifications

──────────────────────────────
Data Layer
──────────────────────────────
Reference Data · Configuration · Portfolio Event Store · Derived Views · Materialized Analytics
```

Each layer has exactly one responsibility, and nothing skips a layer:

- **Presentation** renders state and issues Commands. It never computes anything analytical and never writes directly to storage.
- **Application** is where every rule lives — what's a valid command, what counts as a duplicate, which source wins a conflict, what's allowed to happen automatically. This is the *only* layer permitted to write to the Data Layer.
- **Data** holds facts (the Event Store), current settings (Configuration), and reproducible calculations (Derived Views). Nothing in this layer contains business logic — it's storage and computation, not decision-making.

A page in the Presentation Layer is a *view*, not an owner, of anything. This is the practical meaning of "Portfolio.io is a platform, not a dashboard": today's Overview and Data Hub are already two views sharing one data layer, not two dashboards that happen to look similar. Every future page (Analytics, Reports, Settings, Import Centre) is another view over the same engine, not a new vertical slice with its own logic.

## 4. The Data Layer

### 4.1 Reference Data

Shared, largely user-independent facts: the security master (ISIN, name, currency, provider, benchmark — today's `Assets` sheet), institutions, and the classification dictionary built this project (`Security Classifications`) — which should generalise beyond country/region to sector, asset class, style, and market cap.

**Design note — classification is reference data, not personal data, even in a single-user system.** "UBS Core MSCI World is US/Japan/UK-heavy" is true for anyone who holds it. Modelling it as shared reference data now, rather than scoped to one portfolio, avoids a painful re-scope the moment a second user (or a second portfolio) exists, and costs nothing today.

### 4.2 Configuration

Mutable, current-state settings that are not facts about what happened, only preferences about how the system behaves or displays: account names, colours, institution logos, target allocations, assumptions (risk-free rate, tax rate, scenarios), benchmark selection, notes. Ordinary CRUD, with an audit trail so edits remain traceable — but genuinely editable, unlike the Event Store.

**The sorting test:** *if the full history were replayed from day one, would this row exist as a fact about the world, or is it just a current preference about how to view that history?* A transaction is a fact. An account's display colour is a preference. That test scales better than a fixed list, because new fields will keep needing to be sorted for as long as the platform grows.

### 4.3 Portfolio Event Store

Renamed deliberately from "Event Ledger." Ledger implies accounting; this store holds more than financial events — transactions, valuations, dividends, fees, imports, benchmark updates, classification decisions, overrides, sync runs. "Portfolio Event Store" describes what it actually contains; it is still *implemented* internally as an append-only ledger — insert-only, never updated, never deleted.

Corrections and deletions are themselves events, not exceptions to immutability:

- `TransactionVoided` references the original transaction by ID rather than removing it. Derived views exclude voided transactions from current-state calculations; the original fact and the correction both remain in history forever.
- `SecuritiesMerged` (e.g. a ticker rename after a corporate action) is a reference-data correction plus an event recording the reclassification — it never rewrites the historical transaction rows that used the old identifier.

This is what makes the earlier conflict example resolvable at all: €10,000 (Excel), €10,050 (PDF), €10,040 (manual) are not one fact with three candidate values — they are three separate, real, sourced observations, quite possibly with different as-of dates. All three get stored. See Section 6.4 for how the system then decides what to *display* as "the" current value without silently discarding the other two.

### 4.4 Derived Views & Materialized Analytics

Every analytical figure — Portfolio Health, Diversification Score, Largest Position, Sharpe Ratio, country/sector/asset-class/factor exposure, TWR, XIRR, drawdown, volatility, rolling returns, cash ratio, allocation drift, expected return, risk score, expense ratio, and anything added later — is computed from the Event Store, never stored as an editable field. If the store is correct, every one of these numbers must be reproducible from it, on demand, by anyone who asks.

**"Derived" describes authority, not caching policy.** A materialized snapshot that gets invalidated and recomputed whenever new events land is still derived in the sense that matters — never hand-edited, always reproducible, the Event Store remains the only authority — it is simply derived-with-a-cache rather than derived-on-every-request. Deciding this now means a future performance optimisation doesn't read as a violation of the principle later.

**Design note — shape the analytics engine as a dependency graph, not twenty independent functions.** Country Allocation and Risk Score both start from "current holdings, classified, at current value." If every derived metric re-derives that base layer independently, the platform has recreated Excel's original problem — duplicated logic, just moved from formulas into functions — one layer down.

## 5. The Application Layer

### 5.1 Commands and Events — the Single Write Path

**This is the single most important enforcement mechanism in the architecture.** Exactly one write path exists, for every interface, with no exceptions:

```
User Action / Import / API call
        ↓
    Command
        ↓
   Validation
        ↓
 Business Rules
        ↓
   Event(s)
        ↓
Portfolio Event Store
```

Never this, which is how business logic quietly duplicates itself across a codebase until nobody can say with confidence what "buying a security" actually enforces:

```
Overview writes → Store        Data Hub writes → Store
PDF parser writes → Store      Broker API writes → Store
```

A **Command** is a request, phrased as an imperative — `BuySecurity`, `RecordValuation`, `ImportStatement`, `VoidTransaction`, `MergeSecurities`. It can be *rejected*: a missing ISIN, a negative quantity, a business rule violation. A rejected command is itself worth recording — a real audit trail includes what was attempted and refused, not only what succeeded.

An **Event** is the past-tense fact produced when a command succeeds — `SecurityBought`, `ValuationRecorded`, `TransactionVoided`. This is what actually gets appended to the Event Store. One command commonly produces several events in a single transaction: `ImportStatement` might yield a dozen `TransactionRecorded` events and one `ImportCompleted` event together.

Exactly one command handler exists per command type, and only command handlers may append events. A button in Overview, a confirmed row in Data Hub, and a future broker webhook all resolve to the *same* handler for `RecordValuation` — meaning "what counts as a valid valuation" has exactly one implementation, regardless of which page or integration triggered it.

### 5.2 The Import Pipeline

Every import — Excel, PDF, CSV, broker pull — follows the same shape, because letting *any* source write directly is exactly the inconsistency Section 5.1 exists to prevent:

```
Source → Parser → Normalization → Enrichment → Validation
       → Duplicate Detection → Conflict Detection → Preview → Commit → Event(s)
```

Worked example — importing a Trading212 statement:

1. **Parser** extracts the raw line: `VWCE · 15 units · €130.42`.
2. **Normalization** maps it to a common shape: ISIN, ticker, currency, quantity, price.
3. **Enrichment** determines asset class, sector, country, region, market cap, style, currency, provider — automatically, using the classification engine (Section 4.1), the same one built for geographic exposure this session, generalised.
4. **Validation** checks for a missing ISIN, an unrecognised ticker, a negative quantity, an impossible date.
5. **Duplicate Detection** asks: has this exact statement, or this exact line, already been imported?
6. **Conflict Detection** asks: does this disagree with another source that already reported the same fact?
7. **Preview** shows exactly what will happen — before anything is written. This step is never optional and never skipped, for any source, including the platform's own automated syncs.
8. **Commit** issues the actual command(s); only from here do events get appended.

**No parser ever has permission to write to the Event Store.** A parser's only output is normalized, staged records — proposals, not facts, until a human (or, much later, a scheduled automation with its own explicit authority) confirms them.

**Design note — the pipeline is a menu, not a corridor.** A document-based import genuinely needs all nine stages. A manual "record today's value" entry has nothing to parse or normalize — it enters already-normalized, and only needs Validation → Duplicate Detection → Commit. Every command should be free to enter the pipeline at whichever stage is relevant to it, rather than every interface being forced through no-op Parser/Normalization steps just to technically match the same pipe.

### 5.3 Conflict Resolution

Given the same fact reported differently by different sources — €10,000 (Excel), €10,050 (PDF), €10,040 (manual entry) — the system must never silently pick a winner. Silent reconciliation is precisely what this project has refused to do at every real instance encountered so far (a genuine BPI NAV discrepancy between two close dates was kept as two separate observations rather than guessed into agreement).

The policy:

1. **Store all of them.** Each is a separate, dated, sourced event in the Portfolio Event Store — see Section 4.3.
2. **Define an explicit, visible precedence for what to *display* as "the" current value** — most recent as-of date first, then a configurable source-priority tier (e.g. broker API > PDF statement > manual entry > Excel upload — configurable per data type, since trust in an API-reported cash balance may reasonably differ from trust in a PDF-parsed dividend figure).
3. **Always show provenance next to the number** — "as of Aug 4, from Trading212" — so a user sees *why* a figure was chosen, never a silent pick.
4. **If two sources disagree for the same as-of date, that is not resolvable by policy.** It gets flagged into a review queue, the same UI pattern already built for securities the classifier couldn't confidently place (Section 5.2, step 6) — a human resolves it explicitly, and that resolution is itself a command, producing its own event.

### 5.4 Permissions, Automation, Scheduling, Notifications

These belong to the Application Layer on the same principle as everything else in it — they are rules about *when* a command is allowed to execute and *what happens after* an event lands, never a separate path to the Data Layer. A scheduled broker sync is a command issued by a scheduler instead of a human; it still passes through the same handler, the same validation, the same preview-before-commit discipline (Section 5.2) unless a future, deliberate decision grants a specific automation the authority to skip the preview step for a specific, narrow case. That authority itself should be a Configuration setting, not a code path.

## 6. The Presentation Layer

A page issues Commands and renders Derived Views. It owns layout, interaction, and visualization — never a calculation that could instead live in the Data Layer, and never a write that bypasses a Command. This is the direct extension of the existing Dashboard Principle ("if a metric can't be derived from the database, the missing data belongs in the database, not the dashboard") from the Excel-era architecture: the boundary just moves from *Excel vs. HTML* to *Data Layer vs. Presentation Layer*, unchanged in spirit.

Expected pages, each a view over the same engine, none an isolated system: **Overview** (the current dashboard), **Portfolio** (holdings/positions in detail), **Analytics** (deeper exposure/risk/performance), **Data Hub / Import Centre** (the pipeline in Section 5.2, made visible), **Reports** (exports, including Excel — see Section 9), **Settings** (Configuration, Section 4.2).

## 7. Entities (Conceptual)

Not a schema — a map of what exists and which layer owns it.

**Reference:** `Security`, `SecurityClassification`, `Institution`.

**Event Store (append-only):** `Transaction`, `Valuation`, `CostEvent`, `BenchmarkValue`, plus correction/compensating events (`TransactionVoided`, `SecuritiesMerged`, ...).

**Import & provenance:** `ImportSource` (a connector definition — "BPI PDF Parser," "Trading212 API," "Manual Entry"), `ImportJob` (one run — source, timestamp, actor, status), and a real foreign key from every Event Store row back to the `ImportJob` (or a `manual` sentinel) that produced it. This is the workbook's existing Source / Import Date / Import Method / Import Version columns, made relational instead of textual — the same idea, enforced by the schema instead of by convention.

**Derived (cache-if-needed, never edited):** `AllocationSnapshot`, and equivalents for risk and performance — materializations of Section 4.4, not tables anyone opens and corrects by hand.

**Configuration:** `Portfolio`, `Account`, `TargetAllocation`, `Assumption`.

## 8. Editable vs. Always-Calculated

**Editable (Commands exist to change these):** account/portfolio setup, transactions, costs, target allocations, assumptions, benchmark selection, and classification *overrides* — the "correct this once" flow already built for unclassified securities.

**Always calculated, never editable, full stop:** current position size, every exposure dimension (country, sector, currency, asset class, style, market cap, factor), TWR, XIRR, drawdown, volatility, rolling returns, Sharpe ratio, cash ratio, allocation drift, diversification/health scores, expected return, expense ratio, "current value" for anything (always a query over the latest valuation × units, never a stored field).

**Design note — classification will never reach 100% automatic, and the architecture should assume that permanently.** This project's own real classification pass, done carefully, still left roughly a seventh of one fund's holdings genuinely `Unknown` — and actively-managed funds will always need individual attention, because there's no index to borrow a real answer from. The override path (Section 8, "editable") is permanent infrastructure, not a bootstrapping step to retire once enrichment "gets good enough." It won't, structurally, for every security.

## 9. Excel's Role Going Forward

Excel does not disappear — it stops being privileged. It becomes exactly one import/export adapter among several, symmetric with PDF, CSV, and future broker APIs, and it keeps three genuine jobs:

1. **Export/reporting surface** — a downloadable snapshot of the portfolio, generated *from* the Event Store, which is the reverse of today's direction.
2. **Bulk-edit ergonomics** — editing fifty rows is sometimes genuinely faster in a grid. The edited file re-enters through the same Import Pipeline as any other Excel upload (Section 5.2); it is never treated as the record by being edited in place.
3. **Human-auditable snapshot** — an export independent of the running application is a real check on the system's own correctness, and has already caught genuine bugs during this project's development.

`docs/workbook-architecture.md` remains the correct specification for the Excel adapter's own internal schema. Nothing in that document needs to change for this shift — only its role, from *the* database to *an* adapter, changes.

## 10. AI's Role

A place is reserved now, deliberately, even before anything is implemented:

```
                DATA SOURCES
        Excel · PDF · CSV · APIs · Manual
                     │
                     ▼
              Import Pipeline
                     │
                     ▼
              Portfolio Events
                     │
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
 Analytics      AI Services      Reports
      ▼              ▼              ▼
 Dashboard    Recommendations   Exports
```

**AI never writes to the Event Store.** It reads validated events and derived views like any other consumer. If AI suggests something — "this looks like a duplicate transaction," "this holding looks unclassified, here's a likely answer" — it produces a *proposed Command*, routed through the exact same validation and preview discipline as a command from a human or a parser (Section 5.1–5.2). This keeps the architecture deterministic and auditable regardless of how much of the analysis is eventually AI-assisted: nothing enters portfolio history without passing through the one write path everything else already has to pass through.

## 11. Scalability & Multi-Tenancy Path

The target shape, if this were built from zero as a SaaS product: PostgreSQL, every table scoped by `user_id` / `portfolio_id` from day one even with a single real user, a real backend API that both the UI and any future integration consume (so business logic never lives in the browser the way parts of it currently do in `repository.js`), a background job queue for imports and broker syncs (never parsed synchronously inside a request), and real authentication — today's Owner Access gate is honestly labelled in its own code as *not real access control*, correctly, for a single-user personal tool, and is a hard blocker the day a second real user exists.

That is a significant infrastructure jump for a project that is, today, a folder and a static HTML page — and recommending it wholesale would be bad architecture advice for where this project actually is. A staged, honest path:

1. **Local-first single-user database now.** SQLite is a completely legitimate real database here: same relational schema, same Event Store discipline, zero hosting burden, and it already solves the structural problems in Section 2 (concurrency, live queries, enforcement).
2. **A real backend API in front of it, even running locally.** This is what makes the Import Pipeline (Section 5.2) the only writer in practice, and turns the Presentation Layer into an honest read client instead of a place where derivation logic accumulates.
3. **Multi-tenancy, hosted Postgres, and real auth only once a second real user is an actual near-term plan**, not a someday-maybe. If step 1's schema is scoped by `user_id` from the start, this becomes infrastructure work, not a rewrite.

## 12. Migration Path From Today

Grounded in what already exists, not a rewrite:

- The Data Hub PDF pipeline (classify → parse → consolidate → enrich → preview) already implements most of Section 5.2's shape. It is missing only a real Command layer and a real Event Store at the end — today, "Commit" means copying to a clipboard for manual pasting into Excel, not issuing a command.
- The Excel workbook's schema (Section 4.3's shape, already real: events not snapshots, immutable IDs, provenance) migrates into the Event Store close to as-is — the hard design work is already done; the database mostly needs to *enforce* what Excel currently only documents.
- The dashboard's hand-maintained JS mirror of the workbook (`repository.js`) is replaced by real reads against the new store through the backend API from Section 11.2 — closing the exact gap that mirror exists to paper over today.
- Manual quick-entry, broker integrations, and CSV import are all new `ImportSource`s added to an already-existing pipeline shape, not new subsystems.

## 13. Summary — the Constitution

- Portfolio.io is a platform, not a dashboard.
- The database — not Excel — is the source of truth; Excel is one import/export adapter among several.
- All writes go through a single command pipeline. No exceptions, for any interface.
- Facts are immutable; analytics are always derived, never stored as authoritative.
- Imports are reviewed before becoming facts; no parser ever writes directly.
- Every interface — manual, Excel, PDF, API — resolves to the same write path.
- AI assists and proposes; it never becomes an authoritative source of data.

These principles are stable enough that future features get evaluated against them rather than re-deriving the architecture each time. The implementation underneath is expected to evolve; this document is not.

## 14. Revision History

**Version 1.0** — Initial platform architecture, established through a full architecture review covering: why Excel cannot remain the source of truth; the three-layer model (Presentation / Application / Data); the Portfolio Event Store (renamed from "Event Ledger" to reflect its broader real contents); the Command/Event distinction as the single write path; the nine-stage, composable Import Pipeline; an explicit conflict-resolution policy (store every source, never silently pick a winner, always show provenance); the permanent (not bootstrapping) role of manual classification overrides; Excel's demotion to import/export adapter; AI's reserved, read-only, propose-don't-write role; and a staged, honest migration path (SQLite-first, Postgres/multi-tenant only once genuinely needed) grounded in the project's actual current state rather than a theoretical greenfield design.
