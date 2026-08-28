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
  // Unfiltered on purpose - "today's activity" is a fact about the day,
  // not scoped to whichever filter pill happens to be active.
  const todayEvents = allEvents.filter((e) => e.date === todayISO);
  $("cal-today-date").textContent = formatLongDate(todayISO);
  $("cal-today-value").textContent = data.analytics.performance.totalValue != null
    ? fmtEUR(data.analytics.performance.totalValue)
    : "—";
  $("cal-today-activity").textContent = todayEvents.length
    ? `${todayEvents.length} event${todayEvents.length === 1 ? "" : "s"}`
    : "No activity";
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

/* ---------- Monthly summary ---------- */

function renderMonthlySummary(monthEvents) {
  const invested = monthEvents.filter((e) => e.eventType === "deposit").reduce((s, e) => s + (e.amount || 0), 0);
  const buys = monthEvents.filter((e) => e.eventType === "buy");
  const buysTotal = buys.reduce((s, e) => s + (e.amount || 0), 0);
  const sells = monthEvents.filter((e) => e.eventType === "sell").length;
  const costs = monthEvents.filter((e) => e.eventType === "fee" || e.eventType === "cost-assumption").length;
  const valuations = monthEvents.filter((e) => e.eventType === "valuation").length;

  const tiles = [
    { label: "Invested", value: invested ? fmtEUR(invested) : "—" },
    { label: "Buys", value: buys.length ? `${buys.length} · ${fmtEUR(buysTotal)}` : "0" },
    { label: "Sells", value: String(sells) },
    { label: "Costs", value: String(costs) },
    { label: "Valuations", value: String(valuations) },
  ];
  $("cal-summary-row").innerHTML = tiles.map((t) => `
    <div class="cal-summary-tile">
      <span class="cal-summary-label">${t.label}</span>
      <span class="cal-summary-value">${t.value}</span>
    </div>`).join("");
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
  if (!selectedDate) { el.innerHTML = ""; return; }

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
  const events = filteredEvents();
  const eventsByDate = groupCalendarEventsByDate(events);
  const monthPrefix = `${currentYear}-${pad2(currentMonth + 1)}`;
  const monthEvents = events.filter((e) => e.date.startsWith(monthPrefix));

  renderMonthNav();
  renderMonthlySummary(monthEvents);
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

function renderSignedOutState() {
  $("cal-signedin").hidden = true;
  $("cal-signedout-slot").innerHTML = `
    <section class="card glass" id="cal-signedout-card">
      <h2 class="section-title">Calendar</h2>
      <div class="costs-signin-note">
        Sign in to see your portfolio's activity calendar.
        <br/>
        <button type="button" id="cal-signin-cta">Sign In</button>
      </div>
    </section>`;
  $("cal-signin-cta").addEventListener("click", () => window.openAuthModal());
}

async function loadCalendarPage() {
  const user = currentUser();

  if (!window.db) {
    $("cal-signedin").hidden = true;
    $("cal-signedout-slot").innerHTML = `<p class="costs-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    return;
  }
  if (!user) { renderSignedOutState(); return; }

  $("cal-signedout-slot").innerHTML = "";
  $("cal-signedin").hidden = false;

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

    renderFilterPills();
    renderAccountPills();
    renderTodayStrip(data);
    renderAll();
  } catch (err) {
    const missingColumn = /nav_embedded/i.test(err.message || "");
    $("cal-signedin").innerHTML = `<p class="costs-error">${
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
