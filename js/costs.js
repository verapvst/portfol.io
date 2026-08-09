/* ============================================================
   costs.js - the Costs page. Insert-only, same discipline as
   valuations.js: a cost row is valid from its date until superseded by a
   later row for the same security/cost name (workbook Costs sheet
   philosophy - a TER change next year is a new row, not an edit to this
   one). No edit/delete UI, just Add + list, same as Valuations.

   $()/ensurePortfolio()/loadAccountsForPortfolio()/loadSecurities()/
   findOrCreateSecurity() live in db.js.
   ============================================================ */

let currentPortfolioId = null;
let accountsCache = [];
let securitiesCache = [];
let costsCache = [];
let filterCategory = "";

const COST_CATEGORIES = ["Management", "Trading", "Custody", "Other"];
const FREQUENCIES = ["One-off", "Daily", "Monthly", "Quarterly", "Annual"];
const UNITS = ["%", "EUR", "USD"];
const SECURITY_TYPES = ["Fund", "ETF", "Stock", "Bond", "Cash", "Other"];

/* ---------- Data access ---------- */

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

/* ---------- Rendering ---------- */

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
      <td>${c.source || "—"}</td>
      <td class="notes-cell">${c.notes || ""}</td>
    </tr>`).join("");

  container.innerHTML = `
    <div class="costs-table-scroll">
      <table class="costs-table">
        <thead><tr>
          <th>Date</th><th>Applies to</th><th>Category</th><th>Name</th>
          <th>Frequency</th><th>Value</th><th>Source</th><th>Notes</th>
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

async function refreshCosts() {
  const container = $("costs-table-container");
  await loadCosts();
  renderCostsTable(container);
}

/* ---------- Add modal ---------- */

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
        source: $("cost-source").value.trim() || null,
        notes: $("cost-notes").value.trim() || null,
      };

      const { error } = await window.db.from("costs").insert(payload);
      if (error) throw error;

      close();
      await refreshCosts();
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
  const container = $("costs-table-container");
  container.innerHTML = `
    <div class="costs-signin-note">
      Sign in to view and record costs.
      <br/>
      <button type="button" id="costs-signin-cta">Sign In</button>
    </div>`;
  $("costs-signin-cta").addEventListener("click", () => window.openAuthModal());
  $("add-cost-btn").disabled = true;
}

async function loadCostsPage() {
  const container = $("costs-table-container");
  const user = currentUser();

  if (!window.db) {
    container.innerHTML = `<p class="costs-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    $("add-cost-btn").disabled = true;
    return;
  }

  if (!user) {
    renderSignedOutState();
    return;
  }

  $("add-cost-btn").disabled = false;
  container.innerHTML = `<p class="costs-empty">Loading…</p>`;

  try {
    currentPortfolioId = await ensurePortfolio();
    accountsCache = await loadAccountsForPortfolio(currentPortfolioId);
    securitiesCache = await loadSecurities();
    renderCategoryFilter();
    await loadCosts();
    renderCostsTable(container);
  } catch (err) {
    const missingTable = /relation .*costs.* does not exist/i.test(err.message || "");
    container.innerHTML = `<p class="costs-error">${
      missingTable
        ? "The costs table doesn't exist yet — run supabase/migrations/0002_costs.sql in the Supabase SQL Editor first."
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
    subtitle: "TERs, custody fees, commissions — every recurring cost, dated and sourced.",
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
