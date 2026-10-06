/* ============================================================
   calendar.js - the Calendar page ("what happened in my portfolio, and
   when?"). Reads real Transactions/Valuations/Costs rows, normalizes
   them via calendar-events.js:buildCalendarEvents() (never a second
   event derivation here), and renders a hand-built monthly grid + a
   selected-day detail panel. A derived, chronological VIEW of data that
   already exists elsewhere - never a new source of truth (see
   calendar-events.js's own header comment).

   $()/ensurePortfolio()/loadAccountsForPortfolio() live in db.js.
   ============================================================ */

let currentPortfolioId = null;
let accountsCache = [];
let allEvents = [];
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
let selectedDate = new Date().toISOString().slice(0, 10);
let activeFilterKey = "all";
let activeAccountId = "all";
let signedIn = false;
let monthChecks = [];
let publicEventsByDate = new Map();

/** Event-type filter pills (design brief §8) - "Investments" folds
    deposit+withdrawal together (both are cash crossing the portfolio's
    own boundary, the same distinction Performance's own
    PORTFOLIO_EXTERNAL_CASH_FLOW_TYPES already draws); "Costs" folds
    real fee transactions together with cost-assumption rows (both are
    genuinely cost-shaped events, just from two different tables). No
    dedicated pill for 'split' - rare enough not to earn its own filter,
    still visible under "All". */
const CALENDAR_FILTERS = [
  { key: "all", label: "All", types: null },
  { key: "investments", label: "Investments", types: ["deposit", "withdrawal"] },
  { key: "buys", label: "Buys", types: ["buy"] },
  { key: "sells", label: "Sells", types: ["sell"] },
  { key: "valuations", label: "Valuations", types: ["valuation"] },
  { key: "costs", label: "Costs", types: ["fee", "cost-assumption"] },
  { key: "dividends", label: "Dividends", types: ["dividend"] },
];

