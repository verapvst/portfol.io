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

  const draw = () => {
    if (data.history.valueSeries.length < 2) {
      renderInsufficientData(container, "Not enough historical data yet to draw a trend.");
      return;
    }
    // Showcase mode: the curve never disappears, only its scale does -
    // rebase to an index (first point = 100) and drop the euro sign.
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
