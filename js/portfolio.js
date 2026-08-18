/* ============================================================
   portfolio.js - the Portfolio page ("what do I own, and how is it
   distributed?"). Merges the old Portfolio Detail (holdings table,
   Update workflow) and Allocation (asset class/concentration/security/
   account/geographic breakdowns) pages - per the Product & Architecture
   Re-Think audit, both read the exact same data.portfolio.holdings/
   data.analytics.* contract (getPortfolioDataAuto()), so this merge is
   a UI consolidation, not a second data path. NEVER computes or shows a
   return % - that's scopedPerformance()'s job, and it stays on
   Performance exclusively (see that audit's §7, and this session's
   earlier removal of account-performance cards from Portfolio Detail).

   Scope selector (All Portfolio / BPI / Trading 212): filters
   data.portfolio.holdings by accountId client-side - no new query, the
   field already exists. Holdings/Top Concentrations/Security Allocation
   are scope-aware (weight recomputed relative to the scope's own
   subtotal, never the whole-portfolio weight, once a single account is
   selected - "67.75% of the whole portfolio" and "97% of just BPI" are
   different, both true, facts).

   Asset Class Allocation, Account Allocation and Geographic Exposure
   stay ALL-SCOPE ONLY: their source data (data.analytics.
   assetClassAllocation/regions/countries/currency) is still
   repository.js's not-yet-migrated static import (see analytics.js's
   own header comment), genuinely not split by account today - showing
   them filtered would either recompute something the data can't
   support or silently show whole-portfolio numbers under a per-account
   label. Hidden with an honest explanatory note instead of faked.
   ============================================================ */

function $(id) { return document.getElementById(id); }

let currentPortfolioId = null;
let currentScope = "all"; // "all" | an accounts.id

function accountName(data, accountId) {
  const acc = data.portfolio.accounts.find((a) => a.id === accountId);
  return acc ? acc.name : "—";
}

/** Holdings filtered to the current scope, with weight RECOMPUTED
    relative to the scope's own subtotal - never the whole-portfolio
    weight once a single account is selected. Reused by Holdings table,
    Top Concentrations and Security Allocation so the three sections
    can't disagree about what "in scope" means. */
function scopedHoldings(data) {
  const all = data.portfolio.holdings;
  const filtered = currentScope === "all" ? all : all.filter((h) => h.accountId === currentScope);
  const scopeTotal = filtered.reduce((s, h) => s + h.value, 0);
  return filtered.map((h) => ({
    ...h,
    weight: scopeTotal ? Math.round((h.value / scopeTotal) * 10000) / 100 : 0,
  }));
}

/* ---------- Scope selector ---------- */

function renderScopeSelector(data) {
  const row = $("portfolio-scope-row");
  const scopes = [{ id: "all", name: "All Portfolio" }, ...data.portfolio.accounts];
  row.innerHTML = scopes.map((s) =>
    `<button class="filter-pill${s.id === currentScope ? " active" : ""}" data-scope="${s.id}" type="button">${s.name}</button>`
  ).join("");
  row.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentScope = btn.dataset.scope;
      renderAll(data);
    });
  });

  const holdings = data.portfolio.holdings;
  const accountsCount = data.portfolio.accounts.length;
  $("portfolio-summary").textContent = currentScope === "all"
    ? `${holdings.length} holding${holdings.length === 1 ? "" : "s"} across ${accountsCount} account${accountsCount === 1 ? "" : "s"}${isOwnerMode() ? ` · ${fmtEUR(data.analytics.performance.totalValue)} total` : ""}`
    : `Asset class, account and geographic breakdowns are only available at the All Portfolio level today.`;
}

/* ---------- Holdings table ----------
   Avg. Cost / Unrealised P&L columns only render in Private mode - a
   whole row of "······" repeated three times reads as noise, not
   privacy, so the columns themselves aren't there in Showcase.
   Weight/Type are ratio/structural facts, shown either way. Account
   column hidden once scoped to a single account - every row would show
   the same value, pure redundancy. */
