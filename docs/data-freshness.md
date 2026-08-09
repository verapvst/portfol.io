# Portfolio.io — Data Freshness ("Last Updated" / "Data as of")

A Portfolio.io-wide principle, not a Securities-specific feature. Wherever the app shows information where freshness matters, it should say when that information was last updated — and, where the two genuinely differ, distinguish *when the database row was touched* from *when the underlying real-world figure was actually true*.

## The two concepts

**Last updated** — when this *database record* was last modified. A system fact about the row, not about the world. Backed by an `updated_at` column plus a trigger that actually keeps it current (see below — until this was added, `updated_at` on every table in this app was set once at insert and then silently frozen forever, which made "last updated" meaningless the moment anyone edited a row).

**Data as of** — when the *real-world figure* was true, per its source. Often earlier than "last updated," sometimes much earlier. A TER pulled from a fund's June factsheet doesn't become "current as of today" just because someone typed it into Supabase today — saying "Last updated: today" in that case would be true but misleading; "Data as of: 30 Jun 2026" is the honest statement.

**Use whichever is semantically correct for what's being shown.** A freshly-entered number with a real source date gets "Data as of." A number with no meaningful source date of its own (e.g. a structural fact that's simply true or not, like a security's type) doesn't need either label at all — don't force the pattern where it doesn't apply.

## The date-choice hierarchy (never invent a date)

When populating an `*_as_of` field, in priority order:

1. **Known source/data date** — the date on the actual document/factsheet/report the figure came from. Always preferred.
2. **Known database update/import date** — if there's no cleaner source date but the data clearly entered the system at an identifiable point (an import job's timestamp), use that.
3. **Unknown date, but the information is newly verified/entered today** — use today's real date (from the environment, never hardcoded), since that's genuinely when Portfolio.io incorporated/validated it. This is not a fabricated historical date — it's an honest statement about when *we* did the work.
4. **No reliable information at all** — leave the field null. Do not manufacture a date to fill the gap. A missing "Data as of" is itself informative (it says "we don't actually know when this was true").

## Implementation

- `security_details.updated_at` — real "Last updated," kept current by the `set_updated_at()` trigger (`supabase/migrations/0007_security_details_last_updated.sql`). Any table that wants a working "Last updated" can reuse the same trigger function without redefining it.
- `security_details.costs_as_of` / `.performance_as_of` / `.allocation_as_of` — "Data as of" for the three field groups whose freshness most commonly diverges from each other (a security can have a real, dated TER and simultaneously no performance data at all — BPI Dinâmico is exactly this case). Independent and nullable on purpose; not every group needs its own date on every row.
- UI: `js/utils.js:lastUpdatedHTML(date, { label })` renders the small "Last updated: 9 Aug 2026" / "Data as of: 9 Aug 2026" caption consistently (same date formatting, same muted styling) wherever it's called — see that function's own comment for the exact API. Built once, reused per data group, not copy-pasted as one-off strings per page.

## Where this applies beyond Securities

Not implemented everywhere yet — Securities/Security Detail is the first surface. The same pattern is the intended direction for: portfolio valuations, broker information, imported documents/Data Hub jobs, and Cost Engine assumptions, whenever those pages are next touched. Adding the columns/trigger to another table is a small, additive migration each time (same shape as `0007`'s), not a redesign.
