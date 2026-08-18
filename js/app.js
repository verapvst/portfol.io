function $(id) { return document.getElementById(id); }

/** Compact "Mon 'YY" x-axis tick label - the tooltip keeps the full
    ISO date, this is only for the axis where 100+ points need to fit. */
function formatDateTick(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(" ", " '");
}

/** Re-entrant: runs once at init and again on every auth change (see
    init() below), redrawing the same card in place rather than mounting
    a second one. The resize listener has to be swapped, not stacked, or
    repeated sign-ins would leave several stale listeners each redrawing
    with whatever data happened to be current when they were attached.

    Deliberately just the "All" range now, no interactive filter pills -
    docs/information-architecture.md gives Performance its own dedicated
    page for that; this card headlines the number and links out (see
    #perf-more-link below) instead of duplicating that page's controls. */
let perfResizeHandler = null;

function initPerformanceCard(data) {
  const perf = data.analytics.performance;
  const container = $("linechart-container");
  const toggleRow = $("benchmark-toggle-row");

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

  // ---------- Performance chart: Portfolio vs. S&P 500 vs. Nasdaq-100 ----------
  // Performance & Benchmark Engine plan, section 2/3/4/9: the portfolio
  // line here is history.performanceSeries (scopedPerformance()'s own
  // cash-flow-neutral normalized daily index), NEVER history.valueSeries
  // (raw €, which jumps on every deposit/withdrawal - exactly the
  // "€18,542 → +€4,000 looks like performance" confusion this feature
  // exists to eliminate). Falls back to the old single-series chart only
  // when performanceSeries isn't available (today: signed-out/public
  // path - analytics.js's getPortfolioDataPublic() doesn't compute it,
  // since its privacy-preserving RPCs never expose real cash-flow
  // amounts to run Modified Dietz against).
  const hasPerformanceSeries = data.history.performanceSeries && data.history.performanceSeries.length >= 2;
  const availableBenchmarks = (data.history.benchmarks || []).filter((b) => b.series && b.series.length >= 2);

  if (!hasPerformanceSeries) {
    toggleRow.innerHTML = "";
    const draw = () => {
      if (data.history.valueSeries.length < 2) {
        renderInsufficientData(container, "Not enough historical data yet to draw a trend.");
        return;
      }
      const owner = isOwnerMode();
      const points = owner ? data.history.valueSeries : indexValueSeries(data.history.valueSeries);
      renderLineChart(container, points, {
        formatValue: owner ? fmtEUR : (v) => String(Math.round(v)),
        formatAxisValue: owner ? undefined : (v) => String(Math.round(v)),
        formatDateLabel: formatDateTick,
      });
    };
    draw();
    if (perfResizeHandler) window.removeEventListener("resize", perfResizeHandler);
    perfResizeHandler = draw;
    window.addEventListener("resize", perfResizeHandler);
    $("perf-more-link").innerHTML = `<a class="link-more" href="performance.html">View Performance ${icon("arrowRight")}</a>`;
    return;
  }

  const seriesDefs = [
    { key: "portfolio", label: "Portfolio", color: PALETTE_TEXT.coral, points: data.history.performanceSeries },
    ...availableBenchmarks.map((b) => ({
      key: b.id, label: `${b.name}${b.symbol ? ` (${b.symbol})` : ""}${b.dataType === "price_return" ? " · Price Return" : ""}`,
      color: BENCHMARK_SERIES_COLOR[b.id] || PALETTE_TEXT.green, points: b.series,
    })),
  ];

  // Toggle pills - all selected by default (checkboxes 1-9 of the
  // original spec). Multi-select, not the mutually-exclusive
  // .filter-pill pattern the Performance page's date range uses - any
  // combination can be active, including just one series.
  toggleRow.innerHTML = seriesDefs.map((s) =>
    `<button class="benchmark-toggle-pill active" type="button" data-key="${s.key}"><span class="toggle-dot" style="background:${s.color}"></span>${s.label}</button>`
  ).join("");

  const draw = () => {
    const activeKeys = new Set(
      [...toggleRow.querySelectorAll(".benchmark-toggle-pill.active")].map((el) => el.dataset.key)
    );
    const selected = seriesDefs.filter((s) => activeKeys.has(s.key));
    // buildComparisonSeries() (calculations.js) clips every selected
    // series to their shared overlapping real window, then re-normalizes
    // each to 100 at that shared start - never fabricates history before
    // any series' real inception (plan doc section 6).
    const comparison = buildComparisonSeries(selected);
    if (!comparison.length) {
      renderInsufficientData(container, "Insufficient overlapping history to compare the selected series yet.");
      return;
    }
    renderMultiLineChart(container, comparison, {
      formatValue: (v) => v.toFixed(1),
      formatDateLabel: formatDateTick,
    });
  };
  draw();

  toggleRow.querySelectorAll(".benchmark-toggle-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Never let the last active pill be turned off - there'd be no way
      // back to a populated chart without a reload.
      const activeCount = toggleRow.querySelectorAll(".benchmark-toggle-pill.active").length;
      if (btn.classList.contains("active") && activeCount === 1) return;
      btn.classList.toggle("active");
      draw();
    });
  });

  if (perfResizeHandler) window.removeEventListener("resize", perfResizeHandler);
  perfResizeHandler = draw;
  window.addEventListener("resize", perfResizeHandler);

  $("perf-more-link").innerHTML = `<a class="link-more" href="performance.html">View Performance ${icon("arrowRight")}</a>`;
}

