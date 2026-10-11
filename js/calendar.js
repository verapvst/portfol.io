/* ============================================================
   calendar.js - the Activity page ("what's been recorded, and what's
   still due?"). Two plain views, no calendar grid:

   1. Updates due - the monthly routine. Holding values are recorded
      once a month (due by VALUES_DUE_DAY of the following month); the
      BPI monthly report is due by BPI_REPORT_DUE_DAY. Anything missing
      shows red with a button to fix it right there.
   2. Recent activity - a newest-first feed of transactions, value
      updates and costs, from calendar-events.js (a derived view, never
      a second source of truth).

   Valuations are a TIME SERIES (every month matters). BPI reports are a
   SNAPSHOT of what each fund holds - only the most recent one is
   useful, so only the latest report is checked, never a history.

   $()/ensurePortfolio()/recordValuations() live in db.js.
   ============================================================ */

/* The established schedule - change these two numbers to change the routine. */
const VALUES_DUE_DAY = 5;      // month M's values are due by the 5th of M+1
const BPI_REPORT_DUE_DAY = 10; // the BPI monthly report is due by the 10th

const MONTHS_SHOWN = 6;
const FEED_PAGE = 15;

let currentPortfolioId = null;
let signedIn = false;
let valuationRows = [];
let heldSecurities = [];
let allEvents = [];
let latestBpiReportDate = null;
let bpiChecked = false;
let showAllMonths = false;
let feedFilterKey = "all";
let feedLimit = FEED_PAGE;

const FEED_FILTERS = [
  { key: "all", label: "All", types: null },
  { key: "transactions", label: "Transactions", types: ["buy", "sell", "dividend", "deposit", "withdrawal", "split"] },
  { key: "values", label: "Values", types: ["valuation"] },
  { key: "costs", label: "Costs", types: ["fee", "cost-assumption"] },
];

const EVENT_TYPE_LABEL = {
  buy: "Buy", sell: "Sell", dividend: "Dividend", split: "Split",
  fee: "Fee", deposit: "Deposit", withdrawal: "Withdrawal",
  valuation: "Value", "cost-assumption": "Cost",
};

/* ---------- Date helpers ---------- */

