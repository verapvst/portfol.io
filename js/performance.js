/* ============================================================
   performance.js - the Performance page ("how has my portfolio done?" -
   returns only; "how much capital is here" lives on the separate
   Capital page, js/capital.js, per the Performance & Capital split).
   Reads data.analytics.performance (+ each scope's own dailySeries), the
   exact fields Overview's Performance card already reads (analytics.js/
   repository.js - getPortfolioDataAuto()) - this page is that card's
   full detail, never a second computation of TWR/XIRR. The range-filter
   logic below is this repo's own prior Overview implementation (see
   git history, js/app.js before the shell-review pass), ported here
   because that's exactly where docs/information-architecture.md always
   said it belonged, not rebuilt from scratch.
   ============================================================ */

function $(id) { return document.getElementById(id); }

/* ---------- Scoped period selector (1W/1M/3M/6M/YTD/1Y/Since Inception)
   ----------
   A different range control from Capital's own Portfolio Value Over Time
   filter-pills on purpose - that one filters the raw € chart (always
   whole-portfolio, §13's own "keep these separate" principle). This one
   governs the scoped Total Return stat tile and the Benchmark Comparison
   chart, whichever account/strategy/security/portfolio scope is
   selected.
   Reuses scopedPerformance()'s own dailySeries - never a second return
   calculation: deriveNormalizedDailySeries() (calculations.js) already
   builds it as a true geometric/compounding daily index (one point per
   calendar day, real:false flagging every interpolated one), so the
   ratio between any two of its points IS the correct cash-flow-neutral
   return between those two dates, windowed or not - the "smoothing" is
   multiplicative, not linear, so it preserves this property exactly. */
