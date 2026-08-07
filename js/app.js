function $(id) { return document.getElementById(id); }

/**
 * Slices the value series (real dates, monthly-ish granularity - see
 * repository.js) by a relative range. Ranges shorter than the series'
 * real granularity legitimately resolve to <2 points - that renders as
 * "insufficient data" rather than an interpolated line, same honesty
 * rule as everywhere else in the app.
 */
const RANGE_DAYS = { "1M": 30, "3M": 91, "1Y": 365, "3Y": 365 * 3 };

function filterSeriesByRange(series, range) {
  if (range === "All") return series;
  const lastDate = new Date(series[series.length - 1].date);
  const startDate = range === "YTD"
    ? new Date(lastDate.getFullYear(), 0, 1)
    : new Date(lastDate.getTime() - RANGE_DAYS[range] * 86400000);
  return series.filter((p) => new Date(p.date) >= startDate);
}

/** Compact "Mon 'YY" x-axis tick label - the tooltip keeps the full
    ISO date, this is only for the axis where 100+ points need to fit. */
function formatDateTick(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(" ", " '");
}

/**
 * Owner Access makes this function re-entrant: it now runs once at init
 * AND again on every ownerMode toggle (see init() below), redrawing the
 * same card in place rather than mounting a second one. The filter/
 * resize listeners it attaches have to be swapped, not stacked, or a
 * few toggles would leave several stale listeners each redrawing with
 * whatever ownerMode happened to be current when they were attached.
 */
let perfFilterClickHandler = null;
let perfResizeHandler = null;

function initPerformanceCard(data) {
  const perf = data.analytics.performance;
  const container = $("linechart-container");
  const filtersEl = $("perf-filters");
  const ranges = ["1M", "3M", "YTD", "1Y", "3Y", "All"];

  $("performance-card").dataset.drillType = "performance";
  $("performance-card").dataset.drillId = "performance";

  // Headline is the return (%), not the current value - "Portfolio Value"
  // already owns that number on the Snapshot KPI. Showing totalValue here
  // too invited exactly the confusion this card used to cause: a euro
  // figure that jumps when you deposit money, sitting under a title that
  // says "Performance". The % is cash-flow-neutral (TWR - see
  // repository.js) so it doesn't have that problem.
  const sign = perf.totalReturnPct > 0 ? "up" : perf.totalReturnPct < 0 ? "down" : "";
  $("perf-value").innerHTML = `<span class="${sign}">${fmtPct(perf.totalReturnPct)}</span>`;
  $("perf-secondary").textContent = isOwnerMode()
    ? `Time-Weighted Return · ${fmtEUR(perf.unrealisedGain, { signed: true })} · ${fmtEUR(perf.totalValue)} today`
    : `Time-Weighted Return since ${data.history.inceptionDate}`;

  // Investor Return (XIRR) lives here, not as a fifth KPI tile - it's a
  // genuinely different question from the TWR headline above ("what did
  // I personally earn, given my own deposit timing") and belongs next
  // to its sibling metric, not competing for space in the compact 2x2.
  $("perf-investor-return-value").textContent = fmtPct(perf.investorReturnPct);

  // Preserve whichever range was selected across a redraw - toggling
  // Owner Access shouldn't silently reset the user's chosen time window.
  const activeRange = filtersEl.querySelector(".filter-pill.active")?.dataset.range || "All";
  filtersEl.innerHTML = ranges.map((r) =>
    `<button class="filter-pill${r === activeRange ? " active" : ""}" data-range="${r}">${r}</button>`
  ).join("");

  const draw = (range) => {
    const rawPoints = filterSeriesByRange(data.history.valueSeries, range);
    if (rawPoints.length < 2) {
      renderInsufficientData(container, `Not enough historical data for "${range}" yet - the portfolio's value series is currently yearly, not monthly. Try "1Y" or "All".`);
      return;
    }
    // Public mode: the curve never disappears, only its scale does -
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
  perfResizeHandler = () => {
    const active = filtersEl.querySelector(".active").dataset.range;
    draw(active);
  };
  window.addEventListener("resize", perfResizeHandler);
}

/** Everything below reads from `data`, captured in this closure so a
    later re-fetch (sign-in/sign-out - see init()) can redraw the whole
    page in place, the same way Owner Access already redraws the 3
    money-sensitive sections in place on every unlock/relock. */
function renderAll(data) {
  const renderMoneySensitiveSections = () => {
    renderSnapshot($("kpi-grid"), buildKpiViewModels(data));
    initPerformanceCard(data);
    renderHoldingsTable($("holdings-table"), data.portfolio.holdings);
  };
  renderMoneySensitiveSections();
  onOwnerModeChange(renderMoneySensitiveSections);

  renderAllocationTabs($("allocation-tabs"), data);

  renderExposure({
    tabsEl: $("exposure-tabs"),
    vizEl: $("exposure-viz"),
    hintEl: $("exposure-hint"),
    titleEl: document.querySelector("#exposure-card .card-header-title"),
  }, data);

  renderPortfolioHealth($("portfolio-health"), data);
  renderInsights($("portfolio-insights"), data);
}

async function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  initDrillDown();

  initNavigation(user);
  renderTopbar($("topbar"), user);
  initOwnerAccessModal();
  initOwnerAccessButton($("owner-access-slot"));
  initAuthModal();
  initAuthButton($("auth-slot"));

  // Overview reads Supabase live once signed in (Migration Plan Phase 3);
  // signed out (or before Supabase is configured) it falls back to
  // repository.js's data - see analytics.js's getPortfolioDataAuto().
  // Re-fetches and redraws the whole page on every sign-in/out, not just
  // the money-sensitive sections, since the DATA SOURCE itself changes.
  const loadAndRender = async () => {
    const data = await getPortfolioDataAuto();
    renderAll(data);
  };
  onAuthChange(() => { loadAndRender(); });
  await initAuth();
  await loadAndRender();
}

document.addEventListener("DOMContentLoaded", init);
