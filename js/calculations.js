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

/**
 * Cost Drag - the cumulative lifetime impact of an annual fee, as a
 * percentage of what the investment would be worth with no fees at all.
 * A completely different number from the fee itself: a ~1-1.3% TER can
 * compound into a ~15-20% cost drag over a 25-30 year horizon, which is
 * where the "19-20%" figure this app used to state as a flat constant
 * actually comes from (docs/legacy-feature-inventory.md's Cost Engine
 * section). Never hardcode that figure - it depends on the product's
 * actual TER, the assumed gross return, and the chosen horizon, all
 * three of which vary by product and by investor.
 *
 * grossReturnPct/annualCostPct are annual percentages (e.g. 9 for 9%,
 * 1.2 for 1.2%) - matching security_details.assumed_gross_return_pct/
 * ter_pct. Returns null rather than 0 when the inputs can't produce a
 * meaningful answer (no horizon, no growth to drag against).
 */
function costDrag(grossReturnPct, annualCostPct, horizonYears) {
  if (!horizonYears || horizonYears <= 0) return null;
  if (grossReturnPct == null || annualCostPct == null) return null;

  const grossRate = grossReturnPct / 100;
  const netRate = (grossReturnPct - annualCostPct) / 100;
  const feeFreeWealth = Math.pow(1 + grossRate, horizonYears);
  const actualWealth = Math.pow(1 + netRate, horizonYears);
  if (feeFreeWealth <= 0) return null;

  const dragPct = ((feeFreeWealth - actualWealth) / feeFreeWealth) * 100;
  return Math.round(dragPct * 100) / 100;
}

/**
 * The 9-dimension Product Score - ported verbatim from the old
 * Portfol.io engine's productScores() (weights and thresholds
 * unchanged, not reinvented), per docs/legacy-feature-inventory.md's
 * "Product scoring (9-dimension)" row. Each dimension answers one
 * honest question about the product (cost, tax efficiency,
 * diversification, liquidity, transparency, scale, risk-adjusted
 * efficiency, risk, return) on a 0-100 scale; overall is their weighted
 * average, weights matching the original exactly (cost/return matter
 * most at 1.3x, scale matters least at 0.6x). A scoring model, not a
 * verdict - a low score on one dimension means "know this about it",
 * not "don't buy this" - Product Detail shows all nine, not just the
 * overall number.
 */
function clampScore(v) { return Math.max(0, Math.min(100, v)); }

/**
 * A dimension is null (not defaulted to 0) when its underlying field
 * genuinely isn't known - added after BPI Dinâmico surfaced a real bug:
 * the original ported formula defaulted a missing Sharpe/volatility/
 * return to 0, which silently turned "we don't know" into "the worst
 * possible score" for Efficiency/Return, and turned missing volatility
 * into a *perfect* 100 for Risk (0 volatility reads as "safest
 * possible" - backwards for "unknown"). tax/transparency keep the
 * original engine's own neutral-default behaviour (missing -> a middle
 * 50, not top or bottom) since that default was already deliberate
 * there, not a bug.
 */
function productScore(p) {
  const costs = p.ter_pct == null ? null : clampScore(100 - (p.ter_pct / 2.8) * 100);
  const tax = clampScore((p.tax_efficiency_score || 5) * 10);
  const div = p.holdings_count == null ? null : clampScore((Math.min(p.holdings_count, 1500) / 1500) * 55 + (1 - (p.concentration_top10 ?? 0.4)) * 45);
  const aum = p.aum_eur_millions;
  const liq = aum == null ? null : clampScore(aum >= 10000 ? 100 : aum >= 100 ? 70 : aum >= 30 ? 52 : 38);
  const transp = clampScore((p.transparency_score || 5) * 10);
  const scale = aum == null ? null : clampScore(aum >= 50000 ? 100 : aum >= 1000 ? 78 : aum >= 100 ? 55 : aum >= 30 ? 42 : 30);
  const effic = p.sharpe_ratio == null ? null : clampScore((p.sharpe_ratio / 0.7) * 100);
  const risk = (p.volatility_pct == null && p.max_drawdown_pct == null) ? null : clampScore(
    100 - (Math.max(0, (p.volatility_pct || 0) - 9) / (16 - 9)) * 45 - (Math.max(0, Math.abs(p.max_drawdown_pct || 0) - 20) / (45 - 20)) * 45
  );
  const returnInput = p.return_5y_pct ?? p.return_3y_pct ?? p.assumed_gross_return_pct;
  const ret = returnInput == null ? null : clampScore((returnInput / 14) * 100);

  const weights = { costs: 1.3, tax: 1.0, div: 1.1, liq: 0.7, transp: 0.8, scale: 0.6, effic: 1.2, risk: 1.0, ret: 1.3 };
  const dims = { costs, tax, div, liq, transp, scale, effic, risk, ret };
  const available = Object.entries(dims).filter(([, v]) => v != null);
  const overall = available.length
    ? Math.round(available.reduce((s, [k, v]) => s + v * weights[k], 0) / available.reduce((s, [k]) => s + weights[k], 0))
    : null;

  const round = (v) => (v == null ? null : Math.round(v));
  return {
    costs: round(costs), tax: round(tax), div: round(div), liq: round(liq),
    transp: round(transp), scale: round(scale), effic: round(effic), risk: round(risk),
    ret: round(ret), overall, dimensionsAvailable: available.length, dimensionsTotal: 9,
  };
}

window.costBasisFromTransactions = costBasisFromTransactions;
window.unrealisedPnL = unrealisedPnL;
window.costDrag = costDrag;
window.productScore = productScore;