const EVENT_TYPE_GROUP_LABEL = {
  buy: "Buy", sell: "Sell", dividend: "Dividend", split: "Split",
  fee: "Fee", deposit: "Investment", withdrawal: "Withdrawal",
  valuation: "Valuation", "cost-assumption": "Cost Assumption",
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad2(n) { return String(n).padStart(2, "0"); }
function isoDate(year, month, day) { return `${year}-${pad2(month + 1)}-${pad2(day)}`; }
function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
/** JS Date.getDay() is Sunday-first (0-6); this grid is Monday-first
    (design brief's own mockup) - shift so Monday = 0. */
function firstWeekdayMondayFirst(year, month) { return (new Date(year, month, 1).getDay() + 6) % 7; }

function formatLongDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/* ---------- Filtering ---------- */

function eventMatchesFilters(e) {
  const filter = CALENDAR_FILTERS.find((f) => f.key === activeFilterKey);
  if (filter?.types && !filter.types.includes(e.eventType)) return false;
  if (activeAccountId !== "all" && e.accountId !== activeAccountId) return false;
  return true;
}

function filteredEvents() {
  return allEvents.filter(eventMatchesFilters);
}

/* ---------- Today strip ---------- */

function renderTodayStrip(data) {
  const todayISO = new Date().toISOString().slice(0, 10);
  $("cal-today-date").textContent = formatLongDate(todayISO);
  if (!signedIn) {
    $("cal-today-value").innerHTML = lockedHTML({ variant: "inline" });
    $("cal-today-activity").innerHTML = lockedHTML({ variant: "inline" });
    return;
  }
  // Unfiltered on purpose - "today's activity" is a fact about the day,
  // not scoped to whichever filter pill happens to be active.
  const todayEvents = allEvents.filter((e) => e.date === todayISO);
  $("cal-today-value").textContent = data.analytics.performance.totalValue != null
    ? fmtEUR(data.analytics.performance.totalValue)
    : "—";
  $("cal-today-activity").textContent = todayEvents.length
    ? `${todayEvents.length} event${todayEvents.length === 1 ? "" : "s"}`
    : "No activity";
}

/* ---------- Monthly update check ----------
   The user records data once a month (holding values, BPI report). This
   strip answers "is this month done?" at a glance. Signed in it's
   per-holding (which ones are missing); signed out it's dates only -
   "was anything recorded this month" - from the public value history. */

function lastMonths(n) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    out.push({
      key: `${year}-${pad2(month + 1)}`, year, month,
      short: d.toLocaleDateString("en-GB", { month: "short" }),
      long: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

function computeMonthChecksSignedIn({ valuations, holdings, bpiMonths }) {
  const firstValuation = new Map();
  const updatedByMonth = new Map();
  for (const v of valuations) {
    if (!firstValuation.has(v.security_id) || v.date < firstValuation.get(v.security_id)) firstValuation.set(v.security_id, v.date);
    const key = v.date.slice(0, 7);
    if (!updatedByMonth.has(key)) updatedByMonth.set(key, new Set());
    updatedByMonth.get(key).add(v.security_id);
  }
  const firstKey = [...firstValuation.values()].map((d) => d.slice(0, 7)).sort()[0];
  const firstBpiKey = bpiMonths && bpiMonths.size ? [...bpiMonths].sort()[0] : null;
  const nowKey = new Date().toISOString().slice(0, 7);

  return lastMonths(12).filter((m) => firstKey && m.key >= firstKey).map((m) => {
    const expected = holdings.filter((h) => firstValuation.has(h.id) && firstValuation.get(h.id).slice(0, 7) <= m.key);
    const updated = updatedByMonth.get(m.key) || new Set();
    const missing = expected.filter((h) => !updated.has(h.id)).map((h) => h.name);
    const bpiExpected = firstBpiKey != null && m.key >= firstBpiKey;
    const bpiMissing = bpiExpected && !bpiMonths.has(m.key);
    const isCurrent = m.key === nowKey;
    const incomplete = missing.length > 0 || bpiMissing;
    const status = !expected.length ? "none" : !incomplete ? "ok" : isCurrent ? "pending" : "warn";
    return { ...m, status, expectedCount: expected.length, missing, bpiExpected, bpiMissing };
  });
}

function computeMonthChecksPublic(valueSeries) {
  const observed = new Set((valueSeries || []).map((p) => p.date.slice(0, 7)));
  const firstKey = [...observed].sort()[0];
  const nowKey = new Date().toISOString().slice(0, 7);
  return lastMonths(12).filter((m) => firstKey && m.key >= firstKey).map((m) => ({
    ...m,
    status: observed.has(m.key) ? "ok" : m.key === nowKey ? "pending" : "warn",
    missing: [], expectedCount: 0, bpiExpected: false, bpiMissing: false,
  }));
}

function monthCheckMessage(m) {
  if (!m) return "";
  const parts = [];
  if (signedIn) {
    if (m.status === "none") return `${m.long} - no holdings to update yet.`;
    if (m.missing.length) {
      const names = m.missing.length > 4 ? `${m.missing.slice(0, 4).join(", ")} +${m.missing.length - 4} more` : m.missing.join(", ");
      parts.push(`${m.expectedCount - m.missing.length} of ${m.expectedCount} holding values recorded - missing: ${names}.`);
    } else {
      parts.push(`All ${m.expectedCount} holding values recorded.`);
    }
    if (m.bpiMissing) parts.push("BPI monthly report not imported yet.");
    else if (m.bpiExpected) parts.push("BPI report imported.");
  } else {
    parts.push(m.status === "ok" ? "Portfolio data recorded for this month." : "No portfolio data recorded for this month yet.");
  }
  return `${m.long} - ${parts.join(" ")}`;
}

function renderMonthlyCheck() {
  const strip = $("cal-check-strip");
  const viewedKey = `${currentYear}-${pad2(currentMonth + 1)}`;
  strip.innerHTML = monthChecks.map((m) => `
    <button type="button" class="cal-check-chip is-${m.status}${m.key === viewedKey ? " is-viewed" : ""}" data-month="${m.key}" aria-label="${m.long}: ${m.status}">
      <span class="cal-check-month">${m.short}</span>
      <span class="cal-check-dot"></span>
    </button>`).join("");
  strip.querySelectorAll(".cal-check-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [y, mo] = btn.dataset.month.split("-").map(Number);
      currentYear = y; currentMonth = mo - 1;
      selectedDate = null;
      renderAll();
    });
  });

  const viewed = monthChecks.find((m) => m.key === viewedKey);
  const prevMonth = monthChecks.length >= 2 ? monthChecks[monthChecks.length - 2] : null;
  const alert = prevMonth && prevMonth.status === "warn" && prevMonth.key !== viewedKey
    ? `<p class="cal-check-alert">Heads up: ${monthCheckMessage(prevMonth)}</p>` : "";
  $("cal-check-message").innerHTML = alert + (viewed ? `<span class="cal-check-viewed is-${viewed.status}">${monthCheckMessage(viewed)}</span>` : "");
}