function holdingsDetailRowHTML(h, data, owner, signedIn, showAccountColumn) {
  const pnlTone = h.pnl > 0 ? "up" : h.pnl < 0 ? "down" : "text-muted";
  const moneyCells = owner ? `
      <td>${formatMoney(h.value)}</td>
      <td>${h.costBasis != null ? formatMoney(h.costBasis) : "—"}</td>
      <td class="${h.pnl != null ? pnlTone : "text-muted"}">${h.pnl != null ? `${formatMoney(h.pnl, { signed: true })}${h.pnlPct != null ? ` (${fmtPct(h.pnlPct)})` : ""}` : "—"}</td>` : "";
  const actionCell = signedIn ? `
      <td>
        <div class="row-actions">
          <button class="row-action-btn" type="button" data-update-holding="${h.id}" data-holding-name="${h.name}" aria-label="Update ${h.name}" title="Update">${icon("edit3")}</button>
        </div>
      </td>` : "";

  return `
    <tr data-drill-type="holding" data-drill-id="${h.id}" tabindex="0" role="button" aria-label="${h.name} details">
      <td>
        <p class="asset-name">${h.name}</p>
        <p class="asset-ticker">${h.ticker} · ${h.type}</p>
      </td>
      ${showAccountColumn ? `<td>${accountName(data, h.accountId)}</td>` : ""}
      <td>${h.weight.toFixed(2)}%</td>
      ${moneyCells}
      ${actionCell}
    </tr>`;
}

function renderHoldingsDetail(container, data, holdings) {
  const owner = isOwnerMode();
  const signedIn = !!currentUser();
  const showAccountColumn = currentScope === "all";
  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);

  if (!sorted.length) {
    container.innerHTML = `<p class="holdings-detail-empty">No holdings on record yet.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-scroll">
      <table class="holdings-table holdings-detail-table${owner ? "" : " showcase"}">
        <thead>
          <tr>
            <th>Asset</th>${showAccountColumn ? "<th>Account</th>" : ""}<th>Weight</th>
            ${owner ? `<th>Market Value</th><th data-info="cost-basis" tabindex="0" role="button" aria-label="About this metric">Avg. Cost</th><th data-info="unrealised-pnl" tabindex="0" role="button" aria-label="About this metric">Unrealised P&amp;L</th>` : ""}
            ${signedIn ? `<th></th>` : ""}
          </tr>
        </thead>
        <tbody>${sorted.map((h) => holdingsDetailRowHTML(h, data, owner, signedIn, showAccountColumn)).join("")}</tbody>
      </table>
    </div>`;
}

/* ---------- Shared ranked-row primitive (Security/Account Allocation, Top Concentrations) ---------- */

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

function signinNoteHTML(label) {
  return `
    <div class="costs-signin-note">
      Sign in to see ${label}.
      <br/>
      <button type="button" class="alloc-signin-cta">Sign In</button>
    </div>`;
}
function wireSigninCTAs(container) {
  container.querySelectorAll(".alloc-signin-cta").forEach((btn) => btn.addEventListener("click", () => window.openAuthModal()));
}

/* ---------- Top Concentrations - scope-aware ---------- */