const SCOPED_RANGE_DAYS = { "1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365 };
const SCOPED_RANGES = ["1W", "1M", "3M", "6M", "YTD", "1Y", "Since Inception"];
let currentScopedRange = "Since Inception";

function windowStartFor(range, asOfDate) {
  if (range === "Since Inception" || !asOfDate) return null;
  if (range === "YTD") return `${new Date(asOfDate).getFullYear()}-01-01`;
  return shiftDateBy(asOfDate, -SCOPED_RANGE_DAYS[range]);
}

/** Real value at/after windowStart (or the whole series when
    windowStart is null) - a windowed slice shorter than 2 points is
    "insufficient history for this period", never a fabricated 0%, same
    honesty rule this app applies everywhere else. */
function windowedReturnFromDailySeries(dailySeries, windowStart) {
  if (!dailySeries || dailySeries.length < 2) return null;
  const filtered = windowStart ? dailySeries.filter((p) => p.date >= windowStart) : dailySeries;
  if (filtered.length < 2 || !filtered[0].value) return null;
  const first = filtered[0], last = filtered[filtered.length - 1];
  return Math.round((last.value / first.value - 1) * 10000) / 100;
}

/** Compact "Mon 'YY" x-axis tick label - the tooltip keeps the full ISO
    date, this is only for the axis where 100+ points need to fit. */
function formatDateTick(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(" ", " '");
}

let currentScopeType = "portfolio"; // "portfolio" | "account" | "strategy" | "security"
let currentScopeId = null; // null for "portfolio", else the account/strategy/security id

/** Returns the {id, name} list for one scope type - the single place
    that knows accounts come from data.portfolio.accounts while
    strategies/securities come from analytics.performance's own
    strategyPerformance/securityPerformance bundles (calculations.js:
    scopedPerformance(), analytics.js). Empty for "strategy" until at
    least one security is tagged (securities.sub_portfolio) - an honest
    empty list, not a placeholder pill. */
function scopeListFor(data, scopeType) {
  if (scopeType === "account") return data.portfolio.accounts;
  if (scopeType === "strategy") return data.analytics.performance.strategyPerformance || [];
  if (scopeType === "security") return data.analytics.performance.securityPerformance || [];
  return [];
}

/** Normalizes "Portfolio" vs. one account/strategy/security into one
    shape every scope-aware section below reads from - same "one seam,
    not one branch per section" discipline scopedPerformance() itself
    uses for portfolio/account/security/strategy. Never a second
    calculation: every field here is read straight from analytics.js's
    own output. Returns null for an unknown/stale scope id (e.g. data
    reloaded without that account) so callers can fall back honestly
    rather than throw. */
function scopeBundle(data, scopeType, scopeId) {
  if (scopeType === "portfolio") {
    const perf = data.analytics.performance;
    return {
      label: "Portfolio",
      totalReturnPct: perf.totalReturnPct,
      totalReturnAvailable: perf.totalReturnAvailable,
      insufficientReason: null,
      firstDate: data.history.inceptionDate,
      dailySeries: data.history.performanceSeries,
      yearlyReturns: perf.yearlyReturns,
      quant: perf.quant,
    };
  }
  const item = scopeListFor(data, scopeType).find((x) => x.id === scopeId);
  if (!item) return null;
  return {
    label: item.name,
    totalReturnPct: item.totalReturnPct,
    totalReturnAvailable: item.totalReturnAvailable,
    insufficientReason: item.insufficientReason,
    firstDate: item.firstDate,
    dailySeries: item.dailySeries,
    yearlyReturns: item.yearlyReturns,
    quant: item.quant,
  };
}

/* ---------- Stat tiles ----------
   Same .kpi-card visual component Overview's Snapshot grid uses
   (components.css) - reused for its look, not its Overview-specific
   content (buildKpiViewModels in ui.js stays Overview-only, it answers
   "what do I have", these three answer "how did it do"). */

function statTileHTML({ iconName, label, docKey, value, note, drillId }) {
  const drillAttrs = drillId ? ` data-drill-type="kpi" data-drill-id="${drillId}" tabindex="0" role="button" aria-label="${label} details"` : "";
  return `
    <div class="card glass interactive kpi-card rise"${drillAttrs}>
      <div class="kpi-top">
        <span class="kpi-icon">${icon(iconName)}</span>
        <p class="kpi-label" data-info="${docKey}" tabindex="0" role="button" aria-label="About this metric">${label}</p>
      </div>
      <p class="kpi-value">${value}</p>
      <p class="kpi-sub">${note}</p>
    </div>`;
}

function renderStats(data, scopeType, scopeId) {
  const bundle = scopeBundle(data, scopeType, scopeId);

  // Total Return here is windowed by currentScopedRange (the period pill
  // row). "Since Inception" reads bundle.totalReturnPct/
  // totalReturnAvailable directly - the authoritative figure computed by
  // analytics.js, not re-derived - because the signed-out/public path
  // (getPortfolioDataPublic()) never populates a dailySeries at all (its
  // privacy-preserving RPCs don't expose real cash-flow amounts to build
  // one from), yet still legitimately has a since-inception TWR from the
  // older date-boundary engine. Any OTHER range genuinely needs the
  // dailySeries to isolate a sub-window, so those correctly read
  // "Insufficient history" on that path instead - an honest gap, not a
  // regression, since a windowed cash-flow-neutral return can't be
  // computed from what anon is ever given.
  const isSinceInception = currentScopedRange === "Since Inception";
  const asOfDate = bundle?.dailySeries?.length ? bundle.dailySeries[bundle.dailySeries.length - 1].date : null;
  const windowedPct = isSinceInception
    ? bundle?.totalReturnPct
    : windowedReturnFromDailySeries(bundle?.dailySeries, windowStartFor(currentScopedRange, asOfDate));
  const totalReturnAvailable = isSinceInception ? !!bundle?.totalReturnAvailable : windowedPct != null;
  const totalReturnValue = totalReturnAvailable ? fmtPct(windowedPct) : "Insufficient history";
  const totalReturnNote = totalReturnAvailable
    ? (isSinceInception ? `since ${bundle.firstDate}` : `over ${currentScopedRange}`)
    : "not enough dated valuations in this period";

  if (scopeType === "portfolio") {
    const perf = data.analytics.performance;
    // Investor Return (XIRR) is a money-weighted concept tied to the
    // whole portfolio's own cash flows - deliberately not windowed by
    // the period selector above (a "1W XIRR" isn't a meaningful figure)
    // and deliberately portfolio-only, same as before. Unrealised Gain
    // moved to the Capital page (Performance & Capital split) - it's a
    // € gain against cost basis, not a %-return, so it no longer
    // competes for space in this returns-only tile row.
    const investorReturnValue = perf.investorReturnAvailable ? fmtPct(perf.investorReturnPct) : "Insufficient history";

    const tiles = [
      statTileHTML({
        iconName: "trendingUp", label: "Total Return (TWR)", docKey: "investment-performance",
        value: totalReturnValue, note: totalReturnNote, drillId: "return",
      }),
      statTileHTML({
        iconName: "barChart3", label: "Investor Return (XIRR)", docKey: "investor-return",
        value: investorReturnValue,
        note: perf.investorReturnAvailable ? "annualised, money-weighted, since inception" : "not enough cash flows yet",
        drillId: "investorReturn",
      }),
    ];
    $("perf-stats-grid").innerHTML = tiles.join("");
    return;
  }

  // Account/strategy/security scope - Investor Return (XIRR) and
  // Unrealised Gain are portfolio-only concepts today (no per-scope
  // cash-flow/cost-basis aggregation exists for those two specifically).
  // Replaced with Volatility/Max Drawdown - genuine scope-level risk
  // facts already computed by scopedQuantMetrics(), never a fabricated
  // stand-in for the two tiles they take the place of.
  const vol = bundle?.quant?.volatility;
  const dd = bundle?.quant?.maxDrawdown;

  const tiles = [
    statTileHTML({
      iconName: "trendingUp", label: "Total Return (TWR)", docKey: "account-performance",
      value: totalReturnValue,
      note: totalReturnAvailable
        ? totalReturnNote
        : (bundle?.insufficientReason === "too-recent" ? "not enough real days yet" : "not enough dated valuations yet"),
    }),
    statTileHTML({
      iconName: "activity", label: "Volatility (ann.)", docKey: "quant-risk-metrics",
      value: vol ? fmtPct(vol.annualisedVolatilityPct, { signed: false }) : "Insufficient history",
      note: vol ? `${vol.periodCount} real periods` : "not enough real periods yet",
    }),
    statTileHTML({
      iconName: "barChart3", label: "Max Drawdown", docKey: "quant-risk-metrics",
      value: dd ? fmtPct(dd.maxDrawdownPct, { signed: true }) : "Insufficient history",
      note: dd ? "peak-to-trough, full history" : "not enough real periods yet",
    }),
  ];
  $("perf-stats-grid").innerHTML = tiles.join("");
}

/* ---------- Annual returns ----------
   Same chain-linked TWR the headline number uses, sliced by calendar
   year (calculations.js:annualReturns()) - a different view, not a
   different calculation. Percentages only, shown identically whether
   signed in or not (same precedent as the headline TWR/XIRR tiles
   above - a %-return reveals nothing about portfolio size). */
function renderAnnualReturns(data, scopeType, scopeId) {
  const container = $("annual-returns-body");
  const bundle = scopeBundle(data, scopeType, scopeId);
  $("annual-returns-title").textContent = scopeType === "portfolio" ? "Annual Returns" : `Annual Returns — ${bundle?.label || ""}`;
  const years = bundle?.yearlyReturns || {};
  const entries = Object.entries(years).sort(([a], [b]) => Number(a) - Number(b));

  if (!entries.length) {
    renderInsufficientData(container, "Not enough dated history yet to break performance down by year.");
    return;
  }

  const currentYear = new Date().getFullYear();
  const rows = entries.map(([year, y]) => {
    const label = Number(year) === currentYear ? `${year} YTD` : year;
    if (!y.hasObservationInYear) {
      return `
        <div class="annual-return-row">
          <span class="annual-return-year">${label}</span>
          <span class="annual-return-value text-muted">No data</span>
        </div>`;
    }
    const tone = y.returnPct > 0 ? "up" : y.returnPct < 0 ? "down" : "text-muted";
    return `
      <div class="annual-return-row">
        <span class="annual-return-year">${label}</span>
        <span class="annual-return-value ${tone}">${fmtPct(y.returnPct)}</span>
      </div>`;
  }).join("");

  container.innerHTML = `<div class="annual-returns-list">${rows}</div>`;
}

/* ---------- Benchmark comparison ----------
   Real now (supabase/migrations/0016_benchmark_and_fx_history.sql,
   Performance & Benchmark Engine plan) - reads history.performanceSeries
   (scopedPerformance()'s own cash-flow-neutral normalized daily index,
   NEVER history.valueSeries - see app.js's initPerformanceCard for why)
   and history.benchmarks (real benchmark_history rows, analytics.js's
   loadBenchmarkSeries()). Same buildComparisonSeries()/
   renderMultiLineChart() primitives Overview's Performance card uses -
   one comparison engine, not a second one built for this page. Only
   falls back to renderInsufficientData() when there's genuinely not
   enough real, overlapping history yet - never because the feature
   itself isn't built. */
let perfBenchmarkResizeHandler = null;

function renderBenchmarkSection(data, scopeType, scopeId) {
  const body = $("benchmark-body");
  const bundle = scopeBundle(data, scopeType, scopeId);
  $("benchmark-comparison-title").textContent = scopeType === "portfolio" ? "Benchmark Comparison" : `Benchmark Comparison — ${bundle?.label || ""}`;

  // Windowed by the same period selector as the stat tile above (§7/§11/
  // §12: "the starting point for the selected period should be 100") -
  // buildComparisonSeries() re-clips and re-rebases to 100 at whatever
  // window is handed to it, so filtering both series to the period
  // BEFORE that call is all "select a period" needs to mean here.
  // Benchmarks are monthly-only (0019) - a short window (1W, say) will
  // often correctly resolve to "insufficient overlapping history" below,
  // which is the honest outcome, not a bug.
  const asOfDate = bundle?.dailySeries?.length ? bundle.dailySeries[bundle.dailySeries.length - 1].date : null;
  const windowStart = windowStartFor(currentScopedRange, asOfDate);
  const scopedSeries = windowStart ? (bundle?.dailySeries || []).filter((p) => p.date >= windowStart) : bundle?.dailySeries;
  const hasPerformanceSeries = scopedSeries && scopedSeries.length >= 2;
  const availableBenchmarks = (data.history.benchmarks || [])
    .map((b) => ({ ...b, series: windowStart ? b.series.filter((p) => p.date >= windowStart) : b.series }))
    .filter((b) => b.series && b.series.length >= 2);

  if (!hasPerformanceSeries || !availableBenchmarks.length) {
    const reason = !hasPerformanceSeries
      ? `Not enough dated Valuations in this period (${currentScopedRange}) to compute a cash-flow-neutral performance series.`
      : `Benchmark history doesn't have enough points in this period (${currentScopedRange}) - benchmark data is monthly, so a short window may genuinely have fewer than 2 observations.`;
    renderInsufficientData(body, `Insufficient history to compare against a benchmark yet. ${reason}`);
    return;
  }

  // key stays "portfolio" only at portfolio scope, matching
  // renderMultiLineChart()'s own convention for which series gets the
  // brand gradient stroke and (via valueLookup below) the real € figure
  // in its tooltip line - an account/strategy/security scope has no
  // raw € series of its own in the data model, so it draws as a plain
  // named series instead, same honest gap js/capital.js:renderValueChart()
  // (Portfolio Value Over Time, moved there in the Performance & Capital
  // split) already documents for the raw € chart.
  const seriesDefs = [
    { key: scopeType === "portfolio" ? "portfolio" : "scope", label: bundle.label, color: PALETTE_TEXT.coral, points: scopedSeries },
    ...availableBenchmarks.map((b) => ({
      key: b.id, label: `${b.name}${b.symbol ? ` (${b.symbol})` : ""}${BENCHMARK_DATA_TYPE_LABEL[b.dataType] || ""}`,
      color: BENCHMARK_SERIES_COLOR[b.id] || PALETTE_TEXT.green, points: b.series,
    })),
  ];
  // Real € value per date, for the tooltip only - owner-gated (money-
  // sensitive), and only meaningful at portfolio scope (see comment
  // above). data.history.valueSeries is the raw, un-rebased series.
  const valueLookup = (scopeType === "portfolio" && isOwnerMode())
    ? Object.fromEntries((data.history.valueSeries || []).map((p) => [p.date, fmtEUR(p.value)]))
    : null;

  // Caveat driven by the ACTUAL data_type(s) among the benchmarks being
  // shown, not a hardcoded assumption - this used to always say "Price
  // Return - splits-adjusted", left over from the retired SPY/QQQ ETF-
  // proxy source (0016), even after 0018/0023 switched to real SPX/NDX
  // index levels (data_type='index_level'). Wrong caveat is worse than
  // none: it told the reader the wrong thing was missing.
  const BENCHMARK_DATA_TYPE_NOTE = {
    price_return: "splits-adjusted, not dividend-adjusted",
    index_level: "raw index level, not dividend-adjusted",
    total_return: "dividend-adjusted total return",
  };
  const shownDataTypes = [...new Set(availableBenchmarks.map((b) => b.dataType).filter(Boolean))];
  // "Indexed to 100" stated plainly, not just implied by the chart's own
  // shape - recruiter-readiness audit §6: a multi-line chart that goes
  // up and down reads as "value" by default, this is a rebased RETURN
  // comparison (every series starts at 100, regardless of how large the
  // real portfolio or index actually is).
  const legendNote = shownDataTypes.length
    ? `Indexed to 100 at the start of this window - shows RETURN, not value. Benchmark data: ${shownDataTypes.map((t) => BENCHMARK_DATA_TYPE_NOTE[t] || t).join("; ")}. The portfolio's own return above already reflects all real cash-flow effects - a benchmark without dividends isn't a strict like-for-like comparison.`
    : "";

  body.innerHTML = `
    <div class="benchmark-toggle-row" id="perf-benchmark-toggle-row"></div>
    <div id="perf-benchmark-chart-container"></div>
    <div class="benchmark-stats-row" id="perf-benchmark-stats-row"></div>
    ${legendNote ? `<p class="chart-legend-note">${legendNote}</p>` : ""}`;

  const toggleRow = $("perf-benchmark-toggle-row");
  const chartContainer = $("perf-benchmark-chart-container");
  const statsRow = $("perf-benchmark-stats-row");

  toggleRow.innerHTML = seriesDefs.map((s) =>
    `<button class="benchmark-toggle-pill active" type="button" data-key="${s.key}"><span class="toggle-dot" style="background:${s.color}"></span>${s.label}</button>`
  ).join("");

  const draw = () => {
    const activeKeys = new Set(
      [...toggleRow.querySelectorAll(".benchmark-toggle-pill.active")].map((el) => el.dataset.key)
    );
    const selected = seriesDefs.filter((s) => activeKeys.has(s.key));
    const comparison = buildComparisonSeries(selected);
    if (!comparison.length) {
      renderInsufficientData(chartContainer, "Insufficient overlapping history to compare the selected series yet.");
      statsRow.innerHTML = "";
      return;
    }
    renderMultiLineChart(chartContainer, comparison, {
      formatValue: (v) => v.toFixed(1),
      formatDateLabel: formatDateTick,
      valueLookup,
    });
    // Cumulative return over the SHARED compared window (not each
    // series' own full history) - "if everything started at 100" only
    // means something once every line is being read from the same
    // starting date (plan doc section 6/12).
    statsRow.innerHTML = comparison.map((s) => {
      const last = s.points[s.points.length - 1].value;
      const returnPct = last - 100;
      const tone = returnPct > 0 ? "up" : returnPct < 0 ? "down" : "text-muted";
      return `
        <div class="benchmark-stat">
          <span class="benchmark-stat-label"><span class="toggle-dot" style="background:${s.color}"></span>${s.label}</span>
          <span class="benchmark-stat-value ${tone}">${fmtPct(returnPct)}</span>
        </div>`;
    }).join("");
  };
  draw();

  toggleRow.querySelectorAll(".benchmark-toggle-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const activeCount = toggleRow.querySelectorAll(".benchmark-toggle-pill.active").length;
      if (btn.classList.contains("active") && activeCount === 1) return;
      btn.classList.toggle("active");
      draw();
    });
  });

  if (perfBenchmarkResizeHandler) window.removeEventListener("resize", perfBenchmarkResizeHandler);
  perfBenchmarkResizeHandler = draw;
  window.addEventListener("resize", perfBenchmarkResizeHandler);
}