/* ---------- Filter pills ---------- */

function renderFilterPills() {
  const row = $("cal-filter-pills");
  row.innerHTML = CALENDAR_FILTERS.map((f) =>
    `<button class="filter-pill${f.key === activeFilterKey ? " active" : ""}" data-filter="${f.key}" type="button">${f.label}</button>`
  ).join("");
  row.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilterKey = btn.dataset.filter;
      row.querySelectorAll(".filter-pill").forEach((b) => b.classList.toggle("active", b === btn));
      renderAll();
    });
  });
}

function renderAccountPills() {
  const row = $("cal-account-pills");
  if (!accountsCache.length) { row.innerHTML = ""; return; }
  const options = [{ id: "all", name: "All accounts" }, ...accountsCache];
  row.innerHTML = options.map((a) =>
    `<button class="filter-pill${a.id === activeAccountId ? " active" : ""}" data-account="${a.id}" type="button">${a.name}</button>`
  ).join("");
  row.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeAccountId = btn.dataset.account;
      row.querySelectorAll(".filter-pill").forEach((b) => b.classList.toggle("active", b === btn));
      renderAll();
    });
  });
}

/* ---------- This month's entries ----------
   Everything recorded for the viewed month, in three plain groups:
   transactions (variable), value updates (the monthly input) and costs
   (fixed/recurring assumptions + fees). */

const ENTRY_GROUPS = [
  { key: "transactions", label: "Transactions", types: ["buy", "sell", "dividend", "deposit", "withdrawal", "split"] },
  { key: "values", label: "Value updates", types: ["valuation"] },
  { key: "costs", label: "Costs & fees", types: ["fee", "cost-assumption"] },
];
const ENTRY_ROW_CAP = 10;

