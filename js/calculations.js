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

/**
 * The single seam every performance calculation asks "what was security
 * X worth on date Y?" through - added when the old single-driver TWR
 * (js/analytics.js's twrDriver) was confirmed invalid the moment more
 * than one holding had real interim valuation history. `history` is
 * that security's own valuations array (any order, `{date, value_eur}`
 * shape) - never interpolated, never a future observation:
 *
 * - Nearest-PRIOR real observation only (inclusive of `date` itself,
 *   unless `exclusive` is set - see chainLinkedPortfolioReturn() below
 *   for why both variants exist: a cash-flow date needs both "value
 *   right before this flow" and "value right after it").
 * - A security with no observation on/before `date` contributes 0 - it
 *   simply wasn't part of the portfolio yet, not an error, not a guess.
 *
 * Deliberately source-agnostic: this reads `value_eur` from whatever
 * array it's handed, so once `daily_prices` resumes, a caller can build
 * that same `{date, value_eur}` shape from price × units-held and pass
 * it straight in - the lookup and the chain-linking below never need to
 * know which source answered "what was it worth". BPI Dinâmico (no
 * market price, ever) keeps using manual valuations indefinitely; nothing
 * about that requires special-casing here.
 *
 * Returns *position* value, not the security's own market price - see
 * docs/implementation-roadmap.md's Performance & Analytics Architecture
 * section for why those aren't the same question, and why they
 * currently happen to produce the same number for every holding here
 * (single-lot positions only, so far).
 */
function valueOfSecurityAsOf(history, date, { exclusive = false } = {}) {
  let best = null;
  for (const v of history) {
    const qualifies = exclusive ? v.date < date : v.date <= date;
    if (!qualifies) continue;
    if (best === null || v.date > best.date) best = v;
  }
  return best ? best.value_eur : 0;
}

/**
 * Portfolio-level chain-linked Time-Weighted Return - replaces the old
 * "longest-history holding drives the whole portfolio" simplification.
 * Never computes each security's own TWR and blends them; total
 * portfolio value at each checkpoint (the sum of valueOfSecurityAsOf()
 * across every holding) already embeds each holding's historical
 * weight, so there's no separate weight-reconstruction step.
 *
 * `cashFlowDates` = every date an EXTERNAL cash flow happened (money
 * entering/leaving the portfolio as a whole - today that means every
 * `buy`/`sell`/`deposit`/`withdrawal` transaction date, deduplicated).
 * KNOWN, DOCUMENTED LIMITATION: the schema has no flag distinguishing
 * "funded by new money" from "funded by selling something else first" -
 * every buy/sell is treated as external. Correct for the real data
 * today (zero sells on record), not correct in general once a rebalance
 * happens - flagging here rather than pretending the schema is more
 * sophisticated than it is.
 *
 * `asOfDate` is a plain read-point (today / latest known data), not
 * itself treated as a cash-flow boundary unless it genuinely coincides
 * with one.
 *
 * The inclusive/exclusive distinction at each boundary is what keeps a
 * new deposit from inflating the period that just ended: the period
 * ENDING at a cash-flow date reads that date EXCLUSIVE (value right
 * before the flow landed); the period STARTING there reads it INCLUSIVE
 * (value right after). Getting this backwards is the classic TWR bug -
 * see the Node-verified cross-checks in this feature's implementation
 * notes for why this specific ordering was chosen and confirmed correct
 * against a BPI-only reference calculation.
 */
function chainLinkedPortfolioReturn(securityHistories, cashFlowDates, asOfDate) {
  const allDates = [...new Set(cashFlowDates)].sort();
  if (!allDates.length) return { subPeriods: [], totalReturnPct: null };
  if (allDates[allDates.length - 1] !== asOfDate) allDates.push(asOfDate);

  const totalAt = (date, exclusive) =>
    Object.values(securityHistories).reduce((sum, h) => sum + valueOfSecurityAsOf(h, date, { exclusive }), 0);

  const subPeriods = [];
  for (let i = 0; i < allDates.length - 1; i++) {
    const startDate = allDates[i];
    const endDate = allDates[i + 1];
    const isEndACashFlow = endDate !== asOfDate;
    const startValue = totalAt(startDate, false);
    const endValue = totalAt(endDate, isEndACashFlow);
    const returnPct = startValue > 0 ? ((endValue / startValue) - 1) * 100 : null;
    subPeriods.push({ startDate, endDate, startValue, endValue, returnPct });
  }

  const totalReturnPct = subPeriods.length
    ? (subPeriods.reduce((prod, p) => prod * (p.returnPct == null ? 1 : 1 + p.returnPct / 100), 1) - 1) * 100
    : null;

  return { subPeriods, totalReturnPct: subPeriods.length ? Math.round(totalReturnPct * 100) / 100 : null };
}

/**
 * Calendar-year TWR breakdown - reuses chainLinkedPortfolioReturn()
 * per year rather than a second calculation method, per the "don't
 * rebuild analytics.js every time we add a metric" goal. Splitting the
 * since-inception chain at Dec-31/Jan-1 boundaries never changes the
 * total (Node-verified: product of every year's return here equals
 * chainLinkedPortfolioReturn()'s own since-inception total, because a
 * calendar-year edge is a plain read-point, not a cash flow).
 * `inceptionDate` = the earliest cash-flow date (portfolio's real
 * start), so the first "year" is a partial year from inception, and the
 * last is a partial year through `asOfDate`.
 */
function annualReturns(securityHistories, cashFlowDates, asOfDate, inceptionDate) {
  const startYear = Number(inceptionDate.slice(0, 4));
  const endYear = Number(asOfDate.slice(0, 4));
  const years = {};
  for (let y = startYear; y <= endYear; y++) {
    const rangeStart = y === startYear ? inceptionDate : `${y}-01-01`;
    const rangeEnd = y === endYear ? asOfDate : `${y}-12-31`;
    const flowsInRange = cashFlowDates.filter((d) => d > rangeStart && d <= rangeEnd);
    const checkpoints = [rangeStart, ...flowsInRange];
    const yearResult = chainLinkedPortfolioReturn(securityHistories, checkpoints, rangeEnd);
    // Was anything actually OBSERVED within this year (strictly after
    // rangeStart, on/before rangeEnd), for any holding? If not, a 0%
    // result here is an artifact of nearest-prior carrying the same
    // pre-year value all the way through a real data gap - not a claim
    // the portfolio genuinely didn't move that year. Distinguishing this
    // from a genuine 0% return is why this flag exists at all.
    const hasObservationInYear = Object.values(securityHistories).some((h) =>
      h.some((v) => v.date > rangeStart && v.date <= rangeEnd)
    );
    years[y] = { rangeStart, rangeEnd, returnPct: yearResult.totalReturnPct, hasObservationInYear };
  }
  return years;
}

window.costBasisFromTransactions = costBasisFromTransactions;
window.unrealisedPnL = unrealisedPnL;
window.costDrag = costDrag;
window.productScore = productScore;
window.valueOfSecurityAsOf = valueOfSecurityAsOf;
window.chainLinkedPortfolioReturn = chainLinkedPortfolioReturn;
window.annualReturns = annualReturns;
