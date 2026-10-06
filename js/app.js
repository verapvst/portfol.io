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
  // inceptionDate is genuinely null before the portfolio has any real
  // observation (e.g. signed-out, before the public snapshot has ever
  // been populated) - interpolating that straight into the string used
  // to literally render "Time-Weighted Return since null".
  $("perf-secondary").textContent = isOwnerMode()
    ? `Time-Weighted Return · ${fmtEUR(perf.unrealisedGain, { signed: true })} · ${fmtEUR(perf.totalValue)} today`
    : data.history.inceptionDate ? `Time-Weighted Return since ${data.history.inceptionDate}` : "Time-Weighted Return";

  // Investor Return (XIRR) lives here, not as a fifth KPI tile - it's a
  // genuinely different question from the TWR headline above ("what did
  // I personally earn, given my own deposit timing") and belongs next
  // to its sibling metric, not competing for space in the compact 2x2.
  // investorReturnAvailable gated the same way Performance's own tile
  // already does (js/performance.js:renderStats()) - this used to call
  // fmtPct() unconditionally, so "not enough cash flows yet"
  // (investorReturnPct defaults to 0 when unavailable) rendered as a
  // literal "0.00%", implying a real, calculated zero return instead of
  // "unknown". Same bug class this app's own *Available flag
  // convention exists to prevent everywhere else - just missed here.
  $("perf-investor-return-value").textContent = perf.investorReturnAvailable ? fmtPct(perf.investorReturnPct) : "Insufficient history";

  // ---------- Performance chart: the portfolio's own trend, nothing else ----------
  // Overview deliberately shows ONLY the portfolio's own line now - no
  // benchmark toggle pills, no Nasdaq/S&P 500 comparison. That richer
  // "laboratory" (toggle benchmarks on/off, toggle scope between
  // Portfolio/Accounts/Strategies/Securities, pick a period) lives on
  // the Performance page (js/performance.js:renderBenchmarkSection()) -
  // deliberate separation, per the app owner's own framing: Overview is
  // "what is", Performance is "the dedicated analysis tool". Keeping a
  // second, smaller copy of that same toggle UI here would only
  // duplicate it at a size too small to be useful anyway.
  //
  // Uses history.performanceSeries (cash-flow-neutral, the same series
  // the headline TWR % above is computed from) - NOT the raw €
  // valueSeries. A first attempt at this simplification used valueSeries
  // and it looked wrong for a real, concrete reason: a genuine deposit
  // (the 2026-08-04 Trading212 lump sum) reads as a near-vertical spike
  // in raw €, which isn't performance at all - exactly the "€X →
  // +€4,000 looks like performance" confusion this app has always taken
  // care to avoid (see repository.js's own historical comments on this).
  // performanceSeries is cash-flow-neutral by construction, so a real
  // deposit continues the line smoothly instead of faking a jump - and
  // it no longer shares an axis with Nasdaq/S&P 500, so it also isn't
  // squashed flat by their much larger scale. Index-based, not real €
  // (matches how this exact series was always formatted, even in the
  // former multi-line chart's owner-mode tooltip) - real € belongs to
  // the "Portfolio Value" KPI tile above, not this trend line.
  toggleRow.innerHTML = "";
  const draw = () => {
    const hasPerformanceSeries = data.history.performanceSeries && data.history.performanceSeries.length >= 2;
    // Resampled BEFORE the length check - a real gap that only reads as
    // "enough history" at raw density must not slip through as a
    // 1-point chart.
    const monthly = monthlyResample(hasPerformanceSeries ? data.history.performanceSeries : data.history.valueSeries);
    if (monthly.length < 2) {
      renderInsufficientData(container, "Not enough historical data yet to draw a trend.");
      return;
    }
    // Fallback path (signed-out/public - getPortfolioDataPublic() never
    // computes performanceSeries) still needs SOME line: raw €, privacy-
    // rebased for non-owners exactly as before, real € for the owner.
    const owner = isOwnerMode();
    const points = hasPerformanceSeries ? monthly : (owner ? monthly : indexValueSeries(monthly));
    renderLineChart(container, points, {
      formatValue: hasPerformanceSeries ? (v) => v.toFixed(1) : (owner ? fmtEUR : (v) => String(Math.round(v))),
      formatAxisValue: hasPerformanceSeries ? (v) => v.toFixed(0) : (owner ? undefined : (v) => String(Math.round(v))),
      formatDateLabel: formatDateTick,
    });
    // Recruiter-readiness audit §6: nothing on this chart said it wasn't
    // a euro value - a line that goes up and down reads as "my money"
    // by default, when this is actually a cash-flow-neutral RETURN curve
    // (same series the headline % above is computed from). One line,
    // shown for every viewer (not just signed-out) since the chart is
    // index-based either way whenever hasPerformanceSeries is true.
    $("perf-chart-caption").textContent = hasPerformanceSeries
      ? "Indexed to 100 at inception - shows how the RETURN evolved, not the portfolio's euro value."
      : "";
  };
  draw();
  if (perfResizeHandler) window.removeEventListener("resize", perfResizeHandler);
  perfResizeHandler = draw;
  window.addEventListener("resize", perfResizeHandler);
  $("perf-more-link").innerHTML = `<a class="link-more" href="performance.html">View Performance ${icon("arrowRight")}</a>`;
}

