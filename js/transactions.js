/* ============================================================
   transactions.js - the Transactions page. Same real-Supabase pattern as
   accounts.js, plus the one rule that makes this table different from
   Accounts: rows are never rewritten in place. "Edit" here means void
   the original row (voided=true, corrected_by -> the new row) and insert
   a replacement - the TransactionVoided compensating-event pattern from
   the Platform Architecture doc (§5.1), not a plain UPDATE. "Void" with
   no replacement is a separate action, for a transaction that should
   never have been recorded at all.

   $()/ensurePortfolio()/loadAccountsForPortfolio()/loadSecurities()/
   findOrCreateSecurity() live in db.js.
   ============================================================ */

let currentPortfolioId = null;
let accountsCache = [];
let securitiesCache = [];
let transactionsCache = [];
let editingTransactionId = null;
let showVoided = false;

const TXN_TYPES = ["buy", "sell", "dividend", "split", "fee", "deposit", "withdrawal"];
const SECURITY_TYPES = ["Fund", "ETF", "Stock", "Bond", "Cash", "Other"];

/* ---------- Data access ---------- */

async function loadTransactions() {
  const { data, error } = await window.db
    .from("transactions")
    .select("*, accounts(id, name), securities(id, name)")
    .eq("portfolio_id", currentPortfolioId)
    .order("date", { ascending: false });
  if (error) throw error;
  transactionsCache = data || [];
  return transactionsCache;
}

/* ---------- Rendering ---------- */

function fmtNum(n) {
  return n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function renderTransactionsTable(container) {
  const rows = showVoided ? transactionsCache : transactionsCache.filter((t) => !t.voided);

  if (!rows.length) {
    container.innerHTML = `<p class="transactions-empty">${showVoided ? "No transactions yet." : "No active transactions yet — add your first one, or check \"Show voided\" if you expect one here."}</p>`;
    return;
  }

  const html = rows.map((t) => `
    <tr class="${t.voided ? "is-voided" : ""}">
      <td>${t.date}</td>
      <td>${t.accounts ? t.accounts.name : "—"}</td>
      <td>${t.securities ? t.securities.name : "—"}</td>
      <td><span class="type-badge ${t.type}">${t.type}</span></td>
      <td class="amount-cell">${fmtNum(t.units)}</td>
      <td class="amount-cell">${fmtNum(t.amount)} ${t.currency}</td>
      <td class="amount-cell">${fmtNum(t.fees)}</td>
      <td>${t.voided ? `<span class="voided-tag">voided${t.corrected_by ? " · corrected" : ""}</span>` : ""}</td>
      <td>
        <div class="row-actions">
          ${t.voided ? "" : `
            <button class="row-action-btn" type="button" data-edit="${t.id}" aria-label="Edit (voids and replaces)">${icon("edit3")}</button>
            <button class="row-action-btn" type="button" data-void="${t.id}" aria-label="Void">${icon("xCircle")}</button>
          `}
        </div>
      </td>
    </tr>`).join("");

  container.innerHTML = `
    <div class="transactions-table-scroll">
      <table class="transactions-table">
        <thead><tr>
          <th>Date</th><th>Account</th><th>Security</th><th>Type</th>
          <th>Units</th><th>Amount</th><th>Fees</th><th></th><th></th>
        </tr></thead>
        <tbody>${html}</tbody>
      </table>
    </div>`;

  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openTransactionModal(btn.dataset.edit));
  });
  container.querySelectorAll("[data-void]").forEach((btn) => {
    btn.addEventListener("click", () => voidTransaction(btn.dataset.void));
  });
}

async function voidTransaction(id) {
  if (!confirm("Void this transaction? It stays in the record, just marked cancelled - nothing is deleted.")) return;
  const { error } = await window.db.from("transactions").update({ voided: true }).eq("id", id);
  if (error) { alert(error.message); return; }
  await refreshTransactions();
}

async function refreshTransactions() {
  const container = $("transactions-table-container");
  await loadTransactions();
  renderTransactionsTable(container);
}

/* ---------- Add/Edit modal ---------- */

function accountOptionsHTML() {
  return accountsCache.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
}

