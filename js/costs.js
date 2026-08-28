/* ============================================================
   costs.js - the Costs page ("what is my portfolio costing me?"),
   redesigned 2026-08-28 from a flat cost-records table into an
   analytical dashboard. The raw `costs` table remains the underlying
   source of cost assumptions - unchanged insert-only Add Cost workflow,
   just moved into a secondary collapsible section near the bottom (see
   "Raw records" below) - but it's no longer the main thing on screen.

   Two genuinely different questions, kept visually and conceptually
   separate throughout this file:
     1. "What am I paying today?" - forward-looking, the current
        weighted ongoing cost rate blended from every held security's
        own known cost rate (calculations.js:computeCurrentPortfolioCost()).
     2. "What have I actually paid?" - backward-looking, real recorded
        cash costs only (calculations.js:computeHistoricalCashCosts()).
   Both come from data.analytics.costs (analytics.js's own Costs Engine
   wiring) - this file only renders, never recomputes.

   THE rule this file's own rendering must never violate: a NAV-embedded
   cost (a fund's own TER) is already reflected in that security's
   valuation/performance elsewhere in this app - never labelled "paid"
   here, never summed into the historical cash-cost total. Only
   costs.nav_embedded === false rows (real, separate cash costs) count
   as "actually paid" - see calculations.js's own Costs Engine header
   comment for the full reasoning.
   ============================================================ */

let currentPortfolioId = null;
let accountsCache = [];
let securitiesCache = [];
let costsCache = [];
let filterCategory = "";
let costEvolutionResizeHandler = null;
let costHistoricalResizeHandler = null;

const COST_CATEGORIES = ["Management", "Trading", "Custody", "Other"];
const FREQUENCIES = ["One-off", "Daily", "Monthly", "Quarterly", "Annual"];
const UNITS = ["%", "EUR", "USD"];
const SECURITY_TYPES = ["Fund", "ETF", "Stock", "Bond", "Cash", "Other"];

/** Compact "Mon 'YY" x-axis tick label - the tooltip keeps the full ISO
    date, this is only for the axis where many points need to fit. Every
    page with a date-axis chart defines its own copy of this (app.js,
    performance.js, capital.js) rather than sharing one - same
    convention followed here. */
function formatDateTick(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(" ", " '");
}

/* ---------- Hero: "what am I paying today" ---------- */