/* ---------- Risk & Quant Metrics ----------
   Phase 3 (Product & Architecture Re-Think plan §12) - Volatility/Max
   Drawdown/Sharpe/Sortino/Beta/Alpha/Correlation, all computed by
   calculations.js:scopedQuantMetrics() from the exact same subPeriods/
   dailySeries the headline TWR and Benchmark Comparison above already
   produced - never a second performance calculation. Each tile checks
   its OWN availability, not just the card-level one: a real portfolio
   can have enough real periods for Volatility/Max Drawdown while still
   not having enough aligned benchmark months for Beta, or a risk-free
   feed outage that only blocks Sharpe/Sortino/Alpha - one blanket
   "insufficient" would hide metrics that are genuinely computable. */
function quantTileHTML({ iconName, label, docKey, value, note }) {
  return `
    <div class="card glass interactive kpi-card rise">
      <div class="kpi-top">
        <span class="kpi-icon">${icon(iconName)}</span>
        <p class="kpi-label" data-info="${docKey}" tabindex="0" role="button" aria-label="About this metric">${label}</p>
      </div>
      <p class="kpi-value">${value}</p>
      <p class="kpi-sub">${note}</p>
    </div>`;
}

function renderQuantMetrics(data, scopeType, scopeId) {
  const container = $("quant-metrics-grid");
  const bundle = scopeBundle(data, scopeType, scopeId);
  $("quant-metrics-title").textContent = scopeType === "portfolio" ? "Risk & Quant Metrics" : `Risk & Quant Metrics — ${bundle?.label || ""}`;
  const quant = bundle?.quant;

  if (!quant || !quant.available) {
    renderInsufficientData(container, "Insufficient history to compute risk metrics yet - Volatility, Max Drawdown and the rest all need a handful of real dated Valuations spread out over time before a statistic like this means anything.");
    return;
  }

  const INSUFFICIENT = "Insufficient history";
  const benchmarkName = (data.history.benchmarks || [])
    .find((b) => b.id === data.analytics.performance.regressionBenchmarkId)?.name || "benchmark";

  const tiles = [
    quantTileHTML({
      iconName: "activity", label: "Volatility (ann.)", docKey: "quant-risk-metrics",
      value: quant.volatility ? fmtPct(quant.volatility.annualisedVolatilityPct, { signed: false }) : INSUFFICIENT,
      note: quant.volatility ? `${quant.volatility.periodCount} real periods` : "not enough real periods yet",
    }),
    quantTileHTML({
      iconName: "barChart3", label: "Max Drawdown", docKey: "quant-risk-metrics",
      value: quant.maxDrawdown ? fmtPct(quant.maxDrawdown.maxDrawdownPct, { signed: true }) : INSUFFICIENT,
      note: quant.maxDrawdown ? "peak-to-trough, full history" : "not enough real periods yet",
    }),
    quantTileHTML({
      iconName: "target", label: "Sharpe Ratio", docKey: "quant-risk-metrics",
      value: quant.sharpe != null ? quant.sharpe.toFixed(2) : INSUFFICIENT,
      note: quant.riskFreeRatePct != null ? `vs. ${fmtPct(quant.riskFreeRatePct, { signed: false })} risk-free` : "risk-free rate unavailable",
    }),
    quantTileHTML({
      iconName: "target", label: "Sortino Ratio", docKey: "quant-risk-metrics",
      value: quant.sortino != null ? quant.sortino.toFixed(2) : INSUFFICIENT,
      note: "downside deviation only",
    }),
    quantTileHTML({
      iconName: "trendingUp", label: "Beta", docKey: "quant-risk-metrics",
      value: quant.beta != null ? quant.beta.toFixed(2) : INSUFFICIENT,
      note: quant.beta != null ? `vs. ${benchmarkName}` : "not enough aligned months yet",
    }),
    quantTileHTML({
      iconName: "sparkles", label: "Alpha (ann.)", docKey: "quant-risk-metrics",
      value: quant.alphaPct != null ? fmtPct(quant.alphaPct, { signed: true }) : INSUFFICIENT,
      note: "excess return vs. CAPM expectation",
    }),
    quantTileHTML({
      iconName: "globe", label: "Correlation", docKey: "quant-risk-metrics",
      value: quant.correlation != null ? quant.correlation.toFixed(2) : INSUFFICIENT,
      note: quant.regressionObservationCount ? `${quant.regressionObservationCount} aligned months` : "not enough aligned months yet",
    }),
  ];
  container.innerHTML = tiles.join("");
}