function computeConcentration(holdings) {
  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
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

function renderConcentration(data, holdings) {
  const { sorted, top1, top3, top5 } = computeConcentration(holdings);

  if (!sorted.length && !currentUser()) {
    $("concentration-stats").innerHTML = "";
    $("concentration-list").innerHTML = signinNoteHTML("individual holdings");
    wireSigninCTAs($("concentration-list"));
    return;
  }

  $("concentration-stats").innerHTML = [
    concentrationTileHTML("Top 1 Holding", top1, sorted[0] ? sorted[0].name : "—"),
    concentrationTileHTML("Top 3 Holdings", top3, "combined weight"),
    concentrationTileHTML("Top 5 Holdings", top5, "combined weight"),
  ].join("");

  $("concentration-list").innerHTML = sorted.slice(0, 5).map((h) => barRowHTML({
    label: h.name, weight: h.weight, tone: h.tone, drillType: "holding", drillId: h.id,
  })).join("");
}

/* ---------- Security Allocation - scope-aware ---------- */

function renderSecurityAllocation(holdings) {
  const items = [...holdings].sort((a, b) => b.weight - a.weight);
  if (!items.length && !currentUser()) {
    $("security-allocation-body").innerHTML = signinNoteHTML("the full security-by-security breakdown");
    wireSigninCTAs($("security-allocation-body"));
    return;
  }
  $("security-allocation-body").innerHTML = items.map((h) => barRowHTML({
    label: `${h.name}${h.ticker !== "—" ? ` · ${h.ticker}` : ""}`, weight: h.weight, tone: h.tone,
    drillType: "holding", drillId: h.id,
  })).join("");
}

/* ---------- Asset Class / Account Allocation / Geographic Exposure -
   ALL-SCOPE ONLY, see this file's own header comment for why. ---------- */

function renderAssetClass(data) {
  const items = data.analytics.assetClassAllocation;
  const total = items.reduce((s, it) => s + it.weight, 0);
  const container = $("asset-class-viz");
  container.innerHTML = `<div id="asset-class-donut"></div>`;
  renderDonut(container.querySelector("#asset-class-donut"), items, "Asset Class", `${total.toFixed(1)}%`, { drillType: "assetClass" });
}

function renderAccountAllocation(data) {
  const owner = isOwnerMode();
  const items = [...data.analytics.accountAllocation].sort((a, b) => b.weight - a.weight);
  if (!items.length && !currentUser()) {
    $("account-allocation-body").innerHTML = signinNoteHTML("account-level allocation");
    wireSigninCTAs($("account-allocation-body"));
    return;
  }
  $("account-allocation-body").innerHTML = items.map((a) => barRowHTML({
    label: a.name, weight: a.weight, tone: a.tone,
    drillType: "account", drillId: a.name,
    valueLabel: owner ? fmtEUR(a.value) : null,
  })).join("");
}

function renderGeographicExposure(data) {
  renderExposure({
    tabsEl: $("exposure-tabs"),
    vizEl: $("exposure-viz"),
    hintEl: $("exposure-hint"),
    titleEl: document.querySelector("#exposure-card .card-header-title"),
  }, data);
}

/** Toggles visibility of the three ALL-SCOPE-ONLY cards - .card's own
    display:flex outranks the [hidden] UA rule, so display is set
    directly (same pattern app.js's renderAll() already uses for
    Health/Insights). */
function setAllScopeCardsVisible(visible) {
  ["asset-class-card", "account-allocation-card", "exposure-card"].forEach((id) => {
    $(id).style.display = visible ? "" : "none";
  });
}

function renderAll(data) {
  renderScopeSelector(data);
  const holdings = scopedHoldings(data);

  renderHoldingsDetail($("holdings-detail-table"), data, holdings);
  renderConcentration(data, holdings);
  renderSecurityAllocation(holdings);

  const allScope = currentScope === "all";
  setAllScopeCardsVisible(allScope);
  if (allScope) {
    renderAssetClass(data);
    renderAccountAllocation(data);
    renderGeographicExposure(data);
  }
}

/* ---------- Holdings Update workflow (unchanged from Portfolio Detail) ----------
   Every submit calls recordValuations() (db.js), the one shared
   insert-only write path Data Hub's Manual Update also goes through. */

async function loadLatestValuation(securityId, portfolioId) {
  const { data, error } = await window.db
    .from("valuations")
    .select("*")
    .eq("security_id", securityId)
    .eq("portfolio_id", portfolioId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function initHoldingUpdateModal() {
  if ($("holding-update-modal-root")) return;

  const root = document.createElement("div");
  root.id = "holding-update-modal-root";
  root.innerHTML = `
    <div id="holding-update-modal-backdrop"></div>
    <div id="holding-update-modal" class="glass" role="dialog" aria-modal="true" aria-label="Update Holding">
      <h2 class="owner-modal-title">Update Holding</h2>
      <div class="hu-security-context glass-quiet">
        <span class="hu-security-name" id="hu-security-name"></span>
        <span class="hu-security-hint">Adds a new dated observation — never overwrites what's already on record.</span>
      </div>
      <div class="val-form-field">
        <label for="hu-date">Date</label>
        <input id="hu-date" type="date" />
      </div>
      <div class="val-form-field">
        <label for="hu-value">Value (EUR)</label>
        <input id="hu-value" type="number" step="any" />
      </div>
      <div class="val-form-field">
        <label for="hu-units">Units (optional)</label>
        <input id="hu-units" type="number" step="any" />
      </div>
      <div class="val-form-field">
        <label for="hu-source">Source (optional)</label>
        <input id="hu-source" type="text" placeholder="e.g. BPI app" />
      </div>
      <p class="val-form-error" id="hu-form-error"></p>
      <div class="val-form-actions">
        <button class="val-form-cancel" type="button" id="hu-form-cancel">Cancel</button>
        <button class="val-form-submit" type="button" id="hu-form-submit">Save Update</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const close = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", huModalKeyHandler);
  };
  root.querySelector("#holding-update-modal-backdrop").addEventListener("click", close);
  root.querySelector("#hu-form-cancel").addEventListener("click", close);

  root.querySelector("#hu-form-submit").addEventListener("click", async () => {
    const errorEl = $("hu-form-error");
    const submitBtn = $("hu-form-submit");
    errorEl.textContent = "";

    const securityId = root.dataset.securityId;
    const date = $("hu-date").value;
    const value = $("hu-value").value;

    if (!date) { errorEl.textContent = "Date is required."; return; }
    if (value === "") { errorEl.textContent = "Value is required."; return; }

    submitBtn.disabled = true;
    try {
      await recordValuations([{
        portfolio_id: currentPortfolioId,
        security_id: securityId,
        date,
        value_eur: Number(value),
        units: $("hu-units").value === "" ? null : Number($("hu-units").value),
        source: $("hu-source").value.trim() || null,
      }]);

      close();
      const data = await getPortfolioDataAuto();
      setCurrentPortfolioData(data);
      renderAll(data);
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  });

  window.closeHoldingUpdateModal = close;
}

function huModalKeyHandler(e) {
  if (e.key === "Escape") window.closeHoldingUpdateModal();
}

async function openHoldingUpdateModal(securityId, securityName) {
  const root = $("holding-update-modal-root");
  root.dataset.securityId = securityId;
  $("hu-security-name").textContent = securityName;
  $("hu-date").value = new Date().toISOString().slice(0, 10);
  $("hu-value").value = "";
  $("hu-units").value = "";
  $("hu-source").value = "";
  $("hu-form-error").textContent = "";

  root.classList.add("open");
  document.addEventListener("keydown", huModalKeyHandler);
  setTimeout(() => $("hu-value").focus(), 50);

  try {
    const latest = await loadLatestValuation(securityId, currentPortfolioId);
    if (latest && root.dataset.securityId === securityId) {
      $("hu-value").value = latest.value_eur;
      if (latest.units != null) $("hu-units").value = latest.units;
      if (latest.source) $("hu-source").value = latest.source;
    }
  } catch (err) {
    // Prefill failing isn't fatal - the user can still type the value in by hand.
  }
}

async function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  initDrillDown();
  initHoldingUpdateModal();

  renderTopbar($("topbar"), user, {
    heading: "Portfolio",
    subtitle: "What you own, and how it's distributed.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  $("holdings-detail-table").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-update-holding]");
    if (!btn) return;
    e.stopPropagation();
    openHoldingUpdateModal(btn.dataset.updateHolding, btn.dataset.holdingName);
  });

  const loadAndRender = async () => {
    if (currentUser()) currentPortfolioId = await ensurePortfolio();
    const data = await getPortfolioDataAuto();
    setCurrentPortfolioData(data);
    renderAll(data);
  };
  onAuthChange(() => { loadAndRender(); });
  await initAuth();
  await loadAndRender();
}

document.addEventListener("DOMContentLoaded", init);