/** Everything below reads from `data`, captured in this closure so a
    later re-fetch (sign-in/sign-out - see init()) redraws the whole page
    in place. isOwnerMode() now derives straight from auth state (see
    shell.js), and this whole function already re-runs on every auth
    change via init()'s own onAuthChange listener - so money-sensitive
    sections re-render for free every time this runs, no separate
    onOwnerModeChange registration needed here. (A previous version of
    this function registered one on every call, which - now that
    renderAll() itself runs on every auth change - would have piled up a
    new listener each time instead of just re-running the same one.) */
function renderAll(data) {
  renderSnapshot($("kpi-grid"), buildKpiViewModels(data));
  initPerformanceCard(data);
  renderHoldingsTable($("holdings-table"), data.portfolio.holdings);

  // Asset-class summary + a geography highlight, not the full tabbed
  // breakdown (Product/Account/geography/sector/currency/style all move
  // to the dedicated Allocation page - see renderAllocationSummary in
  // ui.js). The old world-map Exposure card is gone from Overview
  // entirely for the same reason; charts.js's renderWorldMap is untouched
  // and ready for that page once it's built, just not called from here.
  renderAllocationSummary($("allocation-summary"), data);

  // Health/Insights lean on per-holding facts (largest position, exact
  // holdings/accounts counts) that the public data path deliberately
  // never computes (analytics.js's getPortfolioDataPublic(), 0015) -
  // hidden for signed-out visitors rather than shown with zeroed-out
  // numbers that would misread as "this portfolio is empty".
  // .card's own display:flex outranks the [hidden] UA rule, so the
  // `hidden` attribute alone leaves an empty flex box on screen - set
  // display directly instead.
  const signedIn = !!currentUser();
  $("health-card").style.display = signedIn ? "" : "none";
  $("insights-card").style.display = signedIn ? "" : "none";
  if (signedIn) {
    renderPortfolioHealth($("portfolio-health"), data);
    renderInsights($("portfolio-insights"), data);
  }
}

async function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  initDrillDown();

  renderTopbar($("topbar"), user);
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  // Overview reads Supabase live once signed in (Migration Plan Phase 3);
  // signed out (or before Supabase is configured) it falls back to
  // repository.js's data - see analytics.js's getPortfolioDataAuto().
  // Re-fetches and redraws the whole page on every sign-in/out, not just
  // the money-sensitive sections, since the DATA SOURCE itself changes.
  const loadAndRender = async () => {
    const data = await getPortfolioDataAuto();
    setCurrentPortfolioData(data);
    renderAll(data);
  };
  onAuthChange(() => { loadAndRender(); });
  await initAuth();
  await loadAndRender();
}

document.addEventListener("DOMContentLoaded", init);