function renderMonthEntries(monthEvents) {
  const label = new Date(currentYear, currentMonth, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  $("cal-entries-title").textContent = label;

  if (!signedIn) {
    $("cal-entries").innerHTML = lockedHTML({ hint: "Transactions, value updates and costs for each month." });
    return;
  }
  if (!monthEvents.length) {
    $("cal-entries").innerHTML = `<p class="cal-detail-empty">Nothing recorded for this month.</p>`;
    return;
  }
  $("cal-entries").innerHTML = ENTRY_GROUPS.map((g) => {
    const evs = monthEvents.filter((e) => g.types.includes(e.eventType)).sort((a, b) => a.date.localeCompare(b.date));
    if (!evs.length) return "";
    const shown = evs.slice(0, ENTRY_ROW_CAP);
    const rows = shown.map((e) => `
      <div class="cal-event-row">
        <span class="cal-event-date">${e.date.slice(8)} ${new Date(e.date + "T00:00:00").toLocaleDateString("en-GB", { month: "short" })}</span>
        <span class="cal-event-name">${EVENT_TYPE_GROUP_LABEL[e.eventType] ? EVENT_TYPE_GROUP_LABEL[e.eventType] + " · " : ""}${e.securityName || e.accountName || e.title}</span>
        <span class="cal-event-value">${e.amount != null ? (e.currency && e.currency !== "EUR" ? `${e.amount.toFixed(2)} ${e.currency}` : fmtEUR(e.amount)) : (e.description || "—")}</span>
      </div>`).join("");
    const more = evs.length > shown.length ? `<p class="cal-event-more">+ ${evs.length - shown.length} more</p>` : "";
    return `
      <div class="cal-event-group">
        <p class="cal-event-group-label">${g.label} <span class="cal-event-group-count">${evs.length}</span></p>
        ${rows}${more}
      </div>`;
  }).join("");
}

/* ---------- Calendar grid ---------- */

function renderMonthNav() {
  $("cal-month-label").textContent = new Date(currentYear, currentMonth, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function renderCalendarGrid(eventsByDate) {
  const grid = $("cal-grid");
  const firstWeekday = firstWeekdayMondayFirst(currentYear, currentMonth);
  const totalDays = daysInMonth(currentYear, currentMonth);
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevMonthDays = daysInMonth(prevYear, prevMonth);

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: prevMonthDays - firstWeekday + 1 + i, inMonth: false });
  for (let d = 1; d <= totalDays; d++) cells.push({ day: d, inMonth: true, dateISO: isoDate(currentYear, currentMonth, d) });
  let nextDay = 1;
  while (cells.length % 7 !== 0) cells.push({ day: nextDay++, inMonth: false });

  const todayISO = new Date().toISOString().slice(0, 10);

  const cellsHTML = cells.map((c) => {
    if (!c.inMonth) return `<div class="cal-cell cal-cell-outside"><span class="cal-cell-day">${c.day}</span></div>`;
    const dayEvents = eventsByDate.get(c.dateISO) || [];
    const cls = ["cal-cell"];
    if (c.dateISO === todayISO) cls.push("is-today");
    if (c.dateISO === selectedDate) cls.push("is-selected");
    if (dayEvents.length) cls.push("has-activity");
    const indicator = !dayEvents.length ? "" : dayEvents.length === 1
      ? `<span class="cal-cell-dot"></span>`
      : `<span class="cal-cell-count">${dayEvents.length}</span>`;
    return `
      <button type="button" class="${cls.join(" ")}" data-date="${c.dateISO}" aria-label="${c.dateISO}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""}">
        <span class="cal-cell-day">${c.day}</span>
        ${indicator}
      </button>`;
  }).join("");

  grid.innerHTML = `
    <div class="cal-weekdays">${WEEKDAY_LABELS.map((w) => `<span>${w}</span>`).join("")}</div>
    <div class="cal-cells">${cellsHTML}</div>`;

  grid.querySelectorAll(".cal-cell[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDate = btn.dataset.date;
      renderCalendarGrid(eventsByDate);
      renderSelectedDayPanel(eventsByDate);
    });
  });
}

/* ---------- Selected-day detail panel ---------- */

function renderSelectedDayPanel(eventsByDate) {
  const el = $("cal-day-detail");
  $("cal-detail-card").style.display = signedIn && selectedDate ? "" : "none";
  if (!signedIn || !selectedDate) { el.innerHTML = ""; return; }

  const dayEvents = eventsByDate.get(selectedDate) || [];
  const dateLabel = formatLongDate(selectedDate).toUpperCase();

  if (!dayEvents.length) {
    el.innerHTML = `
      <p class="cal-detail-date">${dateLabel}</p>
      <p class="cal-detail-empty">No portfolio activity recorded for this day.</p>`;
    return;
  }

  const groups = new Map();
  for (const e of dayEvents) {
    const list = groups.get(e.eventType) || [];
    list.push(e);
    groups.set(e.eventType, list);
  }

  const AMOUNT_TYPES = new Set(["buy", "sell", "deposit", "withdrawal", "dividend"]);
  const groupsHTML = [...groups.entries()].map(([type, evs]) => {
    const label = EVENT_TYPE_GROUP_LABEL[type] || type;
    const rows = evs.map((e) => `
      <div class="cal-event-row">
        <span class="cal-event-name">${e.securityName || e.accountName || e.title}</span>
        <span class="cal-event-value">${e.amount != null ? (e.currency && e.currency !== "EUR" ? `${e.amount.toFixed(2)} ${e.currency}` : fmtEUR(e.amount)) : (e.description || "—")}</span>
      </div>`).join("");
    const total = AMOUNT_TYPES.has(type) && evs.length > 1
      ? `<div class="cal-event-row cal-event-total">
           <span class="cal-event-name">Total ${type === "buy" ? "invested" : type === "sell" ? "sold" : ""}</span>
           <span class="cal-event-value">${fmtEUR(evs.reduce((s, e) => s + (e.amount || 0), 0))}</span>
         </div>`
      : "";
    return `
      <div class="cal-event-group">
        <p class="cal-event-group-label">${label}</p>
        ${rows}
        ${total}
      </div>`;
  }).join("");

  el.innerHTML = `<p class="cal-detail-date">${dateLabel}</p>${groupsHTML}`;
}

