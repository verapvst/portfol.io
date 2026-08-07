/* ============================================================
   accounts.js - the Accounts page. First real CRUD module: reads and
   writes Supabase directly (window.db), not repository.js's workbook
   mirror. Every write goes through the RLS policies in
   supabase/migrations/0001_initial_schema.sql - there is no separate
   permission check here, the database is the enforcement point.

   $()/ensurePortfolio()/loadInstitutions()/findOrCreateInstitution() live
   in db.js, shared with transactions.js and every future CRUD page.
   ============================================================ */

let currentPortfolioId = null;
let institutionsCache = [];
let accountsCache = [];
let editingAccountId = null;

/* ---------- Data access ---------- */

async function loadAccounts() {
  accountsCache = await loadAccountsForPortfolio(currentPortfolioId);
  return accountsCache;
}

/* ---------- Rendering ---------- */

function statusBadge(status) {
  return `<span class="status-badge ${status}">${status === "active" ? icon("checkCircle") : icon("archive")} ${status === "active" ? "Active" : "Closed"}</span>`;
}

function renderAccountsTable(container) {
  if (!accountsCache.length) {
    container.innerHTML = `<p class="accounts-empty">No accounts yet — add your first one to get started.</p>`;
    return;
  }

  const rows = accountsCache.map((a) => `
    <tr>
      <td>${a.name}</td>
      <td>${a.institutions ? a.institutions.name : "—"}</td>
      <td>${a.account_type}</td>
      <td>${a.jurisdiction || "—"}</td>
      <td>${a.currency}</td>
      <td>${a.opened_date || "—"}</td>
      <td>${statusBadge(a.status)}</td>
      <td class="notes-cell">${a.notes || ""}</td>
      <td>
        <div class="row-actions">
          <button class="row-action-btn" type="button" data-edit="${a.id}" aria-label="Edit">${icon("edit3")}</button>
          <button class="row-action-btn" type="button" data-toggle-status="${a.id}" aria-label="${a.status === "active" ? "Archive" : "Reactivate"}">${icon(a.status === "active" ? "archive" : "checkCircle")}</button>
        </div>
      </td>
    </tr>`).join("");

  container.innerHTML = `
    <div class="accounts-table-scroll">
      <table class="accounts-table">
        <thead><tr>
          <th>Name</th><th>Institution</th><th>Type</th><th>Jurisdiction</th>
          <th>Currency</th><th>Opened</th><th>Status</th><th>Notes</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openAccountModal(btn.dataset.edit));
  });
  container.querySelectorAll("[data-toggle-status]").forEach((btn) => {
    btn.addEventListener("click", () => toggleAccountStatus(btn.dataset.toggleStatus));
  });
}

async function toggleAccountStatus(id) {
  const account = accountsCache.find((a) => a.id === id);
  if (!account) return;
  const nextStatus = account.status === "active" ? "closed" : "active";
  const { error } = await window.db.from("accounts").update({ status: nextStatus }).eq("id", id);
  if (error) { alert(error.message); return; }
  await refreshAccounts();
}

async function refreshAccounts() {
  const container = $("accounts-table-container");
  await loadAccounts();
  renderAccountsTable(container);
}

/* ---------- Add/Edit modal ---------- */

function initAccountModal() {
  if (document.getElementById("account-modal-root")) return;

  const root = document.createElement("div");
  root.id = "account-modal-root";
  root.innerHTML = `
    <div id="account-modal-backdrop"></div>
    <div id="account-modal" class="glass" role="dialog" aria-modal="true" aria-label="Account">
      <h2 class="owner-modal-title" id="account-modal-title">Add Account</h2>
      <div class="account-form-grid">
        <div class="account-form-field">
          <label for="acc-name">Name</label>
          <input id="acc-name" type="text" placeholder="e.g. BPI Dinâmico" />
        </div>
        <div class="account-form-field">
          <label for="acc-institution">Institution</label>
          <input id="acc-institution" type="text" list="institution-options" placeholder="e.g. BPI" />
          <datalist id="institution-options"></datalist>
        </div>
        <div class="account-form-field half">
          <label for="acc-type">Account Type</label>
          <select id="acc-type">
            <option value="Brokerage">Brokerage</option>
            <option value="Bank">Bank</option>
            <option value="Pension">Pension</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="account-form-field half">
          <label for="acc-currency">Currency</label>
          <input id="acc-currency" type="text" value="EUR" maxlength="3" style="text-transform: uppercase;" />
        </div>
        <div class="account-form-field half">
          <label for="acc-jurisdiction">Jurisdiction</label>
          <input id="acc-jurisdiction" type="text" placeholder="e.g. Portugal" />
        </div>
        <div class="account-form-field half">
          <label for="acc-opened">Date Opened</label>
          <input id="acc-opened" type="date" />
        </div>
        <div class="account-form-field">
          <label for="acc-notes">Notes</label>
          <textarea id="acc-notes"></textarea>
        </div>
      </div>
      <p class="account-form-error" id="account-form-error"></p>
      <div class="account-form-actions">
        <button class="account-form-cancel" type="button" id="account-form-cancel">Cancel</button>
        <button class="account-form-submit" type="button" id="account-form-submit">Save Account</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const close = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", accountModalKeyHandler);
    editingAccountId = null;
  };

  root.querySelector("#account-modal-backdrop").addEventListener("click", close);
  root.querySelector("#account-form-cancel").addEventListener("click", close);

  root.querySelector("#account-form-submit").addEventListener("click", async () => {
    const errorEl = $("account-form-error");
    const submitBtn = $("account-form-submit");
    errorEl.textContent = "";

    const name = $("acc-name").value.trim();
    const currency = $("acc-currency").value.trim().toUpperCase();
    if (!name) { errorEl.textContent = "Name is required."; return; }
    if (!currency) { errorEl.textContent = "Currency is required."; return; }

    submitBtn.disabled = true;
    try {
      const institutionId = await findOrCreateInstitution($("acc-institution").value, institutionsCache);
      const payload = {
        portfolio_id: currentPortfolioId,
        institution_id: institutionId,
        name,
        account_type: $("acc-type").value,
        currency,
        jurisdiction: $("acc-jurisdiction").value.trim() || null,
        opened_date: $("acc-opened").value || null,
        notes: $("acc-notes").value.trim() || null,
      };

      if (editingAccountId) {
        const { error } = await window.db.from("accounts").update(payload).eq("id", editingAccountId);
        if (error) throw error;
      } else {
        const { error } = await window.db.from("accounts").insert(payload);
        if (error) throw error;
      }

      close();
      await refreshAccounts();
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  });

  window.openAccountModalRoot = root;
  window.closeAccountModal = close;
}

