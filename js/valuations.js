/* ============================================================
   valuations.js - the Valuations page. Deliberately the simplest of the
   three CRUD pages so far: valuations are insert-only (Migration Plan
   §2.5 - "a valuation is an observation, never edited... no UPDATE
   policy at all, only INSERT" as a UI-level discipline). A wrong figure
   gets superseded by a new dated row for the same security, never
   corrected in place - so there is no edit modal here, only quick entry.
   This is the exact page your own example described: "today's value,
   product, date, Save."

   $()/ensurePortfolio()/loadAccountsForPortfolio()/loadSecurities()/
   findOrCreateSecurity() live in db.js.
   ============================================================ */

let currentPortfolioId = null;
let securitiesCache = [];
let valuationsCache = [];
let filterSecurityId = "";

const SECURITY_TYPES = ["Fund", "ETF", "Stock", "Bond", "Cash", "Other"];

/* ---------- Data access ---------- */

async function loadValuations() {
  const { data, error } = await window.db
    .from("valuations")
    .select("*, securities(id, name)")
    .eq("portfolio_id", currentPortfolioId)
    .order("date", { ascending: false });
  if (error) throw error;
  valuationsCache = data || [];
  return valuationsCache;
}

/* ---------- Rendering ---------- */

function fmtNum(n) {
  return n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function renderValuationsTable(container) {
  const rows = filterSecurityId ? valuationsCache.filter((v) => v.security_id === filterSecurityId) : valuationsCache;

  if (!rows.length) {
    container.innerHTML = `<p class="valuations-empty">No valuations recorded yet.</p>`;
    return;
  }

  const html = rows.map((v) => `
    <tr>
      <td>${v.date}</td>
      <td>${v.securities ? v.securities.name : "—"}</td>
      <td class="amount-cell">€${fmtNum(v.value_eur)}</td>
      <td class="amount-cell">${fmtNum(v.units)}</td>
      <td>${v.source || "—"}</td>
      <td class="notes-cell">${v.notes || ""}</td>
    </tr>`).join("");

  container.innerHTML = `
    <div class="valuations-table-scroll">
      <table class="valuations-table">
        <thead><tr><th>Date</th><th>Security</th><th>Value (EUR)</th><th>Units</th><th>Source</th><th>Notes</th></tr></thead>
        <tbody>${html}</tbody>
      </table>
    </div>`;
}

function renderSecurityFilter() {
  const select = $("valuations-filter-security");
  const current = select.value;
  select.innerHTML = `<option value="">All securities</option>` +
    securitiesCache.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  select.value = current;
}

async function refreshValuations() {
  const container = $("valuations-table-container");
  await loadValuations();
  renderValuationsTable(container);
}

/* ---------- Quick-entry modal ---------- */

function securityOptionsHTML() {
  return SECURITY_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
}

function initValuationModal() {
  if (document.getElementById("valuation-modal-root")) return;

  const root = document.createElement("div");
  root.id = "valuation-modal-root";
  root.innerHTML = `
    <div id="valuation-modal-backdrop"></div>
    <div id="valuation-modal" class="glass" role="dialog" aria-modal="true" aria-label="Add Valuation">
      <h2 class="owner-modal-title">Add Valuation</h2>
      <div class="val-form-field">
        <label for="val-security">Security</label>
        <input id="val-security" type="text" list="val-security-options" placeholder="e.g. BPI Dinâmico" />
        <datalist id="val-security-options"></datalist>
      </div>
      <div class="val-form-field">
        <label for="val-security-type">Security Type (used only if creating a new one)</label>
        <select id="val-security-type">${securityOptionsHTML()}</select>
      </div>
      <div class="val-form-field">
        <label for="val-date">Date</label>
        <input id="val-date" type="date" />
      </div>
      <div class="val-form-field">
        <label for="val-value">Value (EUR)</label>
        <input id="val-value" type="number" step="any" placeholder="e.g. 12584" />
      </div>
      <div class="val-form-field">
        <label for="val-units">Units (optional)</label>
        <input id="val-units" type="number" step="any" />
      </div>
      <div class="val-form-field">
        <label for="val-source">Source (optional)</label>
        <input id="val-source" type="text" placeholder="e.g. Trading212 app" />
      </div>
      <p class="val-form-error" id="val-form-error"></p>
      <div class="val-form-actions">
        <button class="val-form-cancel" type="button" id="val-form-cancel">Cancel</button>
        <button class="val-form-submit" type="button" id="val-form-submit">Save</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const close = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", valModalKeyHandler);
  };

  root.querySelector("#valuation-modal-backdrop").addEventListener("click", close);
  root.querySelector("#val-form-cancel").addEventListener("click", close);

  root.querySelector("#val-form-submit").addEventListener("click", async () => {
    const errorEl = $("val-form-error");
    const submitBtn = $("val-form-submit");
    errorEl.textContent = "";

    const securityName = $("val-security").value.trim();
    const date = $("val-date").value;
    const value = $("val-value").value;

    if (!securityName) { errorEl.textContent = "Security is required."; return; }
    if (!date) { errorEl.textContent = "Date is required."; return; }
    if (value === "") { errorEl.textContent = "Value is required."; return; }

    submitBtn.disabled = true;
    try {
      const securityId = await findOrCreateSecurity(
        { name: securityName, type: $("val-security-type").value, currency: "EUR" },
        securitiesCache
      );

      const payload = {
        portfolio_id: currentPortfolioId,
        security_id: securityId,
        date,
        value_eur: Number(value),
        units: $("val-units").value === "" ? null : Number($("val-units").value),
        source: $("val-source").value.trim() || null,
      };

      const { error } = await window.db.from("valuations").insert(payload);
      if (error) throw error;

      close();
      renderSecurityFilter();
      await refreshValuations();
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  });

  window.openValuationModalRoot = root;
  window.closeValuationModal = close;
}

function valModalKeyHandler(e) {
  if (e.key === "Escape") window.closeValuationModal();
}

function openValuationModal() {
  $("val-security").value = "";
  $("val-security-type").value = "Fund";
  $("val-date").value = new Date().toISOString().slice(0, 10);
  $("val-value").value = "";
  $("val-units").value = "";
  $("val-source").value = "";
  $("val-form-error").textContent = "";

  const datalist = $("val-security-options");
  datalist.innerHTML = securitiesCache.map((s) => `<option value="${s.name}"></option>`).join("");

  const root = window.openValuationModalRoot;
  root.classList.add("open");
  document.addEventListener("keydown", valModalKeyHandler);
  setTimeout(() => $("val-security").focus(), 50);
}

/* ---------- Page init ---------- */

function renderSignedOutState() {
  const container = $("valuations-table-container");
  container.innerHTML = `
    <div class="valuations-signin-note">
      Sign in to view and record valuations.
      <br/>
      <button type="button" id="valuations-signin-cta">Sign In</button>
    </div>`;
  $("valuations-signin-cta").addEventListener("click", () => window.openAuthModal());
  $("add-valuation-btn").disabled = true;
}

async function loadValuationsPage() {
  const container = $("valuations-table-container");
  const user = currentUser();

  if (!window.db) {
    container.innerHTML = `<p class="valuations-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    $("add-valuation-btn").disabled = true;
    return;
  }

  if (!user) {
    renderSignedOutState();
    return;
  }

  $("add-valuation-btn").disabled = false;
  container.innerHTML = `<p class="valuations-empty">Loading…</p>`;

  try {
    currentPortfolioId = await ensurePortfolio();
    securitiesCache = await loadSecurities();
    renderSecurityFilter();
    await loadValuations();
    renderValuationsTable(container);
  } catch (err) {
    container.innerHTML = `<p class="valuations-error">${err.message || "Failed to load valuations."}</p>`;
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Valuations",
    subtitle: "Dated value observations — the record every performance number is built from.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));
  initValuationModal();

  $("add-valuation-btn").addEventListener("click", () => openValuationModal());
  $("valuations-filter-security").addEventListener("change", (e) => {
    filterSecurityId = e.target.value;
    renderValuationsTable($("valuations-table-container"));
  });

  onAuthChange(() => loadValuationsPage());
  initAuth().then(loadValuationsPage);
}

document.addEventListener("DOMContentLoaded", init);
