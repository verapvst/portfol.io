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

      // Portfolio Value is driven entirely by valuations, never by
      // transactions (see analytics.js's getPortfolioDataLive() - a
      // security only ever appears as a holding once it has a real,
      // nonzero valuation row) - a Buy with no live valuation yet is
      // invisible to it, which reads as a bug the moment you buy
      // something brand new OR re-buy something you'd fully exited.
      // Seed one initial valuation, from the purchase itself, but
      // ONLY when there's no LIVE (nonzero) valuation already tracked -
      // checking "latest value is 0 or missing" rather than "any
      // valuation row exists at all", so re-entering a position after
      // a genuine full exit (which closes it at 0) correctly re-seeds
      // too, instead of staying stuck at that stale 0 forever. Still
      // never fires while an existing holding is actually live: topping
      // up with a second Buy must never overwrite its real tracked
      // value with just the top-up amount - ongoing tracking still goes
      // through the normal Update Portfolio flow. Also skipped on an
      // edit (editingTransactionId set) - editing corrects the details
      // of an already-processed purchase, it isn't a new one, so it
      // must not re-seed on top of whatever's already there.
      if (payload.type === "buy" && !editingTransactionId) {
        const { data: latestVal, error: valCheckError } = await window.db
          .from("valuations").select("value_eur")
          .eq("security_id", securityId)
          .order("date", { ascending: false })
          .limit(1);
        if (valCheckError) throw valCheckError;
        const hasLiveValuation = latestVal && latestVal.length && Number(latestVal[0].value_eur) !== 0;
        if (!hasLiveValuation) {
          await recordValuations([{
            portfolio_id: currentPortfolioId,
            security_id: securityId,
            date,
            value_eur: Number(amount),
            units: payload.units,
            source: "initial purchase",
          }]);
        }
      }

      // A Sell that closes a position out entirely should stop counting
      // it as a current holding - close its own valuation at €0, dated
      // the sell, so both the historical value series and today's
      // snapshot correctly reflect the exit going forward (getPortfolioDataLive()'s
      // holdings filter drops any security whose latest valuation is 0).
      // Only attempted when Units was actually entered on every one of
      // this security's real transactions - Units is optional, and a
      // full exit can't be told apart from a partial one without it, so
      // a security with any untracked-units transaction is left alone
      // rather than guessed at (you'd zero it out yourself via Manual
      // Update in that case).
      if (payload.type === "sell" && payload.units != null) {
        const { data: allTxns, error: txnFetchError } = await window.db
          .from("transactions")
          .select("type, units")
          .eq("security_id", securityId)
          .eq("voided", false);
        if (txnFetchError) throw txnFetchError;
        const unitsFullyTracked = (allTxns || []).every((t) => t.units != null || (t.type !== "buy" && t.type !== "sell"));
        if (unitsFullyTracked) {
          const netUnits = (allTxns || []).reduce((s, t) => {
            const sign = t.type === "sell" ? -1 : t.type === "buy" ? 1 : 0;
            return s + sign * (t.units || 0);
          }, 0);
          if (netUnits <= 0) {
            await recordValuations([{
              portfolio_id: currentPortfolioId,
              security_id: securityId,
              date,
              value_eur: 0,
              units: 0,
              source: "auto: full exit",
            }]);
          }
        }
      }

      // Buy/Sell move value between Cash and a security WITHIN the same
      // portfolio - they must not silently inflate/deflate total
      // portfolio value, since neither is external money (see
      // calculations.js's PORTFOLIO_EXTERNAL_CASH_FLOW_TYPES for the
      // matching fix on the return-calculation side). Cash is tracked
      // the same way as every other holding - periodic valuation
      // snapshots - so adjusting it means inserting a new dated row
      // from its own latest one, same recordValuations() path as
      // everything else. Skipped if Cash has never been tracked here -
      // never fabricate a balance that was never actually recorded.
      // This is a DELTA applied to whatever Cash's latest value already
      // is, so it must only ever fire once per real purchase/sale -
      // skipped on an edit (editingTransactionId set), since editing
      // corrects an already-processed transaction's details rather than
      // recording a second economic event; applying the delta again
      // would double-count it. A true void (no replacement) still does
      // not reverse this automatically - if a transaction is voided
      // outright after the fact, its Cash effect needs a manual Update
      // Portfolio correction, same as it would for any other mistake.
      //
      // The baseline is Cash's value AS OF this transaction's own date
      // (.lte("date", date), latest first) - never Cash's globally
      // latest row regardless of date. Real incident: entering a
      // transaction dated earlier than an already-existing later-dated
      // Cash row let two separate buys each read and decrement the SAME
      // credit, because ordering purely by calendar date (ignoring
      // whether that date is before or after THIS transaction's own
      // date) can surface a row that didn't exist yet at the real-world
      // moment being recorded. Same nearest-prior-observation rule
      // valueOfSecurityAsOf() (calculations.js) already uses everywhere
      // else in this app - applied here for the first time because this
      // is the one write path that reads a value before writing a new
      // one from it.
      if ((payload.type === "buy" || payload.type === "sell") && !editingTransactionId) {
        const cashSecurity = securitiesCache.find((s) => s.type === "Cash" && s.id !== securityId);
        if (cashSecurity) {
          const { data: cashVals, error: cashFetchError } = await window.db
            .from("valuations")
            .select("value_eur")
            .eq("portfolio_id", currentPortfolioId)
            .eq("security_id", cashSecurity.id)
            .lte("date", date)
            .order("date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(1);
          if (cashFetchError) throw cashFetchError;
          if (cashVals && cashVals.length) {
            const delta = payload.type === "buy" ? -Number(amount) : Number(amount);
            await recordValuations([{
              portfolio_id: currentPortfolioId,
              security_id: cashSecurity.id,
              date,
              value_eur: Math.round((cashVals[0].value_eur + delta) * 100) / 100,
              source: payload.type === "buy" ? "auto: reduced by buy" : "auto: increased by sell",
            }]);
          }
        }
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
