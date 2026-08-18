/* ============================================================
   performance.js - the Performance page ("how has my portfolio done?").
   Reads data.history.valueSeries + data.analytics.performance, the exact
   fields Overview's Performance card already reads (analytics.js/
   repository.js - getPortfolioDataAuto()) - this page is that card's
   full detail, never a second computation of TWR/XIRR. The range-filter
   logic below is this repo's own prior Overview implementation (see
   git history, js/app.js before the shell-review pass), ported here
   because that's exactly where docs/information-architecture.md always
   said it belonged, not rebuilt from scratch.
   ============================================================ */

function $(id) { return document.getElementById(id); }

/** Ranges shorter than the series' real granularity legitimately resolve
    to <2 points - that renders as "insufficient data" (see draw() below),
    same honesty rule as everywhere else in this app, never a stretched
    or interpolated-to-fit line. */
const RANGE_DAYS = { "1M": 30, "3M": 91, "1Y": 365, "3Y": 365 * 3 };

function filterSeriesByRange(series, range) {
  if (range === "All") return series;
  const lastDate = new Date(series[series.length - 1].date);
  const startDate = range === "YTD"
    ? new Date(lastDate.getFullYear(), 0, 1)
    : new Date(lastDate.getTime() - RANGE_DAYS[range] * 86400000);
  return series.filter((p) => new Date(p.date) >= startDate);
}

/** Compact "Mon 'YY" x-axis tick label - the tooltip keeps the full ISO
    date, this is only for the axis where 100+ points need to fit. */
function formatDateTick(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(" ", " '");
}

let perfFilterClickHandler = null;
let perfResizeHandler = null;