function typeOptionsHTML() {
  return TXN_TYPES.map((t) => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join("");
}

function securityTypeOptionsHTML() {
  return SECURITY_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
}

function initTransactionModal() {
  if (document.getElementById("transaction-modal-root")) return;

  const root = document.createElement("div");
  root.id = "transaction-modal-root";
  root.innerHTML = `
    <div id="transaction-modal-backdrop"></div>
    <div id="transaction-modal" class="glass" role="dialog" aria-modal="true" aria-label="Transaction">
      <h2 class="owner-modal-title" id="transaction-modal-title">Add Transaction</h2>
      <p class="txn-form-note" id="transaction-modal-edit-note" hidden>Saving replaces the original row - it's voided, not deleted, and stays visible with "Show voided".</p>
      <div class="txn-form-grid">
        <div class="txn-form-field half">
          <label for="txn-account">Account</label>
          <select id="txn-account">${accountOptionsHTML()}</select>
        </div>
        <div class="txn-form-field half">
          <label for="txn-type">Type</label>
          <select id="txn-type">${typeOptionsHTML()}</select>
        </div>
        <div class="txn-form-field half">
          <label for="txn-security">Security</label>
          <input id="txn-security" type="text" list="security-options" placeholder="e.g. VWCE" />
          <datalist id="security-options"></datalist>
        </div>
        <div class="txn-form-field half">
          <label for="txn-security-type">Security Type</label>
          <select id="txn-security-type">${securityTypeOptionsHTML()}</select>
        </div>
        <div class="txn-form-field half">
          <label for="txn-date">Date</label>
          <input id="txn-date" type="date" />
        </div>
        <div class="txn-form-field half">
          <label for="txn-currency">Currency</label>
          <input id="txn-currency" type="text" value="EUR" maxlength="3" style="text-transform: uppercase;" />
        </div>
        <div class="txn-form-field half">
          <label for="txn-units">Units</label>
          <input id="txn-units" type="number" step="any" />
        </div>
        <div class="txn-form-field half">
          <label for="txn-amount">Amount</label>
          <input id="txn-amount" type="number" step="any" />
        </div>
        <div class="txn-form-field third">
          <label for="txn-fees">Fees</label>
          <input id="txn-fees" type="number" step="any" value="0" />
        </div>
        <div class="txn-form-field third">
          <label for="txn-tax">Tax</label>
          <input id="txn-tax" type="number" step="any" value="0" />
        </div>
        <div class="txn-form-field third">
          <label for="txn-fx-cost">FX Cost</label>
          <input id="txn-fx-cost" type="number" step="any" value="0" />
        </div>
        <div class="txn-form-field">
          <label for="txn-notes">Notes</label>
          <input id="txn-notes" type="text" />
        </div>
      </div>
      <p class="txn-form-error" id="txn-form-error"></p>
      <div class="txn-form-actions">
        <button class="txn-form-cancel" type="button" id="txn-form-cancel">Cancel</button>
        <button class="txn-form-submit" type="button" id="txn-form-submit">Save Transaction</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const close = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", txnModalKeyHandler);
    editingTransactionId = null;
  };

  root.querySelector("#transaction-modal-backdrop").addEventListener("click", close);
  root.querySelector("#txn-form-cancel").addEventListener("click", close);

  root.querySelector("#txn-form-submit").addEventListener("click", async () => {
    const errorEl = $("txn-form-error");
    const submitBtn = $("txn-form-submit");
    errorEl.textContent = "";

    const accountId = $("txn-account").value;
    const securityName = $("txn-security").value.trim();
    const date = $("txn-date").value;
    const amount = $("txn-amount").value;
    const currency = $("txn-currency").value.trim().toUpperCase();

    if (!accountId) { errorEl.textContent = "Account is required."; return; }
    if (!securityName) { errorEl.textContent = "Security is required."; return; }
    if (!date) { errorEl.textContent = "Date is required."; return; }
    if (amount === "") { errorEl.textContent = "Amount is required."; return; }
    if (!currency) { errorEl.textContent = "Currency is required."; return; }

    submitBtn.disabled = true;
    try {
      const securityId = await findOrCreateSecurity(
        { name: securityName, type: $("txn-security-type").value, currency },
        securitiesCache
      );

      const payload = {
        portfolio_id: currentPortfolioId,
        account_id: accountId,
        security_id: securityId,
        type: $("txn-type").value,
        date,
        units: $("txn-units").value === "" ? null : Number($("txn-units").value),
        amount: Number(amount),
        fees: Number($("txn-fees").value || 0),
        tax: Number($("txn-tax").value || 0),
        fx_cost: Number($("txn-fx-cost").value || 0),
        currency,
        notes: $("txn-notes").value.trim() || null,
      };

      if (editingTransactionId) {
        const { data: replacement, error: insertError } = await window.db
          .from("transactions").insert(payload).select("id").single();
        if (insertError) throw insertError;

        const { error: voidError } = await window.db
          .from("transactions")
          .update({ voided: true, corrected_by: replacement.id })
          .eq("id", editingTransactionId);
        if (voidError) throw voidError;
      } else {
        const { error } = await window.db.from("transactions").insert(payload);
        if (error) throw error;
      }

      close();
      await refreshTransactions();
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  });

  window.openTransactionModalRoot = root;
  window.closeTransactionModal = close;
}

function txnModalKeyHandler(e) {
  if (e.key === "Escape") window.closeTransactionModal();
}

function openTransactionModal(transactionId) {
  editingTransactionId = transactionId || null;
  const txn = editingTransactionId ? transactionsCache.find((t) => t.id === editingTransactionId) : null;

  $("transaction-modal-title").textContent = txn ? "Edit Transaction" : "Add Transaction";
  $("transaction-modal-edit-note").hidden = !txn;

  $("txn-account").innerHTML = accountOptionsHTML();
  $("txn-account").value = txn?.account_id || accountsCache[0]?.id || "";
  $("txn-type").value = txn?.type || "buy";
  $("txn-security").value = txn?.securities?.name || "";
  $("txn-security-type").value = "Fund";
  $("txn-date").value = txn?.date || new Date().toISOString().slice(0, 10);
  $("txn-currency").value = txn?.currency || "EUR";
  $("txn-units").value = txn?.units ?? "";
  $("txn-amount").value = txn?.amount ?? "";
  $("txn-fees").value = txn?.fees ?? 0;
  $("txn-tax").value = txn?.tax ?? 0;
  $("txn-fx-cost").value = txn?.fx_cost ?? 0;
  $("txn-notes").value = txn?.notes || "";
  $("txn-form-error").textContent = "";

  const datalist = $("security-options");
  datalist.innerHTML = securitiesCache.map((s) => `<option value="${s.name}"></option>`).join("");

  const root = window.openTransactionModalRoot;
  root.classList.add("open");
  document.addEventListener("keydown", txnModalKeyHandler);
  setTimeout(() => $("txn-account").focus(), 50);
}

/* ---------- Page init ---------- */

/** A deliberate feature-preview/authenticated-gate state, not a
    sign-in nudge bolted onto an otherwise-empty page. The point (per
    the access-model brief) is that a signed-out visitor should learn
    "this platform has a transaction-management feature" without
    learning anything about the real data - so nothing here is a masked
    or truncated version of a real transaction; no query for
    transactions/accounts/securities ever runs before `user` is checked
    (see loadTransactionsPage() below), so there is nothing to
    accidentally leak even a count or shape of. */
function renderSignedOutState() {
  const container = $("transactions-table-container");
  container.innerHTML = `
    <div class="transactions-gated-state">
      <span class="transactions-gated-icon">${icon("lock")}</span>
      <h3 class="transactions-gated-title">Transactions</h3>
      <p class="transactions-gated-message">Your transaction history is private.</p>
      <button type="button" id="transactions-signin-cta" class="transactions-gated-cta">Login to access</button>
    </div>`;
  $("transactions-signin-cta").addEventListener("click", () => window.openAuthModal());
  $("add-transaction-btn").disabled = true;
}

function renderNoAccountsState() {
  const container = $("transactions-table-container");
  container.innerHTML = `
    <div class="transactions-signin-note">
      No accounts yet — a transaction always belongs to an account.
      <br/>
      <a href="accounts.html">Add an account first</a>
    </div>`;
  $("add-transaction-btn").disabled = true;
}

async function loadTransactionsPage() {
  const container = $("transactions-table-container");
  const user = currentUser();

  if (!window.db) {
    container.innerHTML = `<p class="transactions-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    $("add-transaction-btn").disabled = true;
    return;
  }

  if (!user) {
    renderSignedOutState();
    return;
  }

  container.innerHTML = `<p class="transactions-empty">Loading…</p>`;

  try {
    currentPortfolioId = await ensurePortfolio();
    accountsCache = await loadAccountsForPortfolio(currentPortfolioId);
    securitiesCache = await loadSecurities();

    if (!accountsCache.length) {
      renderNoAccountsState();
      return;
    }

    $("add-transaction-btn").disabled = false;
    await loadTransactions();
    renderTransactionsTable(container);
  } catch (err) {
    container.innerHTML = `<p class="transactions-error">${err.message || "Failed to load transactions."}</p>`;
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Transactions",
    subtitle: "Every buy, sell, dividend and cash movement, dated and sourced.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));
  initTransactionModal();

  $("add-transaction-btn").addEventListener("click", () => openTransactionModal(null));
  $("show-voided-toggle").addEventListener("change", (e) => {
    showVoided = e.target.checked;
    renderTransactionsTable($("transactions-table-container"));
  });

  onAuthChange(() => loadTransactionsPage());
  initAuth().then(loadTransactionsPage);
}

document.addEventListener("DOMContentLoaded", init);
