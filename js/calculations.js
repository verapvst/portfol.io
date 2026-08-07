/* ============================================================
   calculations.js - the shared calculation layer for anything derived
   from Transactions + Valuations. Loaded before repository.js and
   analytics.js so both the mock and the live Supabase path call the
   exact same functions - one formula lives here once; Portfolio Detail,
   Performance, Allocation and Risk read from it as they're built,
   nobody re-derives their own version of "what did this holding cost".
   Pure - no DOM, no Supabase calls - so the answer can never depend on
   which page happened to call it.
   ============================================================ */

/**
 * Remaining cost basis for one security, average-cost method. Generic
 * over any number of buys/sells, not a formula that assumes "only buys
 * exist" - so a future sell doesn't need this rewritten.
 *
 * No sells on record: cost basis is simply everything bought, units or
 * not - a fund subscription with no meaningful per-unit tracking (e.g.
 * BPI Dinâmico) still has a perfectly real cost basis this way, without
 * needing a unit count that was never recorded.
 *
 * Sells on record: needs units to know what fraction of the position
 * was sold at average cost. Returns null (not a guess) if that can't be
 * determined - matching this app's "verify, don't assume" data
 * discipline (see docs/migration-plan.md §1, Data vs. Intelligence).
 */
function costBasisFromTransactions(txns) {
  const buys = txns.filter((t) => t.type === "buy");
  const totalBuyAmount = Math.round(buys.reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100;
  const sells = txns.filter((t) => t.type === "sell");
  if (!sells.length) return totalBuyAmount || null;

  const totalBuyUnits = buys.reduce((s, t) => s + Number(t.units || 0), 0);
  if (!totalBuyUnits) return null;

  const avgCostPerUnit = totalBuyAmount / totalBuyUnits;
  const soldUnits = sells.reduce((s, t) => s + Number(t.units || 0), 0);
  const netUnits = totalBuyUnits - soldUnits;
  return Math.round(avgCostPerUnit * netUnits * 100) / 100;
}

/**
 * Unrealised P&L from a holding's current value and its cost basis -
 * the one place this subtraction happens, so a holdings table and its
 * drill-down drawer can never quietly disagree. Returns nulls (not
 * zeros) when cost basis is unknown - a real "we don't know" is never
 * displayed as a fabricated "no gain".
 */
function unrealisedPnL(value, costBasis) {
  if (costBasis == null) return { costBasis: null, pnl: null, pnlPct: null };
  const pnl = Math.round((value - costBasis) * 100) / 100;
  const pnlPct = costBasis ? Math.round((pnl / costBasis) * 10000) / 100 : null;
  return { costBasis, pnl, pnlPct };
}

window.costBasisFromTransactions = costBasisFromTransactions;
window.unrealisedPnL = unrealisedPnL;