function renderValueChart(data) {
  const container = $("perf-linechart-container");
  const filtersEl = $("perf-filters");
  const series = data.history.valueSeries;

  if (series.length < 2) {
    filtersEl.innerHTML = "";
    renderInsufficientData(container, "Insufficient history - fewer than 2 dated Valuations exist yet for the holding that drives this series. Record another Valuation to see a trend.");
    return;
  }

  const ranges = ["1M", "3M", "YTD", "1Y", "3Y", "All"];
  // Preserve whichever range was selected across a redraw (sign-in/out
  // re-fetches and calls this again) - toggling auth shouldn't silently
  // reset the chosen time window.
  const activeRange = filtersEl.querySelector(".filter-pill.active")?.dataset.range || "All";
  filtersEl.innerHTML = ranges.map((r) =>
    `<button class="filter-pill${r === activeRange ? " active" : ""}" data-range="${r}" type="button">${r}</button>`
  ).join("");

  const draw = (range) => {
    const rawPoints = filterSeriesByRange(series, range);
    if (rawPoints.length < 2) {
      renderInsufficientData(container, `Not enough historical data for "${range}" yet. Try a wider range.`);
      return;
    }
    // Showcase mode: the curve never disappears, only its scale does -
    // rebase to an index (first point = 100) and drop the euro sign.
    const owner = isOwnerMode();
    const points = owner ? rawPoints : indexValueSeries(rawPoints);
    renderLineChart(container, points, {
      formatValue: owner ? fmtEUR : (v) => String(Math.round(v)),
      formatAxisValue: owner ? undefined : (v) => String(Math.round(v)),
      formatDateLabel: formatDateTick,
    });
  };
  draw(activeRange);

  if (perfFilterClickHandler) filtersEl.removeEventListener("click", perfFilterClickHandler);
  perfFilterClickHandler = (e) => {
    const btn = e.target.closest(".filter-pill");
    if (!btn) return;
    filtersEl.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    draw(btn.dataset.range);
  };
  filtersEl.addEventListener("click", perfFilterClickHandler);

  if (perfResizeHandler) window.removeEventListener("resize", perfResizeHandler);
  perfResizeHandler = () => draw(filtersEl.querySelector(".active")?.dataset.range || "All");
  window.addEventListener("resize", perfResizeHandler);
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

function renderStats(data) {
  const perf = data.analytics.performance;
  const owner = isOwnerMode();

  // *Available flags come straight from analytics.js/repository.js (the
  // calculation layer), never re-derived here - "insufficient history"
  // shows instead of a technically-computed-but-meaningless 0%, per the
  // same rule the chart's own insufficient-data state already follows.
  const totalReturnValue = perf.totalReturnAvailable ? fmtPct(perf.totalReturnPct) : "Insufficient history";
  const investorReturnValue = perf.investorReturnAvailable ? fmtPct(perf.investorReturnPct) : "Insufficient history";

  const tiles = [
    statTileHTML({
      iconName: "trendingUp", label: "Total Return (TWR)", docKey: "investment-performance",
      value: totalReturnValue,
      note: perf.totalReturnAvailable ? `since ${data.history.inceptionDate}` : "not enough dated valuations yet",
      drillId: "return",
    }),
    statTileHTML({
      iconName: "barChart3", label: "Investor Return (XIRR)", docKey: "investor-return",
      value: investorReturnValue,
      note: perf.investorReturnAvailable ? "annualised, money-weighted" : "not enough cash flows yet",
      drillId: "investorReturn",
    }),
    statTileHTML({
      iconName: "wallet", label: "Unrealised Gain", docKey: "investment-return",
      value: owner ? fmtEUR(perf.unrealisedGain, { signed: true }) : fmtPct(perf.unrealisedGainPct),
      note: "vs. invested capital",
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
function renderAnnualReturns(data) {
  const container = $("annual-returns-body");
  const years = data.analytics.performance.yearlyReturns || {};
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

function renderBenchmarkSection(data) {
  const body = $("benchmark-body");
  const hasPerformanceSeries = data.history.performanceSeries && data.history.performanceSeries.length >= 2;
  const availableBenchmarks = (data.history.benchmarks || []).filter((b) => b.series && b.series.length >= 2);

  if (!hasPerformanceSeries || !availableBenchmarks.length) {
    const reason = !hasPerformanceSeries
      ? "Not enough dated Valuations yet to compute a cash-flow-neutral performance series."
      : "Benchmark history isn't available yet.";
    renderInsufficientData(body, `Insufficient history to compare against a benchmark yet. ${reason}`);
    return;
  }

  const seriesDefs = [
    { key: "portfolio", label: "Portfolio", color: PALETTE_TEXT.coral, points: data.history.performanceSeries },
    ...availableBenchmarks.map((b) => ({
      key: b.id, label: `${b.name}${b.symbol ? ` (${b.symbol})` : ""}${b.dataType === "price_return" ? " · Price Return" : ""}`,
      color: BENCHMARK_SERIES_COLOR[b.id] || PALETTE_TEXT.green, points: b.series,
    })),
  ];

  body.innerHTML = `
    <div class="benchmark-toggle-row" id="perf-benchmark-toggle-row"></div>
    <div id="perf-benchmark-chart-container"></div>
    <div class="benchmark-stats-row" id="perf-benchmark-stats-row"></div>
    <p class="chart-legend-note">Price Return - splits-adjusted, not dividend-adjusted. Not directly comparable to a total-return figure.</p>`;

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

function renderQuantMetrics(data) {
  const container = $("quant-metrics-grid");
  const quant = data.analytics.performance.quant;

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
    subtitle: "How has your portfolio performed - not any single holding's market price.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  const loadAndRender = async (data) => {
    setCurrentPortfolioData(data);
    renderDataWarning(data);
    renderStats(data);
    renderValueChart(data);
    renderAnnualReturns(data);
    renderBenchmarkSection(data);
    renderQuantMetrics(data);
  };

  onAuthChange(async () => { loadAndRender(await getPortfolioDataAuto()); });
  await initAuth();
  await loadAndRender(await getPortfolioDataAuto());
}

document.addEventListener("DOMContentLoaded", init);