function costTileHTML({ iconName, label, docKey, value, note }) {
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

function renderCostHero(data) {
  const c = data.analytics.costs.current;
  const hist = data.analytics.costs.historical;

  const coverageNote = c.coveragePct == null
    ? "not enough data yet"
    : c.coveragePct >= 99.995
      ? "based on your full portfolio"
      : `based on ${c.coveragePct.toFixed(0)}% of your portfolio with a known cost`;

  const tiles = [
    costTileHTML({
      iconName: "wallet", label: "Annual Cost", docKey: "cost-annual",
      value: c.totalAnnualEUR != null ? `${fmtEUR(c.totalAnnualEUR)}/yr` : "Insufficient data",
      note: coverageNote,
    }),
    costTileHTML({
      iconName: "activity", label: "Portfolio Cost Rate", docKey: "cost-rate",
      value: c.weightedCostPct != null ? `${fmtPct(c.weightedCostPct, { signed: false })}/yr` : "Insufficient data",
      note: "weighted average, ongoing",
    }),
    costTileHTML({
      iconName: "barChart3", label: "Monthly Equivalent", docKey: "cost-annual",
      value: c.monthlyEquivalentEUR != null ? `${fmtEUR(c.monthlyEquivalentEUR)}/mo` : "Insufficient data",
      note: "the annual cost, per month",
    }),
    costTileHTML({
      iconName: "trendingUp", label: "Historical Costs", docKey: "cost-historical",
      value: hist.totalEUR != null ? fmtEUR(hist.totalEUR) : "None recorded yet",
      note: "actual cash costs, recorded",
    }),
  ];
  $("cost-kpi-grid").innerHTML = tiles.join("");
}

/* ---------- "Where are my costs coming from?" ---------- */

function costBarRowHTML({ label, valueLabel, pct, tone }) {
  return `
    <div class="bar-row">
      <div class="bar-row-label">
        <span class="bar-row-name">${label}</span>
        <span class="bar-row-value">${valueLabel}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.max(0, pct)).toFixed(2)}%; background:${familyGradientCSS(tone)}"></div></div>
    </div>`;
}

function renderCostBreakdown(data) {
  const c = data.analytics.costs.current;
  const body = $("cost-breakdown-body");

  const splitHTML = `
    <div class="cost-split-row">
      <div class="cost-split-item">
        <span class="cost-split-label">Product costs</span>
        <span class="cost-split-value">${c.productAnnualEUR != null ? `${fmtEUR(c.productAnnualEUR)}/yr` : "—"}</span>
        <span class="cost-split-note">TER, management &amp; depositary fees — already reflected in each fund/ETF's own price, never separately paid</span>
      </div>
      <div class="cost-split-item">
        <span class="cost-split-label">Platform &amp; transaction costs</span>
        <span class="cost-split-value">${c.platformAnnualEUR != null ? `${fmtEUR(c.platformAnnualEUR)}/yr` : "None recorded"}</span>
        <span class="cost-split-note">Custody, account &amp; brokerage fees — real, separate cash costs</span>
      </div>
    </div>`;

  if (!c.byHolding.length) {
    body.innerHTML = splitHTML + `<p class="chart-legend-note">No known ongoing costs recorded yet for your current holdings - add one below to see this breakdown.</p>`;
    return;
  }

  const maxEUR = Math.max(...c.byHolding.map((h) => h.annualEUR || 0));
  const totalKnownEUR = c.byHolding.reduce((s, h) => s + (h.annualEUR || 0), 0);
  const rows = c.byHolding.map((h) => costBarRowHTML({
    label: h.name,
    valueLabel: `${fmtEUR(h.annualEUR)}/yr${totalKnownEUR ? ` · ${((h.annualEUR / totalKnownEUR) * 100).toFixed(0)}%` : ""}`,
    pct: maxEUR ? (h.annualEUR / maxEUR) * 100 : 0,
    tone: tokenColor("asset", h.name.replace(/[^a-zA-Z0-9]/g, "_")),
  })).join("");

  const top = c.byHolding[0];
  const shareNote = totalKnownEUR
    ? `<p class="chart-legend-note">${top.name} — ${((top.annualEUR / totalKnownEUR) * 100).toFixed(0)}% of your ongoing portfolio costs.</p>`
    : "";

  body.innerHTML = splitHTML + `<div class="cost-holding-bars">${rows}</div>` + shareNote;
}

/* ---------- "What have I actually paid?" ---------- */

function renderCostHistorical(data) {
  const hist = data.analytics.costs.historical;
  const body = $("cost-historical-body");

  if (hist.totalEUR == null) {
    body.innerHTML = `
      <p class="cost-total-figure text-muted">€0</p>
      <p class="section-hint">No actual cash costs (brokerage commissions, account fees, ...) have been recorded yet. Product costs like TER aren't counted here - they're already reflected in each fund/ETF's own price, never money that separately left your account. Record a real cash cost below to see it here.</p>`;
    return;
  }

  body.innerHTML = `
    <p class="cost-total-figure">${fmtEUR(hist.totalEUR)}</p>
    <p class="section-hint">Total real cash costs recorded, since ${hist.series[0]?.date || "—"}.</p>
    <div id="cost-historical-chart"></div>
    <div class="cost-provider-list">
      ${hist.byHolding.map((h) => `
        <div class="cost-provider-row">
          <span class="cost-provider-name">${h.name}</span>
          <span class="cost-provider-value">${fmtEUR(h.eur)}</span>
        </div>`).join("")}
    </div>
    ${hist.excluded.length ? `<p class="chart-legend-note">${hist.excluded.length} cost record${hist.excluded.length === 1 ? "" : "s"} not included above: ${hist.excluded.map((e) => `${e.costName} (${e.reason})`).join("; ")}.</p>` : ""}`;

  const draw = () => renderLineChart($("cost-historical-chart"), hist.series, {
    formatValue: (v) => fmtEUR(v),
    formatAxisValue: (v) => fmtEUR(v),
    formatDateLabel: formatDateTick,
  });
  draw();
  if (costHistoricalResizeHandler) window.removeEventListener("resize", costHistoricalResizeHandler);
  costHistoricalResizeHandler = draw;
  window.addEventListener("resize", costHistoricalResizeHandler);
}

/* ---------- "How much has this cost me, per year, since I started?" ----------
   Unlike renderCostHistorical() above (real cash only), this
   deliberately includes an ESTIMATE of embedded fees too (a fund's own
   TER for the years it was actually held) - never labelled "paid",
   always "estimated". calculations.js:computeAnnualCostBreakdown()'s
   own header comment has the full reasoning. */

function renderCostAnnualBreakdown(data) {
  const rows = data.analytics.costs.annual;
  const container = $("cost-annual-body");
  const noteEl = $("cost-annual-note");

  if (!rows.length) {
    noteEl.textContent = "";
    renderInsufficientData(container, "Not enough cost history yet to break this down by year.");
    return;
  }

  const hasEmbedded = rows.some((r) => r.embeddedEUR > 0);
  noteEl.textContent = hasEmbedded
    ? "Includes an ESTIMATE of each fund/ETF's own embedded fee (TER) for the years you held it - not money that separately left your account (see \"Costs actually paid\" above for that real cash figure)."
    : "Real cash costs only, by year.";

  const currentYear = new Date().getFullYear();
  const rowsHTML = rows.map((r) => {
    const label = r.year === currentYear ? `${r.year} YTD` : String(r.year);
    return `
      <div class="cost-annual-row">
        <span class="cost-annual-year">${label}</span>
        <span class="cost-annual-value">${fmtEUR(r.totalEUR)}</span>
      </div>`;
  }).join("");

  container.innerHTML = `<div class="cost-annual-list">${rowsHTML}</div>`;
}

/* ---------- "Has your portfolio become cheaper?" ---------- */

function renderCostEvolution(data) {
  const series = data.analytics.costs.evolution;
  const container = $("cost-evolution-chart");
  const insightEl = $("cost-evolution-insight");

  if (series.length < 2) {
    insightEl.textContent = "";
    renderInsufficientData(container, "Not enough cost history yet to show how your portfolio's ongoing cost rate has changed over time - this fills in as real weight shifts between holdings with different known cost rates.");
    return;
  }

  const first = series[0];
  const last = series[series.length - 1];
  const delta = Math.round((last.value - first.value) * 10000) / 10000;
  insightEl.innerHTML = Math.abs(delta) >= 0.01
    ? `<b>Your portfolio's ongoing cost rate has ${delta < 0 ? "fallen" : "risen"} from ${fmtPct(first.value, { signed: false })} to ${fmtPct(last.value, { signed: false })}</b> since ${first.date}.`
    : `Cost rate has stayed close to ${fmtPct(last.value, { signed: false })} since ${first.date}.`;

  const draw = () => renderLineChart(container, series, {
    formatValue: (v) => fmtPct(v, { signed: false }),
    formatAxisValue: (v) => `${v.toFixed(2)}%`,
    formatDateLabel: formatDateTick,
  });
  draw();
  if (costEvolutionResizeHandler) window.removeEventListener("resize", costEvolutionResizeHandler);
  costEvolutionResizeHandler = draw;
  window.addEventListener("resize", costEvolutionResizeHandler);
}

/* ---------- Cost at different portfolio sizes (optional) ---------- */

const COST_AT_SIZE_VALUES = [10000, 25000, 50000, 100000];

function renderCostAtSize(data) {
  const c = data.analytics.costs.current;
  const card = $("cost-at-size-card");
  if (c.weightedCostPct == null) { card.hidden = true; return; }
  card.hidden = false;

  const rows = COST_AT_SIZE_VALUES.map((v) => `
    <div class="cost-size-row">
      <span class="cost-size-value">${fmtEUR(v)}</span>
      <span class="cost-size-cost">${fmtEUR(Math.round(v * c.weightedCostPct / 100 * 100) / 100)}/yr</span>
    </div>`).join("");

  $("cost-at-size-body").innerHTML = `
    <div class="cost-size-table">${rows}</div>
    <p class="section-hint">Illustrative only, at today's weighted cost rate of ${fmtPct(c.weightedCostPct, { signed: false })}/yr - not a projection of your own portfolio's future size.</p>`;
}

/* ---------- Raw records (unchanged from the original flat-table page) ----------
   Insert-only, same discipline as every other observation table
   (valuations, chief among them): a cost row is valid from its date
   until superseded by a later row for the same security/cost name
   (workbook Costs sheet philosophy - a TER change next year is a new
   row, not an edit to this one). No edit/delete UI, just Add + list. */

async function loadCosts() {
  const { data, error } = await window.db
    .from("costs")
    .select("*, securities(id, name), accounts(id, name)")
    .eq("portfolio_id", currentPortfolioId)
    .order("date", { ascending: false });
  if (error) throw error;
  costsCache = data || [];
  return costsCache;
}

function fmtNum(n) {
  return n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function renderCostsTable(container) {
  const rows = filterCategory ? costsCache.filter((c) => c.cost_category === filterCategory) : costsCache;

  if (!rows.length) {
    container.innerHTML = `<p class="costs-empty">No costs recorded yet.</p>`;
    return;
  }

  const html = rows.map((c) => `
    <tr>
      <td>${c.date}</td>
      <td>${c.securities ? c.securities.name : (c.accounts ? c.accounts.name : "—")}</td>
      <td><span class="category-badge">${c.cost_category}</span></td>
      <td>${c.cost_name}</td>
      <td>${c.frequency}</td>
      <td class="amount-cell">${fmtNum(c.value)} ${c.unit}</td>
      <td>${c.nav_embedded ? "Embedded (NAV)" : "Cash"}</td>
      <td>${c.source || "—"}</td>
      <td class="notes-cell">${c.notes || ""}</td>
    </tr>`).join("");

  container.innerHTML = `
    <div class="costs-table-scroll">
      <table class="costs-table">
        <thead><tr>
          <th>Date</th><th>Applies to</th><th>Category</th><th>Name</th>
          <th>Frequency</th><th>Value</th><th data-info="nav-embedded" tabindex="0" role="button" aria-label="About this column">Nature</th><th>Source</th><th>Notes</th>
        </tr></thead>
        <tbody>${html}</tbody>
      </table>
    </div>`;
}

function renderCategoryFilter() {
  const select = $("costs-filter-category");
  select.innerHTML = `<option value="">All categories</option>` +
    COST_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
}

async function refreshCostsTable() {
  const container = $("costs-table-container");
  await loadCosts();
  renderCostsTable(container);
}

/* ---------- Add modal (unchanged) ---------- */

function optionsHTML(values) {
  return values.map((v) => `<option value="${v}">${v}</option>`).join("");
}

function accountOptionsHTML() {
  return `<option value="">None</option>` + accountsCache.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
}

function initCostModal() {
  if (document.getElementById("cost-modal-root")) return;

  const root = document.createElement("div");
  root.id = "cost-modal-root";
  root.innerHTML = `
    <div id="cost-modal-backdrop"></div>
    <div id="cost-modal" class="glass" role="dialog" aria-modal="true" aria-label="Add Cost">
      <h2 class="owner-modal-title">Add Cost</h2>
      <div class="cost-form-grid">
        <div class="cost-form-field half">
          <label for="cost-security">Security (optional)</label>
          <input id="cost-security" type="text" list="cost-security-options" placeholder="e.g. BPI Dinâmico" />
          <datalist id="cost-security-options"></datalist>
        </div>
        <div class="cost-form-field half">
          <label for="cost-account">Account (optional)</label>
          <select id="cost-account">${accountOptionsHTML()}</select>
        </div>
        <div class="cost-form-field half">
          <label for="cost-date">Date</label>
          <input id="cost-date" type="date" />
        </div>
        <div class="cost-form-field half">
          <label for="cost-category">Category</label>
          <select id="cost-category">${optionsHTML(COST_CATEGORIES)}</select>
        </div>
        <div class="cost-form-field half">
          <label for="cost-name">Cost Name</label>
          <input id="cost-name" type="text" placeholder="e.g. TER" />
        </div>
        <div class="cost-form-field half">
          <label for="cost-frequency">Frequency</label>
          <select id="cost-frequency">${optionsHTML(FREQUENCIES)}</select>
        </div>
        <div class="cost-form-field half">
          <label for="cost-value">Value</label>
          <input id="cost-value" type="number" step="any" placeholder="e.g. 0.835" />
        </div>
        <div class="cost-form-field half">
          <label for="cost-unit">Unit</label>
          <select id="cost-unit">${optionsHTML(UNITS)}</select>
        </div>
        <div class="cost-form-field half">
          <label for="cost-nav-embedded">Nature</label>
          <select id="cost-nav-embedded">
            <option value="false">Real cash cost (money that actually left the account)</option>
            <option value="true">Embedded in the security's own NAV/price (e.g. a fund's TER)</option>
          </select>
        </div>
        <div class="cost-form-field half">
          <label for="cost-source">Source (optional)</label>
          <input id="cost-source" type="text" />
        </div>
        <div class="cost-form-field half">
          <label for="cost-security-type">Security Type (if creating new)</label>
          <select id="cost-security-type">${optionsHTML(SECURITY_TYPES)}</select>
        </div>
        <div class="cost-form-field">
          <label for="cost-notes">Notes (optional)</label>
          <input id="cost-notes" type="text" />
        </div>
      </div>
      <p class="cost-form-error" id="cost-form-error"></p>
      <div class="cost-form-actions">
        <button class="cost-form-cancel" type="button" id="cost-form-cancel">Cancel</button>
        <button class="cost-form-submit" type="button" id="cost-form-submit">Save Cost</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const close = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", costModalKeyHandler);
  };

  root.querySelector("#cost-modal-backdrop").addEventListener("click", close);
  root.querySelector("#cost-form-cancel").addEventListener("click", close);

  root.querySelector("#cost-form-submit").addEventListener("click", async () => {
    const errorEl = $("cost-form-error");
    const submitBtn = $("cost-form-submit");
    errorEl.textContent = "";

    const securityName = $("cost-security").value.trim();
    const accountId = $("cost-account").value;
    const date = $("cost-date").value;
    const costName = $("cost-name").value.trim();
    const value = $("cost-value").value;

    if (!securityName && !accountId) { errorEl.textContent = "Set a Security or an Account (or both)."; return; }
    if (!date) { errorEl.textContent = "Date is required."; return; }
    if (!costName) { errorEl.textContent = "Cost Name is required."; return; }
    if (value === "") { errorEl.textContent = "Value is required."; return; }

    submitBtn.disabled = true;
    try {
      const securityId = securityName
        ? await findOrCreateSecurity({ name: securityName, type: $("cost-security-type").value, currency: "EUR" }, securitiesCache)
        : null;

      const payload = {
        portfolio_id: currentPortfolioId,
        security_id: securityId,
        account_id: accountId || null,
        date,
        cost_category: $("cost-category").value,
        cost_name: costName,
        frequency: $("cost-frequency").value,
        unit: $("cost-unit").value,
        value: Number(value),
        nav_embedded: $("cost-nav-embedded").value === "true",
        source: $("cost-source").value.trim() || null,
        notes: $("cost-notes").value.trim() || null,
      };

      const { error } = await window.db.from("costs").insert(payload);
      if (error) throw error;

      close();
      await reloadAndRenderCosts();
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  });

  window.openCostModalRoot = root;
  window.closeCostModal = close;
}

function costModalKeyHandler(e) {
  if (e.key === "Escape") window.closeCostModal();
}

function openCostModal() {
  $("cost-security").value = "";
  $("cost-account").innerHTML = accountOptionsHTML();
  $("cost-account").value = "";
  $("cost-date").value = new Date().toISOString().slice(0, 10);
  $("cost-category").value = "Management";
  $("cost-name").value = "";
  $("cost-frequency").value = "Annual";
  $("cost-value").value = "";
  $("cost-unit").value = "%";
  $("cost-nav-embedded").value = "false";
  $("cost-source").value = "";
  $("cost-security-type").value = "Fund";
  $("cost-notes").value = "";
  $("cost-form-error").textContent = "";

  const datalist = $("cost-security-options");
  datalist.innerHTML = securitiesCache.map((s) => `<option value="${s.name}"></option>`).join("");

  const root = window.openCostModalRoot;
  root.classList.add("open");
  document.addEventListener("keydown", costModalKeyHandler);
  setTimeout(() => $("cost-security").focus(), 50);
}

/* ---------- Page init ---------- */

function renderSignedOutState() {
  $("costs-signedin").hidden = true;
  $("costs-signedout-slot").innerHTML = `
    <section class="card glass" id="costs-signedout-card">
      <h2 class="section-title">Costs</h2>
      <div class="costs-signin-note">
        Sign in to see what your portfolio costs.
        <br/>
        <button type="button" id="costs-signin-cta">Sign In</button>
      </div>
    </section>`;
  $("costs-signin-cta").addEventListener("click", () => window.openAuthModal());
}

/** Full page render, given a fresh getPortfolioDataAuto() result (the
    analytical sections) - the raw records table refresh is separate
    (reloadAndRenderCosts() below), since it goes through its own direct
    Supabase query, same as before this redesign. */
function renderCostsAnalytics(data) {
  renderCostHero(data);
  renderCostBreakdown(data);
  renderCostHistorical(data);
  renderCostAnnualBreakdown(data);
  renderCostEvolution(data);
  renderCostAtSize(data);
}

/** Re-fetches BOTH data paths (the shared analytics bundle, for every
    section above the raw table; the direct costs query, for the raw
    table itself) - a fresh Add Cost changes what both should show. */
async function reloadAndRenderCosts() {
  const [data] = await Promise.all([getPortfolioDataAuto(), refreshCostsTable()]);
  setCurrentPortfolioData(data);
  renderCostsAnalytics(data);
}

async function loadCostsPage() {
  const user = currentUser();

  if (!window.db) {
    $("costs-signedin").hidden = true;
    $("costs-signedout-slot").innerHTML = `<p class="costs-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    return;
  }

  if (!user) {
    renderSignedOutState();
    return;
  }

  $("costs-signedout-slot").innerHTML = "";
  $("costs-signedin").hidden = false;
  $("costs-table-container").innerHTML = `<p class="costs-empty">Loading…</p>`;

  try {
    currentPortfolioId = await ensurePortfolio();
    accountsCache = await loadAccountsForPortfolio(currentPortfolioId);
    securitiesCache = await loadSecurities();
    renderCategoryFilter();

    const [data] = await Promise.all([getPortfolioDataAuto(), refreshCostsTable()]);
    setCurrentPortfolioData(data);
    renderCostsAnalytics(data);
  } catch (err) {
    const missingTable = /relation .*costs.* does not exist/i.test(err.message || "");
    const missingColumn = /nav_embedded/i.test(err.message || "");
    $("costs-table-container").innerHTML = `<p class="costs-error">${
      missingTable
        ? "The costs table doesn't exist yet — run supabase/migrations/0002_costs.sql in the Supabase SQL Editor first."
        : missingColumn
          ? "The costs table needs its nav_embedded column — run supabase/migrations/0030_seed_real_costs.sql in the Supabase SQL Editor first."
          : (err.message || "Failed to load costs.")
    }</p>`;
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Costs",
    subtitle: "Understand what your portfolio costs — today and over time.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));
  initCostModal();

  $("add-cost-btn").addEventListener("click", () => openCostModal());
  $("costs-filter-category").addEventListener("change", (e) => {
    filterCategory = e.target.value;
    renderCostsTable($("costs-table-container"));
  });

  onAuthChange(() => loadCostsPage());
  initAuth().then(loadCostsPage);
}

document.addEventListener("DOMContentLoaded", init);
