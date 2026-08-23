# Portfolio.io Design System

**Status: source of truth, extracted from the actual codebase (`css/theme.css`, `css/components.css`, `js/utils.js`) as of 2026-08-16.** Nothing below is invented — every value is a direct citation of what's already shipping. This document exists so future UI work (starting with the Overview redesign) has one reference instead of re-deriving the same tokens from scratch each time.

---

## 1. Brand personality

Portfol.io is **sophisticated, calm, analytical, premium** — closer to a well-designed research tool than a consumer fintech app. It is explicitly *not*:

- a crypto dashboard (no neon, no dark-mode-only aesthetic)
- a generic blue/green banking app
- a SaaS admin panel (no dense grey chrome)
- a Bloomberg/TradingView terminal (no maximal information density)
- an overly colourful "gamified" investing app

The existing visual language achieves this through a **warm, pastel, gradient-based palette on a white canvas**, generous whitespace (8pt macro spacing), light-weight typography (KPI values are `font-weight: 300`, not bold), and glass/blur surfaces instead of hard borders. Nothing in the product uses a saturated primary blue or green as its identity colour — that's deliberately reserved so Portfol.io never reads as "just another fintech app."

---

## 2. Colour system

### 2.1 Palette (the only 8 colour families in the product)

Single source of truth: `PALETTE` in `js/utils.js`, mirrored in `theme.css`. Every chart, badge, bar, map dot and icon picks one of these — nothing hardcodes a one-off hex.

| Family | Fill gradient (`from → to`) | Text/legend variant (`PALETTE_TEXT`) |
|---|---|---|
| Amber | `#FFD06A → #FFB34A` | `#B8791E` |
| Orange | `#FFB35F → #FF9447` | `#C46A1F` |
| Coral | `#FF8E73 → #FF6D63` | `#D9503C` |
| Pink | `#FF97B5 → #F56D9A` | `#D1447A` |
| Blue | `#8BC5FF → #67A7F5` | `#2E76C9` |
| Green | `#BFE8B8 → #8FD59C` | `#3D9556` |
| Purple | `#C8BBFF → #9F92F6` | `#6C5CE0` |
| Grey | `#EFEFEF → #DADADA` | `#8A8A8A` |

Two variants exist for a reason: the pastel `{from,to}` stops are tuned for large fills (donut slices, map blobs, progress bars); `PALETTE_TEXT` is the darker, legible variant for small text/dots at 12–13px, where the pastel would fail contrast.

### 2.2 Brand gradient — reserved, not decorative

```css
--gradient-brand: linear-gradient(135deg, #FFD06A 0%, #FF9447 34%, #FF6D63 66%, #F56D9A 100%);
```

Amber → Orange → Coral → Pink. Used **only** for: the logo, the main portfolio performance line, primary buttons, the active nav indicator, hero highlights. Never applied to a selected tab/pill (those use a plain white background + shadow — a state change, not a call to action) and never to a secondary/benchmark series.

### 2.3 Semantic colours (never confuse with identity colours)

| Token | Value | Meaning |
|---|---|---|
| `--positive` | `#6FBF83` | Positive return/change |
| `--negative` | `var(--coral-2)` = `#FF6D63` | Negative return/change |

These answer **"is this good or bad"** and must never double as an identity colour. Coral is both `--negative` *and* the brand/Portfolio-line colour in different contexts — that's intentional (coral is the hero colour throughout), but a component must pick one meaning per instance, never both at once in a way that could read as "the portfolio is a loss."

### 2.4 Identity colours (never confuse with semantic)

These answer **"which series/category is this"**, independent of whether the number is good or bad:

- **Portfolio's own line** (Performance chart, comparison chart): `PALETTE_TEXT.coral` — the brand's hero colour, always.
- **Benchmarks**: `BENCHMARK_SERIES_COLOR = { sp500: PALETTE_TEXT.blue, nasdaq100: PALETTE_TEXT.purple }` (`js/utils.js`). A third benchmark added later gets one more entry here — never reuse coral (reserved for Portfolio) or a semantic colour.
- **Asset classes / accounts / countries / regions**: assigned via `tokenColor(category, key)` (deterministic hash into the 8-family palette) or `familyGradientCSS(name)` for a specific family — see `js/utils.js`.

