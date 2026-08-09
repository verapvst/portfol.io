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

/* ---------- Benchmark comparison ----------
   Honest "not built yet" state, not a placeholder chart - see the
   benchmark-comparison info popover (shell.js) for exactly what's
   missing (a chosen benchmark + benchmark_history, both genuinely
   nonexistent in Supabase today; daily_prices exists but its fetch is
   still paused). Reuses renderInsufficientData (charts.js), the same
   component the value chart falls back to - one "we don't have this
   yet" component, not a bespoke empty state per section. */
function renderBenchmarkSection() {
  renderInsufficientData(
    $("benchmark-body"),
    "No benchmark is configured, and comparing to one needs daily indexed prices that haven't been resumed yet. Once a benchmark is chosen and its history exists, this compares your Time-Weighted Return against it - not just its raw price."
  );
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
  };

  renderBenchmarkSection();

  onAuthChange(async () => { loadAndRender(await getPortfolioDataAuto()); });
  await initAuth();
  await loadAndRender(await getPortfolioDataAuto());
}

document.addEventListener("DOMContentLoaded", init);
