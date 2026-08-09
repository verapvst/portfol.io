/* ============================================================
   allocation.js - the Allocation page ("where is my portfolio
   invested?"). Every section reads straight from
   data.analytics.{assetClassAllocation,productAllocation,
   accountAllocation,regions,countries,currency} - the exact fields
   Overview's own Allocation card already summarizes (analytics.js/
   repository.js - getPortfolioDataAuto()). Nothing here recomputes a
   percentage; this page only re-ranks/re-groups numbers the calculation
   layer already produced, exactly like Portfolio Detail and Performance
   before it. Geographic Exposure reuses ui.js's renderExposure/
   EXPOSURE_GROUPINGS and charts.js's renderWorldMap verbatim - the same
   component Overview used before docs/information-architecture.md gave
   it this dedicated page instead.
   ============================================================ */

function $(id) { return document.getElementById(id); }

/* ---------- Shared row primitive ----------
   One ranked-list row (label + weight + a proportional bar) - used by
   Security Allocation, Account Allocation and Top Concentrations' own
   top-5 list, so the three sections can never draw the same kind of row
   three slightly different ways. */
function barRowHTML({ label, weight, tone, drillType, drillId, valueLabel }) {
  const drillAttrs = drillType ? ` data-drill-type="${drillType}" data-drill-id="${drillId}" tabindex="0" role="button" aria-label="${label} details"` : "";
  return `
    <div class="bar-row${drillType ? " drill-row" : ""}"${drillAttrs}>
      <div class="bar-row-label">
        <span class="bar-row-name">${label}</span>
        <span class="bar-row-value">${valueLabel ? valueLabel + " · " : ""}${weight.toFixed(2)}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.max(0, weight)).toFixed(2)}%; background:${familyGradientCSS(tone)}"></div></div>
    </div>`;
}

function renderSummary(data) {
  const holdings = data.portfolio.holdings;
  const accountsCount = data.portfolio.accounts.length;
  const classesCount = data.analytics.assetClassAllocation.length;
  $("alloc-summary").textContent =
    `${holdings.length} holding${holdings.length === 1 ? "" : "s"} across ${accountsCount} account${accountsCount === 1 ? "" : "s"} and ${classesCount} asset class${classesCount === 1 ? "" : "es"}.`;
}

/* ---------- Asset Class Allocation ---------- */

function renderAssetClass(data) {
  const items = data.analytics.assetClassAllocation;
  const total = items.reduce((s, it) => s + it.weight, 0);
  const container = $("asset-class-viz");
  container.innerHTML = `<div id="asset-class-donut"></div>`;
  renderDonut(container.querySelector("#asset-class-donut"), items, "Asset Class", `${total.toFixed(1)}%`, { drillType: "assetClass" });
}

/* ---------- Top Concentrations ----------
   Aggregate stat tiles (reusing the .kpi-card look Performance's stat
   row already established) plus the actual top-5 holdings driving them
   - a number alone ("67.71% in your top holding") means little without
   naming what that holding is. */

function computeConcentration(productAllocation) {
  const sorted = [...productAllocation].sort((a, b) => b.weight - a.weight);
  const cumulative = (n) => Math.round(sorted.slice(0, n).reduce((s, h) => s + h.weight, 0) * 100) / 100;
  return { sorted, top1: cumulative(1), top3: cumulative(3), top5: cumulative(5) };
}

function concentrationTileHTML(label, value, note) {
  return `
    <div class="card glass interactive kpi-card rise">
      <div class="kpi-top">
        <span class="kpi-icon">${icon("target")}</span>
        <p class="kpi-label" data-info="allocation-concentration" tabindex="0" role="button" aria-label="About this metric">${label}</p>
      </div>
      <p class="kpi-value">${fmtPct(value, { signed: false })}</p>
      <p class="kpi-sub">${note}</p>
    </div>`;
}

function renderConcentration(data) {
  const { sorted, top1, top3, top5 } = computeConcentration(data.analytics.productAllocation);

  $("concentration-stats").innerHTML = [
    concentrationTileHTML("Top 1 Holding", top1, sorted[0] ? sorted[0].name : "—"),
    concentrationTileHTML("Top 3 Holdings", top3, "combined weight"),
    concentrationTileHTML("Top 5 Holdings", top5, "combined weight"),
  ].join("");

  $("concentration-list").innerHTML = sorted.slice(0, 5).map((h) => barRowHTML({
    label: h.name, weight: h.weight, tone: h.tone, drillType: "holding", drillId: h.id,
  })).join("");
}

/* ---------- Security Allocation ---------- */

function renderSecurityAllocation(data) {
  const items = [...data.analytics.productAllocation].sort((a, b) => b.weight - a.weight);
  $("security-allocation-body").innerHTML = items.map((h) => barRowHTML({
    label: `${h.name}${h.ticker !== "—" ? ` · ${h.ticker}` : ""}`, weight: h.weight, tone: h.tone,
    drillType: "holding", drillId: h.id,
  })).join("");
}

/* ---------- Account Allocation ----------
   Account name shown either mode (structural, same convention already
   approved on Portfolio Detail); only the € value is Private-only - per
   the Mode x Capability matrix, Showcase gets percentages, never money. */

function renderAccountAllocation(data) {
  const owner = isOwnerMode();
  const items = [...data.analytics.accountAllocation].sort((a, b) => b.weight - a.weight);
  $("account-allocation-body").innerHTML = items.map((a) => barRowHTML({
    label: a.name, weight: a.weight, tone: a.tone,
    drillType: "account", drillId: a.name,
    valueLabel: owner ? fmtEUR(a.value) : null,
  })).join("");
}

/* ---------- Geographic Exposure ---------- */

function renderGeographicExposure(data) {
  renderExposure({
    tabsEl: $("exposure-tabs"),
    vizEl: $("exposure-viz"),
    hintEl: $("exposure-hint"),
    titleEl: document.querySelector("#exposure-card .card-header-title"),
  }, data);
}

function renderAll(data) {
  renderSummary(data);
  renderAssetClass(data);
  renderConcentration(data);
  renderSecurityAllocation(data);
  renderAccountAllocation(data);
  renderGeographicExposure(data);
}

async function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  initDrillDown();

  renderTopbar($("topbar"), user, {
    heading: "Allocation",
    subtitle: "Where is your portfolio invested?",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

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