/* ---------- Scope selector ----------
   Portfolio / Accounts / Strategies / Securities - a type row plus a
   second pill row for the specific entries within whichever type is
   selected (empty/hidden for "Portfolio", since there's only one).
   Controls the stat tiles, Annual Returns, Benchmark Comparison and
   Risk & Quant Metrics sections below (all already read through
   scopeBundle()). No per-scope raw € value series exists in the data
   model (only each scope's own cash-flow-neutral INDEX, already read
   via scopeBundle().dailySeries for the scoped Benchmark Comparison
   chart) - the raw € chart lives on the Capital page instead (Portfolio
   Value Over Time, whole-portfolio only, no scope selector of its own),
   exactly the "keep Value and Performance separate" split this app's
   design already applies everywhere else. */
function renderScopedSections(data) {
  renderStats(data, currentScopeType, currentScopeId);
  renderAnnualReturns(data, currentScopeType, currentScopeId);
  renderBenchmarkSection(data, currentScopeType, currentScopeId);
  renderQuantMetrics(data, currentScopeType, currentScopeId);
  const hints = {
    portfolio: "Whole-portfolio figures, cash-flow-neutral across every account.",
    account: "Investor Return (XIRR) and Unrealised Gain aren't tracked per account yet - Volatility/Max Drawdown stand in below.",
    strategy: "Strategies group securities via securities.sub_portfolio - Investor Return (XIRR) and Unrealised Gain aren't tracked per strategy yet.",
    security: "This security's own cash-flow-neutral return, using its own buy/sell transactions as cash-flow boundaries - not its market price return.",
  };
  $("perf-scope-hint").textContent = hints[currentScopeType] || "";
}

