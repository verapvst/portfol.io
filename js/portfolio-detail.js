/* ============================================================
   portfolio-detail.js - the Portfolio Detail page ("what do I have?").
   Reads the exact same data.portfolio.holdings/accounts contract
   Overview's Top Holdings card reads (repository.js/analytics.js -
   getPortfolioDataAuto()) - this page is the full list that card is a
   preview of, never a second computation of it. Every euro figure goes
   through formatMoney() (shell.js) so Showcase/Private masking and this
   page's own column visibility stay driven by the same isOwnerMode(),
   not a page-local flag.
   ============================================================ */

function $(id) { return document.getElementById(id); }

let currentPortfolioId = null;

function accountName(data, accountId) {
  const acc = data.portfolio.accounts.find((a) => a.id === accountId);
  return acc ? acc.name : "—";
}

/** Avg. Cost / Unrealised P&L columns only render in Private mode - per
    docs/information-architecture.md's Portfolio Detail row ("Showcase =
    structure + %, no €/cost-basis"), this isn't a mask-in-place like
    formatMoney() elsewhere (a whole row of "······" repeated three
    times reads as noise, not privacy) - the columns themselves aren't
    there in Showcase. Weight/Account/Type are ratio/structural facts,
    shown either way. */
/** The Update action is a write capability, gated on being signed in
    (currentUser()) - NOT on isOwnerMode()/valuesVisible(). Layer 3 (the
    values-visibility toggle) is a display preference only, never a
    second write-permission layer - a signed-in user with values
    currently hidden can still record a real update, per shell.js's own
    isOwnerMode() comment. */
function holdingsDetailRowHTML(h, data, owner, signedIn) {
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
      <td>${accountName(data, h.accountId)}</td>
      <td>${h.weight.toFixed(2)}%</td>
      ${moneyCells}
      ${actionCell}
    </tr>`;
}

function renderHoldingsDetail(container, data) {
  const owner = isOwnerMode();
  const signedIn = !!currentUser();
  const holdings = [...data.portfolio.holdings].sort((a, b) => b.weight - a.weight);

  if (!holdings.length) {
    container.innerHTML = `<p class="holdings-detail-empty">No holdings on record yet.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-scroll">
      <table class="holdings-table holdings-detail-table${owner ? "" : " showcase"}">
        <thead>
          <tr>
            <th>Asset</th><th>Account</th><th>Weight</th>
            ${owner ? `<th>Market Value</th><th data-info="cost-basis" tabindex="0" role="button" aria-label="About this metric">Avg. Cost</th><th data-info="unrealised-pnl" tabindex="0" role="button" aria-label="About this metric">Unrealised P&amp;L</th>` : ""}
            ${signedIn ? `<th></th>` : ""}
          </tr>
        </thead>
        <tbody>${holdings.map((h) => holdingsDetailRowHTML(h, data, owner, signedIn)).join("")}</tbody>
      </table>
    </div>`;
}

function renderSummary(container, data) {
  const holdings = data.portfolio.holdings;
  const accountsCount = data.portfolio.accounts.length;
  const accountsLabel = `${accountsCount} account${accountsCount === 1 ? "" : "s"}`;
  container.textContent = isOwnerMode()
    ? `${holdings.length} holdings across ${accountsLabel} · ${fmtEUR(data.analytics.performance.totalValue)} total`
    : `${holdings.length} holdings across ${accountsLabel}`;
}

function renderAll(data) {
  renderSummary($("holdings-detail-summary"), data);
  renderHoldingsDetail($("holdings-detail-table"), data);
}

/* ---------- Holdings Update workflow ----------
   Replaces the "pick any security from a free-text list, fill
   everything in" pattern (js/valuations.js's Add Valuation modal) for
   the common case: updating a security you already hold. Security is
   fixed to the row you clicked - no picker, no findOrCreateSecurity(),
   no chance of attaching a new observation to the wrong similarly-named
   security (the exact risk that made "BPI Dinâmico" vs "BPI Smart
   Dinâmico PPR" confusing in the free-text datalist).

   "Update" is the label, not the behaviour - every submit is a plain
   INSERT into valuations (same insert-only discipline as
   js/valuations.js), never an UPDATE/overwrite of an existing row. Date
   defaults to today but stays fully editable specifically so a missed
   day can be backfilled (Update -> Date: 10 Aug, Update -> Date: 11 Aug,
   ...) without needing three different date pickers or a special
   "backdate" mode.

   "Current" is never "whichever row was inserted most recently" - every
   read of a holding's value already goes through analytics.js's
   history.sort()-then-take-last (chain-linked TWR, portfolio.holdings,
   valueOfSecurityAsOf() everywhere else), so a backdated insert here is
   automatically correctly ignored/ordered by every consumer without any
   change to this file - this workflow only needed to stop assuming
   "latest inserted", not fix it (it was already correct). */

/** Most recent real observation for this security, by DATE - not by
    insertion order - ties on the same date broken by created_at (the
    most recently entered correction wins as the prefill baseline). Used
    only to prefill the form with a sensible starting point; the row
    itself is never modified. */
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
      const payload = {
        portfolio_id: currentPortfolioId,
        security_id: securityId,
        date,
        value_eur: Number(value),
        units: $("hu-units").value === "" ? null : Number($("hu-units").value),
        source: $("hu-source").value.trim() || null,
      };
      const { error } = await window.db.from("valuations").insert(payload);
      if (error) throw error;

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

  // Prefill with the last known state, once it's back - the form is
  // already open and usable before this resolves (no blocking spinner
  // for what's just a convenience prefill, not a required read).
  try {
    const latest = await loadLatestValuation(securityId, currentPortfolioId);
    if (latest && root.dataset.securityId === securityId) {
      $("hu-value").value = latest.value_eur;
      if (latest.units != null) $("hu-units").value = latest.units;
      if (latest.source) $("hu-source").value = latest.source;
    }
  } catch (err) {
    // Prefill failing isn't fatal - the user can still type the value
    // in by hand, same as the pre-existing Add Valuation form always
    // required anyway.
  }
}

async function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  initDrillDown();
  initHoldingUpdateModal();

  renderTopbar($("topbar"), user, {
    heading: "Portfolio Detail",
    subtitle: "Every position you hold, right now.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  // Event delegation on the table container - rows are fully replaced on
  // every render (renderHoldingsDetail), so binding once here (rather
  // than per-row, per-render) avoids rebinding listeners on data that no
  // longer exists.
  $("holdings-detail-table").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-update-holding]");
    if (!btn) return;
    e.stopPropagation(); // don't also trigger the row's own drill-down click
    openHoldingUpdateModal(btn.dataset.updateHolding, btn.dataset.holdingName);
  });

  // Same live-with-mock-fallback seam as Overview (analytics.js's
  // getPortfolioDataAuto()) - re-fetches and redraws on every sign-in/
  // out, and hands the resolved data to setCurrentPortfolioData() so
  // this page's own drill-down drawers (holdingDrill in shell.js) read
  // the same object the table just rendered, never a second fetch.
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
