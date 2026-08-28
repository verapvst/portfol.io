/* ============================================================
   calendar-events.js - the Calendar Event Engine. Turns real
   Transactions/Valuations/Costs rows into one normalized, chronological
   list of Calendar Events - a DERIVED view, never a new source of
   truth. Pure: no DOM, no Supabase calls, so calendar.js only renders
   what this file computes, never recomputes it a second way.

   Every event traces back to one real row in an existing table -
   transactions, valuations, or costs (supabase/migrations/0001, 0002).
   Nothing invented, nothing interpolated: a valuation observation
   becomes a "valuation" event, never inferred as a trade just because
   the value changed; a cost row becomes a "cost-assumption" event
   (a rate becoming known/effective on that date), never presented as
   cash paid (see costs.js/calculations.js's own nav_embedded
   distinction, carried straight through here). If the underlying data
   doesn't have it, the calendar doesn't show it.

   Deliberately excludes benchmark_history (SPY/QQQ/SPX/NDX weekly
   observations) - those describe an INDEX, not something that
   happened IN this portfolio; including them would be exactly the
   "event for data that doesn't meaningfully represent a portfolio
   event" the product brief says to avoid.

   Event shape (deliberately lightweight, per the product brief's own
   schema sketch):
     { id, date, eventType, securityId, securityName, accountId,
       accountName, amount, quantity, currency, title, description,
       source }
   `title`/`description` are plain descriptive text, not pre-formatted
   € strings - calendar.js's own render layer decides currency
   formatting, so this file never needs a DOM-adjacent formatter
   dependency.
   ============================================================ */

const TXN_EVENT_LABEL = {
  buy: "Buy", sell: "Sell", dividend: "Dividend", split: "Split",
  fee: "Fee", deposit: "Deposit", withdrawal: "Withdrawal",
};

function calendarEventFromTransaction(t) {
  const securityName = t.securities?.name || null;
  const accountName = t.accounts?.name || null;
  const label = TXN_EVENT_LABEL[t.type] || t.type;
  const descParts = [];
  if (t.units != null) descParts.push(`${Number(t.units)} unit${Number(t.units) === 1 ? "" : "s"}`);
  if (t.notes) descParts.push(t.notes);

  return {
    id: `txn-${t.id}`,
    date: t.date,
    eventType: t.type, // 'buy' | 'sell' | 'dividend' | 'split' | 'fee' | 'deposit' | 'withdrawal'
    securityId: t.security_id || null,
    securityName,
    accountId: t.account_id || null,
    accountName,
    amount: t.amount != null ? Number(t.amount) : null,
    quantity: t.units != null ? Number(t.units) : null,
    currency: t.currency || "EUR",
    title: securityName ? `${label} ${securityName}` : `${label}${accountName ? ` · ${accountName}` : ""}`,
    description: descParts.join(" · "),
    source: t.source || null,
  };
}

function calendarEventFromValuation(v) {
  const securityName = v.securities?.name || null;
  return {
    id: `val-${v.id}`,
    date: v.date,
    eventType: "valuation",
    securityId: v.security_id || null,
    securityName,
    accountId: null,
    accountName: null,
    amount: v.value_eur != null ? Number(v.value_eur) : null,
    quantity: v.units != null ? Number(v.units) : null,
    currency: "EUR",
    title: securityName ? `Valuation · ${securityName}` : "Valuation",
    description: v.report_date && v.report_date !== v.date ? `as reported ${v.report_date}` : "",
    source: v.source || null,
  };
}

/** A cost-assumption event marks the date a rate BECAME known/effective
    (costs.date, this table's own effective-date model - see
    calculations.js's Costs Engine header comment) - never "money paid
    on this day". nav_embedded is carried through unchanged so
    calendar.js can label it consistently with how the Costs page
    itself already distinguishes embedded-in-NAV vs. real cash costs. */
function calendarEventFromCost(c) {
  const securityName = c.securities?.name || null;
  const accountName = c.accounts?.name || null;
  const valueLabel = c.unit === "%" ? `${Number(c.value).toFixed(2)}%` : `${Number(c.value).toFixed(2)} ${c.unit}`;
  return {
    id: `cost-${c.id}`,
    date: c.date,
    eventType: "cost-assumption",
    securityId: c.security_id || null,
    securityName,
    accountId: c.account_id || null,
    accountName,
    amount: c.unit !== "%" ? Number(c.value) : null,
    quantity: null,
    currency: c.unit !== "%" ? c.unit : null,
    title: securityName ? `Cost · ${securityName}` : accountName ? `Cost · ${accountName}` : `Cost · ${c.cost_name}`,
    description: `${c.cost_name} · ${valueLabel}${c.nav_embedded ? " (embedded)" : ""}`,
    source: c.source || null,
    navEmbedded: !!c.nav_embedded,
  };
}

/**
 * Builds the full chronological Calendar Event list from real,
 * already-fetched rows - transactions (non-voided, per calendar.js's own
 * query), valuations, costs, each already joined with securities(id,
 * name)/accounts(id, name) so this function never needs a second lookup
 * pass. Sorted oldest-first; calendar.js re-groups by day/month as
 * needed for the grid.
 */
function buildCalendarEvents({ transactions = [], valuations = [], costs = [] }) {
  const events = [
    ...transactions.map(calendarEventFromTransaction),
    ...valuations.map(calendarEventFromValuation),
    ...costs.map(calendarEventFromCost),
  ];
  events.sort((a, b) => a.date.localeCompare(b.date) || a.eventType.localeCompare(b.eventType));
  return events;
}

/** Groups an already-built event list by ISO date - the primitive both
    the month grid (which day has a dot) and the selected-day panel
    (which events to list) read from, so the two can never disagree
    about what happened on a given day. */
function groupCalendarEventsByDate(events) {
  const byDate = new Map();
  for (const e of events) {
    const list = byDate.get(e.date) || [];
    list.push(e);
    byDate.set(e.date, list);
  }
  return byDate;
}

window.buildCalendarEvents = buildCalendarEvents;
window.groupCalendarEventsByDate = groupCalendarEventsByDate;