function pad2(n) { return String(n).padStart(2, "0"); }
function isoDate(year, month, day) { return `${year}-${pad2(month + 1)}-${pad2(day)}`; }
function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function todayISO() { const d = new Date(); return isoDate(d.getFullYear(), d.getMonth(), d.getDate()); }
function longMonth(year, month) { return new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
function shortDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Completed months, newest first, ending with last month. */
function completedMonths(count) {
  const now = new Date();
  const out = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth(), key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` });
  }
  return out;
}

/** dueDay of the month AFTER (year, month). */
function dueDateFor(year, month, dueDay) {
  const next = new Date(year, month + 1, 1);
  return isoDate(next.getFullYear(), next.getMonth(), dueDay);
}

function dueStatus(dueISO) {
  return todayISO() > dueISO ? "overdue" : "due";
}

/* ---------- Monthly values check ---------- */

function computeValueChecks() {
  const firstValuation = new Map();
  const updatedByMonth = new Map();
  for (const v of valuationRows) {
    if (!firstValuation.has(v.security_id) || v.date < firstValuation.get(v.security_id)) firstValuation.set(v.security_id, v.date);
    const key = v.date.slice(0, 7);
    if (!updatedByMonth.has(key)) updatedByMonth.set(key, new Set());
    updatedByMonth.get(key).add(v.security_id);
  }
  const firstKey = [...firstValuation.values()].map((d) => d.slice(0, 7)).sort()[0];
  if (!firstKey) return [];

  const totalMonths = (() => {
    const now = new Date();
    const [fy, fm] = firstKey.split("-").map(Number);
    return (now.getFullYear() - fy) * 12 + (now.getMonth() + 1 - fm);
  })();

  return completedMonths(Math.max(0, totalMonths)).filter((m) => m.key >= firstKey).map((m) => {
    const expected = heldSecurities.filter((h) => firstValuation.has(h.id) && firstValuation.get(h.id).slice(0, 7) <= m.key);
    const updated = updatedByMonth.get(m.key) || new Set();
    const missing = expected.filter((h) => !updated.has(h.id));
    const dueISO = dueDateFor(m.year, m.month, VALUES_DUE_DAY);
    return {
      ...m, label: longMonth(m.year, m.month), dueISO,
      expectedCount: expected.length, missing,
      status: !expected.length ? "none" : !missing.length ? "done" : dueStatus(dueISO),
    };
  }).filter((m) => m.status !== "none");
}

function lastValuationFor(securityId) {
  let best = null;
  for (const v of valuationRows) {
    if (v.security_id !== securityId) continue;
    if (!best || v.date > best.date) best = v;
  }
  return best;
}

/* ---------- Render: updates due ---------- */

function statusPill(status, dueISO) {
  if (status === "done") return `<span class="act-pill is-done">Done</span>`;
  if (status === "overdue") return `<span class="act-pill is-overdue">Overdue · was due ${shortDate(dueISO)}</span>`;
  return `<span class="act-pill is-due">Due by ${shortDate(dueISO)}</span>`;
}

function bpiRowHTML() {
  if (!bpiChecked) return "";
  const last = new Date();
  const prev = new Date(last.getFullYear(), last.getMonth() - 1, 1);
  const prevStart = isoDate(prev.getFullYear(), prev.getMonth(), 1);
  const dueISO = dueDateFor(prev.getFullYear(), prev.getMonth(), BPI_REPORT_DUE_DAY);
  const upToDate = latestBpiReportDate && latestBpiReportDate >= prevStart;
  const status = upToDate ? "done" : dueStatus(dueISO);
  const detail = latestBpiReportDate
    ? `Latest on file: ${shortDate(latestBpiReportDate)}`
    : "No report on file yet";
  return `
    <div class="act-item${status === "done" ? "" : " needs-action"}">
      <div class="act-item-main">
        <p class="act-item-title">BPI monthly report</p>
        <p class="act-item-sub">${detail}. Only the latest report matters: it's a snapshot of what each fund holds today.</p>
      </div>
      <div class="act-item-side">
        ${statusPill(status, dueISO)}
        ${status === "done" ? "" : `<a class="act-btn" href="data-hub.html#import-card">Upload report</a>`}
      </div>
    </div>`;
}

function monthRowHTML(m) {
  if (m.status === "done") {
    return `
      <div class="act-item">
        <div class="act-item-main">
          <p class="act-item-title">${m.label}</p>
          <p class="act-item-sub">All ${m.expectedCount} holding values recorded.</p>
        </div>
        <div class="act-item-side">${statusPill("done", m.dueISO)}</div>
      </div>`;
  }
  const missingRows = m.missing.map((h) => `
      <div class="act-missing-row">
        <span class="act-missing-name">${escapeHTML(h.name)}</span>
        <button type="button" class="act-btn" data-add-value="${h.id}" data-month="${m.key}">Add value</button>
      </div>`).join("");
  return `
    <div class="act-item needs-action">
      <div class="act-item-main">
        <p class="act-item-title">${m.label}</p>
        <p class="act-item-sub">${m.expectedCount - m.missing.length} of ${m.expectedCount} holding values recorded.</p>
        <div class="act-missing">${missingRows}</div>
      </div>
      <div class="act-item-side">${statusPill(m.status, m.dueISO)}</div>
    </div>`;
}

function renderDue() {
  const checks = computeValueChecks();
  const shown = showAllMonths ? checks : checks.slice(0, MONTHS_SHOWN);
  const openCount = checks.filter((m) => m.status !== "done").length;

  $("act-due-hint").textContent =
    `Values are recorded monthly, due by the ${VALUES_DUE_DAY}th of the next month. The BPI report is due by the ${BPI_REPORT_DUE_DAY}th.`;

  const body = [
    bpiRowHTML(),
    shown.map(monthRowHTML).join(""),
    checks.length > MONTHS_SHOWN
      ? `<button type="button" class="act-more" id="act-toggle-months">${showAllMonths ? "Show fewer months" : `Show earlier months (${checks.length - MONTHS_SHOWN})`}</button>`
      : "",
  ].join("");

  $("act-due-body").innerHTML = body || `<p class="act-empty">Nothing to track yet.</p>`;
  $("act-due-badge").textContent = openCount ? `${openCount} month${openCount === 1 ? "" : "s"} to update` : "All up to date";
  $("act-due-badge").className = `act-badge ${openCount ? "is-overdue" : "is-done"}`;

  $("act-due-body").querySelectorAll("[data-add-value]").forEach((btn) => {
    btn.addEventListener("click", () => openValueModal(btn.dataset.addValue, btn.dataset.month));
  });
  const toggle = $("act-toggle-months");
  if (toggle) toggle.addEventListener("click", () => { showAllMonths = !showAllMonths; renderDue(); });
}

/* ---------- Render: activity feed ---------- */

function renderFeedFilters() {
  const row = $("act-feed-pills");
  row.innerHTML = FEED_FILTERS.map((f) =>
    `<button class="filter-pill${f.key === feedFilterKey ? " active" : ""}" data-filter="${f.key}" type="button">${f.label}</button>`
  ).join("");
  row.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      feedFilterKey = btn.dataset.filter;
      feedLimit = FEED_PAGE;
      renderFeedFilters();
      renderFeed();
    });
  });
}

function eventAmountText(e) {
  if (e.amount == null) return e.description || "";
  return e.currency && e.currency !== "EUR" ? `${e.amount.toFixed(2)} ${e.currency}` : fmtEUR(e.amount);
}

function renderFeed() {
  const filter = FEED_FILTERS.find((f) => f.key === feedFilterKey);
  const events = allEvents
    .filter((e) => !filter.types || filter.types.includes(e.eventType))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!events.length) { $("act-feed").innerHTML = `<p class="act-empty">Nothing recorded yet.</p>`; return; }

  const shown = events.slice(0, feedLimit);
  let lastMonth = "";
  const html = shown.map((e) => {
    const monthKey = e.date.slice(0, 7);
    const heading = monthKey !== lastMonth
      ? `<p class="act-feed-month">${longMonth(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1)}</p>` : "";
    lastMonth = monthKey;
    return `${heading}
      <div class="act-feed-row">
        <span class="act-feed-date">${new Date(`${e.date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
        <span class="act-feed-type type-${e.eventType}">${EVENT_TYPE_LABEL[e.eventType] || e.eventType}</span>
        <span class="act-feed-name">${escapeHTML(e.securityName || e.accountName || e.title)}</span>
        <span class="act-feed-amount">${escapeHTML(eventAmountText(e))}</span>
      </div>`;
  }).join("");

  $("act-feed").innerHTML = html + (events.length > shown.length
    ? `<button type="button" class="act-more" id="act-feed-more">Show more (${events.length - shown.length} older)</button>` : "");
  const more = $("act-feed-more");
  if (more) more.addEventListener("click", () => { feedLimit += FEED_PAGE; renderFeed(); });
}

/* ---------- Add-value modal ---------- */

function initValueModal() {
  if ($("act-modal-root")) return;
  const root = document.createElement("div");
  root.id = "act-modal-root";
  root.innerHTML = `
    <div id="act-modal-backdrop"></div>
    <div id="act-modal" class="glass" role="dialog" aria-modal="true" aria-label="Add value">
      <h2 class="owner-modal-title">Add value</h2>
      <div class="act-modal-context glass-quiet">
        <span class="act-modal-name" id="act-modal-name"></span>
        <span class="act-modal-hint" id="act-modal-hint"></span>
      </div>
      <div class="act-form-field"><label for="act-date">Date</label><input id="act-date" type="date" /></div>
      <div class="act-form-field"><label for="act-value">Value (EUR)</label><input id="act-value" type="number" step="any" inputmode="decimal" /></div>
      <div class="act-form-field"><label for="act-units">Units (optional)</label><input id="act-units" type="number" step="any" inputmode="decimal" /></div>
      <p class="act-form-error" id="act-form-error"></p>
      <div class="act-form-actions">
        <button type="button" class="act-form-cancel" id="act-form-cancel">Cancel</button>
        <button type="button" class="act-form-submit" id="act-form-submit">Save value</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const close = () => { root.classList.remove("open"); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  root._close = close;
  root._onKey = onKey;
  root.querySelector("#act-modal-backdrop").addEventListener("click", close);
  root.querySelector("#act-form-cancel").addEventListener("click", close);

  root.querySelector("#act-form-submit").addEventListener("click", async () => {
    const errorEl = $("act-form-error");
    const btn = $("act-form-submit");
    errorEl.textContent = "";
    const date = $("act-date").value;
    const value = $("act-value").value;
    if (!date) { errorEl.textContent = "Date is required."; return; }
    if (value === "" || Number(value) < 0) { errorEl.textContent = "Enter the value in EUR."; return; }

    btn.disabled = true;
    try {
      await recordValuations([{
        portfolio_id: currentPortfolioId,
        security_id: root.dataset.securityId,
        date,
        value_eur: Number(value),
        units: $("act-units").value === "" ? null : Number($("act-units").value),
        source: "Manual (Activity page)",
      }]);
      close();
      await loadActivityPage();
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    btn.disabled = false;
  });
}

function openValueModal(securityId, monthKey) {
  const root = $("act-modal-root");
  const security = heldSecurities.find((h) => h.id === securityId);
  if (!security) return;
  const [y, m] = monthKey.split("-").map(Number);
  // Month-end: the value is "as of" the end of the month being filled in.
  const defaultDate = isoDate(y, m - 1, daysInMonth(y, m - 1));

  root.dataset.securityId = securityId;
  $("act-modal-name").textContent = security.name;
  const last = lastValuationFor(securityId);
  $("act-modal-hint").textContent = last
    ? `Last recorded: ${fmtEUR(last.value_eur)} on ${shortDate(last.date)}. Adds a new dated value, never overwrites.`
    : "Adds a new dated value, never overwrites.";
  $("act-date").value = defaultDate;
  $("act-value").value = "";
  $("act-units").value = "";
  $("act-form-error").textContent = "";

  root.classList.add("open");
  document.addEventListener("keydown", root._onKey);
  setTimeout(() => $("act-value").focus(), 50);
}

/* ---------- Signed out: the structure, never the data ---------- */

function renderPublic(data) {
  $("act-due-hint").textContent = "Has each month's portfolio data been recorded?";
  const observed = new Set((data.history.valueSeries || []).map((p) => p.date.slice(0, 7)));
  const firstKey = [...observed].sort()[0];
  const months = firstKey ? completedMonths(12).filter((m) => m.key >= firstKey).reverse() : [];
  const missing = months.filter((m) => !observed.has(m.key));

  $("act-due-badge").textContent = missing.length ? `${missing.length} month${missing.length === 1 ? "" : "s"} missing` : "All up to date";
  $("act-due-badge").className = `act-badge ${missing.length ? "is-overdue" : "is-done"}`;

  $("act-due-body").innerHTML = `
    <div class="act-strip">${months.map((m) => `
      <span class="act-chip ${observed.has(m.key) ? "is-done" : "is-overdue"}">
        <span class="act-chip-month">${new Date(m.year, m.month, 1).toLocaleDateString("en-GB", { month: "short" })}</span>
        <span class="act-chip-dot"></span>
      </span>`).join("")}</div>
    <p class="act-empty">Each month, I record what every holding is worth and upload the BPI report. A red dot means a month hasn't been recorded yet.</p>`;

  $("act-feed-pills").innerHTML = "";
  $("act-feed").innerHTML = lockedHTML({ hint: "Transactions, value updates and costs, newest first." });
}

/* ---------- Page init ---------- */

async function loadActivityPage() {
  signedIn = !!currentUser();

  if (!window.db) {
    $("act-due-body").innerHTML = `<p class="costs-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    return;
  }

  if (!signedIn) {
    const data = await getPortfolioDataAuto();
    setCurrentPortfolioData(data);
    renderPublic(data);
    return;
  }

  try {
    currentPortfolioId = await ensurePortfolio();
    const [txnRes, valRes, costRes, data] = await Promise.all([
      window.db.from("transactions").select("*, accounts(id, name), securities(id, name)").eq("portfolio_id", currentPortfolioId).eq("voided", false).order("date", { ascending: true }),
      window.db.from("valuations").select("*, securities(id, name)").eq("portfolio_id", currentPortfolioId).order("date", { ascending: true }),
      window.db.from("costs").select("*, securities(id, name), accounts(id, name)").eq("portfolio_id", currentPortfolioId).order("date", { ascending: true }),
      getPortfolioDataAuto(),
    ]);
    if (txnRes.error) throw txnRes.error;
    if (valRes.error) throw valRes.error;
    if (costRes.error) throw costRes.error;

    setCurrentPortfolioData(data);
    valuationRows = valRes.data || [];
    heldSecurities = data.portfolio.holdings.filter((h) => h.type !== "Cash").map((h) => ({ id: h.id, name: h.name }));
    allEvents = buildCalendarEvents({ transactions: txnRes.data || [], valuations: valuationRows, costs: costRes.data || [] });

    // Latest BPI report on file (a snapshot - only the newest matters).
    // Fails soft: if the table can't be read, the BPI row is just hidden.
    try {
      const { data: latest, error } = await window.db.from("detailed_portfolio_holdings")
        .select("report_date").order("report_date", { ascending: false }).limit(1);
      if (!error) { latestBpiReportDate = latest?.[0]?.report_date || null; bpiChecked = true; }
    } catch (err) { /* optional signal */ }

    renderDue();
    renderFeedFilters();
    renderFeed();
  } catch (err) {
    const missingColumn = /nav_embedded/i.test(err.message || "");
    $("act-due-body").innerHTML = `<p class="costs-error">${
      missingColumn
        ? "The costs table needs its nav_embedded column — run supabase/migrations/0030_seed_real_costs.sql in the Supabase SQL Editor first."
        : escapeHTML(err.message || "Failed to load.")
    }</p>`;
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Activity",
    subtitle: "What's been recorded, and what's still due.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));
  initValueModal();

  onAuthChange(() => loadActivityPage());
  initAuth().then(loadActivityPage);
}

document.addEventListener("DOMContentLoaded", init);
