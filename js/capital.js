/* ============================================================
   capital.js - the Capital page ("how much money have I put in, and
   what's it worth today?"). Split out of performance.js (Performance &
   Capital split) - Performance keeps every return/risk figure (TWR,
   XIRR, Annual Returns, Benchmark Comparison, Risk & Quant Metrics),
   this page keeps every capital-flow figure (Contributions, Invested
   Capital, Unrealised Gain, Portfolio Value Over Time). Reads the exact
   same data.analytics.performance / data.history.valueSeries fields
   performance.js already reads - never a second calculation, just a
   different arrangement of the same numbers.

   Deliberately has no scope selector (Portfolio/Accounts/Strategies/
   Securities) - no per-scope raw € value series or per-scope capital-
   flow breakdown exists in the data model (only each scope's own
   cash-flow-neutral INDEX, which is a return concept and stays on the
   Performance page). Both sections here are whole-portfolio only, same
   as before the split.
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

let capFilterClickHandler = null;
let capResizeHandler = null;

/* ---------- Portfolio Value Over Time ----------
   Raw €, always whole-portfolio - moved verbatim from
   performance.js:renderValueChart() (this split changed which page it
   lives on, not what it computes or how). */
function renderValueChart(data) {
  const container = $("cap-linechart-container");
  const filtersEl = $("cap-filters");
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

  if (capFilterClickHandler) filtersEl.removeEventListener("click", capFilterClickHandler);
  capFilterClickHandler = (e) => {
    const btn = e.target.closest(".filter-pill");
    if (!btn) return;
    filtersEl.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    draw(btn.dataset.range);
  };
  filtersEl.addEventListener("click", capFilterClickHandler);

  if (capResizeHandler) window.removeEventListener("resize", capResizeHandler);
  capResizeHandler = () => draw(filtersEl.querySelector(".active")?.dataset.range || "All");
  window.addEventListener("resize", capResizeHandler);
}

/* ---------- Contributions & capital summary ----------
   "How much money have I personally put in?" vs. "how well have my
   investments performed?" - built entirely from numbers analytics.js
   already computes (contributionsTotal/withdrawalsTotal/totalValue/
   investedCapital/unrealisedGain), no new calculation.

   Net Contributions is external cash only (deposit/withdrawal) - NOT
   Invested Capital (buy transactions), which is an internal
   reallocation from cash into a security, not new money entering the
   portfolio (see analytics.js's own PORTFOLIO_EXTERNAL_CASH_FLOW_TYPES-
   adjacent comment on contributionsTotal). Investment Gains (vs. Net
   Contributions) and Unrealised Gain (vs. Invested Capital) are
   therefore two genuinely different figures answering two different
   questions - both real, shown side by side with distinct baselines so
   they're never confused. Unrealised Gain moved here from Performance's
   stat tiles in the Performance/Capital split: it's a € gain against a
   cost basis, not a %-return like TWR/XIRR, so it belongs with the rest
   of this page's capital figures, not the return figures. */
function renderContributions(data) {
  const card = $("contributions-card");
  const perf = data.analytics.performance;
  if (perf.totalValue == null) { card.hidden = true; return; }
  card.hidden = false;
  const owner = isOwnerMode();

  const netContributions = Math.round(((perf.contributionsTotal || 0) - (perf.withdrawalsTotal || 0)) * 100) / 100;
  const investmentGains = Math.round((perf.totalValue - netContributions) * 100) / 100;
  const investmentGainsPct = netContributions ? Math.round((investmentGains / netContributions) * 10000) / 100 : null;
  const noBaseline = !perf.contributionsTotal && !perf.withdrawalsTotal;

  // Locked (signed in, Owner Access not unlocked): same masking
  // convention as before - show each figure as a % of current portfolio
  // value instead of a raw € amount, never a blank placeholder.
  const asPct = (v) => perf.totalValue ? fmtPct((v / perf.totalValue) * 100) : "—";

  const rows = [
    { label: "Total Contributions", value: perf.contributionsTotal, plain: true },
    { label: "Total Withdrawals", value: -Math.abs(perf.withdrawalsTotal || 0), plain: true },
    { label: "Net Contributions", value: netContributions, strong: true },
    { label: "Invested Capital (cost basis)", value: perf.investedCapital, plain: true },
    { label: "Current Portfolio Value", value: perf.totalValue, strong: true },
    { label: "Investment Gains (Value − Net Contributions)", value: investmentGains, strong: true, tone: investmentGains >= 0 ? "up" : "down" },
    { label: "Unrealised Gain (Value − Invested Capital)", value: perf.unrealisedGain, strong: true, tone: perf.unrealisedGain >= 0 ? "up" : "down" },
  ];

  const rowsHTML = rows.map((r) => `
    <div class="contribution-row${r.strong ? " strong" : ""}">
      <span class="contribution-label">${r.label}</span>
      <span class="contribution-value${r.tone ? ` ${r.tone}` : ""}">${owner ? fmtEUR(r.value, { signed: !r.plain }) : asPct(r.value)}</span>
    </div>`).join("");

  const warning = noBaseline
    ? `<p class="chart-legend-note">No deposit/withdrawal transactions recorded yet, so Net Contributions is €0 and Investment Gains above reflects the portfolio's full value, not just growth since a contribution baseline. Record a Deposit for your original funding to make this figure meaningful.</p>`
    : "";

  $("contributions-body").innerHTML = `
    <div class="contributions-list">${rowsHTML}</div>
    ${investmentGainsPct != null && owner ? `<p class="section-hint">Investment Gains: ${fmtPct(investmentGainsPct)} vs. Net Contributions. Unrealised Gain: ${fmtPct(perf.unrealisedGainPct)} vs. Invested Capital.</p>` : ""}
    ${warning}`;
}

/** Signed in but the live fetch failed (see analytics.js's
    getPortfolioDataAuto()) - without this, this state is indistinguishable
    from "genuinely on live data, genuinely flat" or from "genuinely signed
    out, correctly on Showcase mock". Only that specific case renders
    anything here. */
function renderDataWarning(data) {
  const el = $("cap-data-warning");
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
    heading: "Capital",
    subtitle: "How much money you've put in, taken out, and what it's worth today.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  const loadAndRender = async (data) => {
    setCurrentPortfolioData(data);
    renderDataWarning(data);
    renderContributions(data);
    renderValueChart(data);
  };

  onAuthChange(async () => { loadAndRender(await getPortfolioDataAuto()); });
  await initAuth();
  await loadAndRender(await getPortfolioDataAuto());
}

document.addEventListener("DOMContentLoaded", init);