function openAccountModal(accountId) {
  editingAccountId = accountId || null;
  const account = editingAccountId ? accountsCache.find((a) => a.id === editingAccountId) : null;

  $("account-modal-title").textContent = account ? "Edit Account" : "Add Account";
  $("acc-name").value = account?.name || "";
  $("acc-institution").value = account?.institutions?.name || "";
  $("acc-type").value = account?.account_type || "Brokerage";
  $("acc-currency").value = account?.currency || "EUR";
  $("acc-jurisdiction").value = account?.jurisdiction || "";
  $("acc-opened").value = account?.opened_date || "";
  $("acc-notes").value = account?.notes || "";
  $("account-form-error").textContent = "";

  const datalist = $("institution-options");
  datalist.innerHTML = institutionsCache.map((i) => `<option value="${i.name}"></option>`).join("");

  const root = window.openAccountModalRoot;
  root.classList.add("open");
  document.addEventListener("keydown", accountModalKeyHandler);
  setTimeout(() => $("acc-name").focus(), 50);
}

function accountModalKeyHandler(e) {
  if (e.key === "Escape") window.closeAccountModal();
}

/* ---------- Page init ---------- */

function renderSignedOutState() {
  const container = $("accounts-table-container");
  container.innerHTML = `
    <div class="accounts-signin-note">
      Sign in to view and manage your accounts.
      <br/>
      <button type="button" id="accounts-signin-cta">Sign In</button>
    </div>`;
  $("accounts-signin-cta").addEventListener("click", () => window.openAuthModal());
  $("add-account-btn").disabled = true;
}

async function loadAccountsPage() {
  const container = $("accounts-table-container");
  const user = currentUser();

  if (!window.db) {
    container.innerHTML = `<p class="accounts-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    $("add-account-btn").disabled = true;
    return;
  }

  if (!user) {
    renderSignedOutState();
    return;
  }

  $("add-account-btn").disabled = false;
  container.innerHTML = `<p class="accounts-empty">Loading…</p>`;

  try {
    currentPortfolioId = await ensurePortfolio();
    institutionsCache = await loadInstitutions();
    await loadAccounts();
    renderAccountsTable(container);
  } catch (err) {
    container.innerHTML = `<p class="accounts-error">${err.message || "Failed to load accounts."}</p>`;
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  initNavigation(user);
  renderTopbar($("topbar"), user, {
    heading: "Accounts",
    subtitle: "Every brokerage, bank and pension account, in one place.",
  });
  initOwnerAccessModal();
  initOwnerAccessButton($("owner-access-slot"));
  initAuthModal();
  initAuthButton($("auth-slot"));
  initAccountModal();

  $("add-account-btn").addEventListener("click", () => openAccountModal(null));

  onAuthChange(() => loadAccountsPage());
  initAuth().then(loadAccountsPage);
}

document.addEventListener("DOMContentLoaded", init);