/* ---------- Orchestration ---------- */

function renderAll() {
  const events = signedIn ? filteredEvents() : [];
  const eventsByDate = signedIn ? groupCalendarEventsByDate(events) : publicEventsByDate;
  const monthPrefix = `${currentYear}-${pad2(currentMonth + 1)}`;
  const monthEvents = events.filter((e) => e.date.startsWith(monthPrefix));

  renderMonthNav();
  renderMonthlyCheck();
  renderMonthEntries(monthEvents);
  renderCalendarGrid(eventsByDate);
  renderSelectedDayPanel(eventsByDate);
}

function goToMonth(delta) {
  currentMonth += delta;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderAll();
}

function goToToday() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  selectedDate = now.toISOString().slice(0, 10);
  renderAll();
}

/* ---------- Page init ---------- */

async function loadCalendarPage() {
  const user = currentUser();
  signedIn = !!user;

  if (!window.db) {
    $("cal-entries").innerHTML = `<p class="costs-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    return;
  }

  $("cal-filters-card").style.display = signedIn ? "" : "none";

  if (!signedIn) {
    // Public shape only: which months/dates have a recorded observation
    // (dates are already public via the value-history chart - no
    // amounts, names or accounts).
    allEvents = [];
    const data = await getPortfolioDataAuto();
    setCurrentPortfolioData(data);
    const dates = (data.history.valueSeries || []).map((p) => p.date);
    publicEventsByDate = new Map(dates.map((d) => [d, [{ date: d }]]));
    monthChecks = computeMonthChecksPublic(data.history.valueSeries);
    renderTodayStrip(data);
    renderAll();
    return;
  }

  try {
    currentPortfolioId = await ensurePortfolio();
    accountsCache = await loadAccountsForPortfolio(currentPortfolioId);

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
    allEvents = buildCalendarEvents({ transactions: txnRes.data || [], valuations: valRes.data || [], costs: costRes.data || [] });

    // BPI monthly report presence, per month. Fails soft (null = row
    // simply isn't part of the check) so a missing/blocked table never
    // breaks the page.
    let bpiMonths = null;
    try {
      const months = lastMonths(12);
      const results = await Promise.all(months.map((m) => window.db.from("detailed_portfolio_holdings").select("report_date")
        .gte("report_date", isoDate(m.year, m.month, 1)).lte("report_date", isoDate(m.year, m.month, daysInMonth(m.year, m.month))).limit(1)));
      if (results.every((r) => !r.error)) {
        bpiMonths = new Set(months.filter((m, i) => results[i].data?.length).map((m) => m.key));
      }
    } catch (err) { /* optional signal */ }

    monthChecks = computeMonthChecksSignedIn({ valuations: valRes.data || [], holdings: data.portfolio.holdings, bpiMonths });

    renderFilterPills();
    renderAccountPills();
    renderTodayStrip(data);
    renderAll();
  } catch (err) {
    const missingColumn = /nav_embedded/i.test(err.message || "");
    $("cal-entries").innerHTML = `<p class="costs-error">${
      missingColumn
        ? "The costs table needs its nav_embedded column — run supabase/migrations/0030_seed_real_costs.sql in the Supabase SQL Editor first."
        : (err.message || "Failed to load the calendar.")
    }</p>`;
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Calendar",
    subtitle: "What happened in your portfolio, and when.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  $("cal-prev-btn").innerHTML = icon("chevronLeft");
  $("cal-next-btn").innerHTML = icon("chevronRight");
  $("cal-prev-btn").addEventListener("click", () => goToMonth(-1));
  $("cal-next-btn").addEventListener("click", () => goToMonth(1));
  $("cal-today-btn").addEventListener("click", () => goToToday());

  onAuthChange(() => loadCalendarPage());
  initAuth().then(loadCalendarPage);
}

document.addEventListener("DOMContentLoaded", init);