/** Signed-out hero: identity strip + 3 privacy-safe headline stats (never
    current €/holdings - see analytics.js's own privacy boundary) + a
    short real-milestones timeline (computePublicMilestones in
    analytics.js, date-derived only from public_cash_flow_dates(), never
    invented). Hidden entirely in owner mode: Vera's own session already
    has every one of these facts, and far more, in the KPI grid and
    Performance card right below it - showing this too would just be a
    duplicate, staler copy competing for the same space. */
function renderPublicHero(data) {
  $("about-card").style.display = currentUser() ? "none" : "";
  const card = $("public-hero-card");
  if (isOwnerMode()) { card.hidden = true; return; }

  const inceptionDate = data.history.inceptionDate;
  const perf = data.analytics.performance;
  if (!inceptionDate || !perf?.totalReturnAvailable) { card.hidden = true; return; }

  const sinceYear = inceptionDate.slice(0, 4);
  $("public-hero-kicker").textContent = `PORTFOL.IO · Personal Investment Portfolio · Since ${sinceYear}`;

  const days = Math.floor((Date.now() - new Date(inceptionDate).getTime()) / 86400000);
  const years = Math.floor(days / 365);
  // annualizeReturnPct (calculations.js) returns null itself below its own
  // minDaysForAnnualisedReturn gate - same "don't annualise a few weeks"
  // guard the Performance page's own quant metrics already use.
  const cagr = window.annualizeReturnPct(perf.totalReturnPct, days);

  const stats = [
    { label: "Cumulative Return", value: fmtPct(perf.totalReturnPct) },
    { label: "Annualised Return (CAGR)", value: cagr != null ? fmtPct(cagr) : "Insufficient history" },
    { label: "Years Tracked", value: years >= 1 ? String(years) : "<1" },
  ];
  $("public-hero-stats").innerHTML = stats.map((s) => `
    <div class="public-hero-stat">
      <p class="public-hero-stat-value">${s.value}</p>
      <p class="public-hero-stat-label">${s.label}</p>
    </div>
  `).join("");

  const milestones = data.history.milestones || [];
  $("public-hero-timeline").innerHTML = milestones.map((m) => `
    <div class="public-hero-milestone">
      <p class="public-hero-milestone-date">${m.date}</p>
      <p class="public-hero-milestone-label">${m.label}</p>
    </div>
  `).join("");

  card.hidden = false;
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
  renderPublicHero(data);
  renderSnapshot($("kpi-grid"), buildKpiViewModels(data));
  initPerformanceCard(data);
  renderHoldingsTable($("holdings-table"), data.portfolio.holdings, data.portfolio.accounts);

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