const SCOPE_TYPES = [
  { type: "portfolio", label: "Portfolio" },
  { type: "account", label: "Accounts" },
  { type: "strategy", label: "Strategies" },
  { type: "security", label: "Securities" },
];

function renderScopeSelector(data) {
  const typeRow = $("perf-scope-type-row");
  const subRow = $("perf-scope-sub-row");

  // A previously-selected entry that no longer exists in a fresh load
  // (different auth state, different data) falls back to "portfolio"
  // rather than leaving no pill active.
  if (currentScopeType !== "portfolio" && !scopeListFor(data, currentScopeType).some((x) => x.id === currentScopeId)) {
    currentScopeType = "portfolio";
    currentScopeId = null;
  }

  const renderSubRow = () => {
    if (currentScopeType === "portfolio") { subRow.innerHTML = ""; subRow.hidden = true; return; }
    const list = scopeListFor(data, currentScopeType);
    subRow.hidden = false;
    if (!list.length) {
      const emptyMsg = currentScopeType === "strategy"
        ? "No strategies tagged yet - tag a security's sub_portfolio field to group it into one (see the Strategies info popover)."
        : "Nothing here yet.";
      subRow.innerHTML = `<p class="section-hint">${emptyMsg}</p>`;
      return;
    }
    if (!list.some((x) => x.id === currentScopeId)) currentScopeId = list[0].id;
    subRow.innerHTML = list.map((x) =>
      `<button class="filter-pill${x.id === currentScopeId ? " active" : ""}" data-id="${x.id}" type="button">${x.name}</button>`
    ).join("");
    subRow.querySelectorAll(".filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentScopeId = btn.dataset.id;
        subRow.querySelectorAll(".filter-pill").forEach((b) => b.classList.toggle("active", b === btn));
        renderScopedSections(data);
      });
    });
  };

  typeRow.innerHTML = SCOPE_TYPES.map((t) =>
    `<button class="filter-pill${t.type === currentScopeType ? " active" : ""}" data-type="${t.type}" type="button">${t.label}</button>`
  ).join("");
  typeRow.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentScopeType = btn.dataset.type;
      currentScopeId = null;
      typeRow.querySelectorAll(".filter-pill").forEach((b) => b.classList.toggle("active", b === btn));
      renderSubRow();
      renderScopedSections(data);
    });
  });

  renderSubRow();
}