### 2.5 Neutrals & surface

| Token | Value |
|---|---|
| `--bg` | `#FFFFFF` |
| `--ink` (primary text) | `#2B2724` |
| `--muted` (secondary text) | `#8A807A` |
| `--card` | `#FFFFFF` |
| `--border` | `var(--grey-1)` = `#EFEFEF` |
| `--card-border` | `color-mix(in oklab, var(--border) 60%, transparent)` |
| `--glass-bg` | `linear-gradient(150deg, rgba(255,255,255,.88), rgba(255,255,255,.58))` |
| `--glass-quiet-bg` | `rgba(255,255,255,.55)` |

---

## 3. Typography

Font stack: `"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`.

| Token | Size | Used for |
|---|---|---|
| `--fs-page-title` | `clamp(1.5rem, 1.2rem + 1.5vw, 2rem)` (24→32px) | Page `<h1>` |
| `--fs-section-title` | `1.25rem` (20px) | Reserved for multi-card group headers (not yet used) |
| `--fs-card-title` | `15px` | `.section-title` — every card header |
| `--fs-kpi-value` | `clamp(1.5rem, 1.2rem + 1.6vw, 2.125rem)` (24→34px), weight **300** | KPI tile values |
| `--fs-perf-value` | `clamp(2.2rem, 1.6rem + 2.8vw, 3.2rem)`, weight 300 | The ONE number allowed larger than KPI scale — today the Performance card's headline % |
| `--fs-body` | `14px` | Table cells, general body text |
| `--fs-caption` | `12px` | `.kpi-sub`, table headers, secondary metadata |

Two deliberate rules worth preserving: (1) KPI/perf values are light-weight (300), never bold — weight signals hierarchy through *size*, not boldness, in this system; (2) `--fs-perf-value` exists specifically so one number per page can "read at a glance" larger than the KPI grid — currently that's the Performance card's TWR headline. Any redesign that introduces a second oversized number should reconsider whether it dilutes this hierarchy.

---

## 4. Cards

Single primitive, `.card` (+ `.glass` for the blur surface, `.interactive` for hover-lift):

```css
.card {
  border-radius: var(--r-3xl);      /* 32px */
  padding: var(--sp-8);              /* 32px */
  display: flex;
  flex-direction: column;
}
.card.interactive:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); }
.card.interactive[data-drill-type] { cursor: pointer; }   /* only whole-card click targets get the pointer cursor */
```

- **Header**: `.card-header` (title + optional right-aligned action) → `.card-header-title` wraps an `<h2 class="section-title">`. If a `.section-hint` paragraph follows immediately, the header's bottom margin tightens (`.card-header:has(+ .section-hint)`) so the hint reads as part of the header block.
- **Info affordance**: titles carrying `data-info="..."` become the popover trigger directly — a soft underline fading in on hover/focus (`text-decoration-color` transition). **No separate (i) icon button anywhere in the product.** This is an established, deliberate pattern — do not reintroduce icon-triggered popovers.
- **Sizing philosophy**: cards size to their own content (`flex-direction: column`), not to a paired sibling's height. If two cards must visually align (chart | allocation, side by side), that's achieved via the grid row, not by forcing card heights to match artificially.

---

## 5. Spacing

8pt-derived scale, explicit steps only — **no in-between values**, ever:

```css
--sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;  --sp-4: 16px;
--sp-6: 24px; --sp-8: 32px; --sp-12: 48px;
```

If a layout seems to need e.g. 20px or 28px, the fix is to reconsider the layout against these seven steps, not to add a new token or a one-off value. `--r-*` (radius) follows the same discipline, derived from `--radius: 1.25rem` (sm=12, md=16, lg=20, xl=24, 2xl=28, 3xl=32, pill=999px).

---

## 6. Buttons, pills, toggles

Three related-but-distinct primitives — do not conflate them:

| Component | Class | Selection model | Visual |
|---|---|---|---|
| Filter pill (time range) | `.filter-pill` inside `.filter-pills` | Mutually exclusive (one active) | Active = white bg + `--shadow-float`, inactive = transparent/muted text |
| Tab | `.tab-btn` inside `.tab-bar` | Mutually exclusive | Same visual language as filter-pill |
| Benchmark toggle | `.benchmark-toggle-pill` inside `.benchmark-toggle-row` | **Multi-select** (any combination) | Same active/inactive visual as filter-pill, **plus** a `.toggle-dot` carrying that series' own identity colour (dim at 0.35 opacity when inactive, full opacity when active) |

None of these three ever uses the brand gradient — a selected pill/tab is a state change, not a CTA (explicit rule, `components.css` comment on `.tab-btn.active`). Primary buttons (not yet common on Overview) are the only place the brand gradient appears as a background.

---

## 7. Tables

`.holdings-table` is the one data-table primitive in the product: 14px body text, 12px muted uppercase-weight headers, `border-top` row dividers (not full grid lines), first column left-aligned + all others right-aligned except the 2nd column (name/label), hover row tint, `cursor: pointer` on rows that drill down.

---

## 8. Data visualisation rules

These are the load-bearing rules — violating them has caused real correctness bugs before (see `0018_benchmark_index_level_restructure.sql`'s own header comment: mixing an ETF-price scale and an index-level scale in one series produced a fake ~85% "jump").

1. **Portfolio's own line is always `PALETTE_TEXT.coral`.** Never reassign it per-chart.
2. **Each benchmark gets one fixed colour for its whole lifetime** (`BENCHMARK_SERIES_COLOR`), shared between every chart that shows it — Overview and Performance must never show S&P 500 in a different colour from each other.
3. **Every series carries a `real: true/false` and (where relevant) a `frequency: 'daily'|'monthly'` flag through the whole pipeline.** No chart may imply daily coverage from monthly data, and no chart may fabricate a smoothing point between two real observations. This is enforced today by `scopedPerformance()`/`chainLinkedReturn()` (portfolio side) and `benchmark_history.frequency` (benchmark side) — both already correctly handle sparse/irregular real observation dates with zero special-casing.
4. **Normalized comparison series are rebased to 100 at their shared overlapping start date**, never at each series' own individual inception — `buildComparisonSeries()` (`calculations.js`) already does this via `clipToCommonWindow()`, and never fabricates history before any series' real first point.
5. **Legend labels carry the real identifier**, not a proxy's: `${name} (${symbol})` → "S&P 500 (SPX)", "Nasdaq-100 (NDX)" — never "SPY"/"QQQ". This is already the case in `benchmarks.symbol` as of migration `0018`.
6. **Insufficient-history state**: `renderInsufficientData(container, message)` — a plain, honest message, never a fabricated flat line or a hidden chart.
7. **Public/signed-out mode never hides the curve, only its scale**: `indexValueSeries()` rebases the same real series to start at 100 rather than substituting a different (or blank) chart. The shape of the line is always real; only whether the axis shows € or an index number changes.

---

## 9. Layout

- Two-column Overview grid: `.overview-columns` → `.overview-left` (~62.5%, primary analytical: KPIs, Performance) / `.overview-right` (supporting: Allocation, Holdings, Health/Insights). Collapses to a single column under `layout.css`'s responsive breakpoints (not re-derived here — see that file).
- No fixed page max-width beyond what `#main`/`.overview-columns` already define in `layout.css`; cards fill the available column width.
- `[hidden]` is force-`display:none` app-wide (`layout.css`) — any element toggled by the `.hidden` DOM property is guaranteed to actually disappear, regardless of its own `display` rule.

---

## 10. What NOT to change without a strong reason

- The pastel/gradient palette, the coral-as-hero-and-negative dual role, and the light-weight (300) KPI typography are the core of "looks like Portfol.io." A redesign that swaps these for a conventional SaaS blue/bold-numbers look would stop looking like this product.
- The (i)-icon-free info-popover pattern (title itself is the trigger) is an explicit, deliberate choice from an earlier pass — do not reintroduce icon buttons.
- The 7-step spacing scale and card sizing-to-content philosophy are meant to prevent exactly the kind of per-card one-off styling that made earlier versions of this app inconsistent.