/* ---------- Scoped period selector (1W/1M/3M/6M/YTD/1Y/Since Inception)
   ---------- */
function renderScopedRangeSelector(data) {
  const row = $("perf-scoped-range-row");
  row.innerHTML = SCOPED_RANGES.map((r) =>
    `<button class="filter-pill${r === currentScopedRange ? " active" : ""}" data-range="${r}" type="button">${r}</button>`
  ).join("");
  row.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentScopedRange = btn.dataset.range;
      row.querySelectorAll(".filter-pill").forEach((b) => b.classList.toggle("active", b === btn));
      renderScopedSections(data);
    });
  });
}

/** Signed in but the live fetch failed (see analytics.js's
    getPortfolioDataAuto()) - without this, this state is indistinguishable
    from "genuinely on live data, genuinely flat" or from "genuinely signed
    out, correctly on Showcase mock". Only that specific case renders
    anything here. */
function renderDataWarning(data) {
  const el = $("perf-data-warning");
  if (data.metadata.source !== "mock-fallback-error") { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div class="data-warning-banner">
      <b>Showing fallback data</b> - couldn't load your live portfolio data from Supabase, so this is the old placeholder series, not your current numbers.
      ${data.metadata.loadError ? `<br>Error: ${data.metadata.loadError}` : ""}
    </div>`;
}

async function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  initDrillDown();

  renderTopbar($("topbar"), user, {
    heading: "Performance",
    subtitle: "How has your portfolio performed - not any single holding's market price. Looking for contributions or portfolio value over time? See Capital.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  const loadAndRender = async (data) => {
    setCurrentPortfolioData(data);
    renderDataWarning(data);
    renderScopeSelector(data);
    renderScopedRangeSelector(data);
    renderScopedSections(data);
  };

  onAuthChange(async () => { loadAndRender(await getPortfolioDataAuto()); });
  await initAuth();
  await loadAndRender(await getPortfolioDataAuto());
}

document.addEventListener("DOMContentLoaded", init);
