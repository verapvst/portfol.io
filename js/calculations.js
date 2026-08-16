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
 * Rebases a value series to the first point = 100, preserving the
 * curve's shape while discarding the absolute scale. Originally a
 * shell.js chart-scale helper for Showcase mode; promoted here because
 * the Performance & Benchmark Engine needs the exact same rebase-to-100
 * logic for BOTH the portfolio's own series and a benchmark's series -
 * one normalization function, not two that could quietly drift apart.
 * Carries `real` through the rebase so the observed-vs-derived
 * distinction survives normalization, not just a rescaled line with the
 * honesty flag silently dropped.
 */
function indexValueSeries(series) {
  const base = series[0]?.value || 1;
  return series.map((p) => ({ date: p.date, value: (p.value / base) * 100, real: p.real }));
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

/* ============================================================
   Cash-flow-neutral performance engine (Performance & Benchmark Engine
   plan, section C) - EXTENDS the chain-linking above, doesn't replace
   it. chainLinkedPortfolioReturn() is left untouched deliberately: it
   was traced against a real edge case (a cash flow landing on a date
   with NO valuation observation at all) and found to misattribute the
   cash flow as return in that case - not a hypothetical, the plan
   doc's own worked example reproduces it (+52.9% instead of the true
   +5.28%). Rather than silently rewrite a working, tested function
   (mock/live/public paths all depend on its exact behaviour today),
   the fix lives in a new set of functions; callers migrate to them
   explicitly (Phase 3 of the plan) rather than inheriting a behaviour
   change through a same-named wrapper.
   ============================================================ */

/**
 * Modified Dietz return for one interval that may contain external cash
 * flows - the standard method for isolating investment return from cash
 * flows when you don't have a valuation observation exactly at the flow
 * date (the normal case: Vera records valuations on her own schedule,
 * not the day money moves). Each cash flow is weighted by how much of
 * the interval it was actually present for - a flow on the interval's
 * last day gets weight ~0 (no time to earn anything), a flow on day one
 * gets weight ~1 (present the whole time). Reduces to the plain
 * (endValue/startValue - 1) ratio whenever cashFlows is empty, so this
 * is a strict superset of a simple return, not a competing formula.
 *
 * cashFlows: [{date, amount}], positive = money added to this scope,
 * negative = money removed. startDate/endDate: 'YYYY-MM-DD'.
 *
 * Returns null (not 0 or a wild number) when the denominator collapses
 * to <= 0 - e.g. a withdrawal at least as large as the starting value -
 * the standard Modified Dietz failure mode, never disguised as a real
 * return percentage.
 */
function modifiedDietzReturn(startValue, endValue, cashFlows, startDate, endDate) {
  const totalDays = daysBetweenDates(startDate, endDate);
  if (totalDays <= 0) return null;
  const netCashFlow = cashFlows.reduce((s, cf) => s + cf.amount, 0);
  const weightedCashFlow = cashFlows.reduce((s, cf) => {
    const daysRemaining = daysBetweenDates(cf.date, endDate);
    const weight = Math.max(0, Math.min(1, daysRemaining / totalDays));
    return s + cf.amount * weight;
  }, 0);
  const denominator = startValue + weightedCashFlow;
  if (denominator <= 0) return null;
  return ((endValue - startValue - netCashFlow) / denominator) * 100;
}

/**
 * Generalized chain-linked return. Boundaries are REAL VALUATION
 * OBSERVATION DATES ONLY (plus asOfDate as a final read-point) - never
 * a cash-flow date with nothing observed there. This is the key
 * difference from chainLinkedPortfolioReturn() above, and the reason
 * this version handles irregular observations correctly: a cash flow
 * that lands between two observations doesn't fracture the timeline
 * into a boundary with no real value to anchor it - it's simply an
 * input to modifiedDietzReturn() for whichever observation-to-
 * observation interval it happens to fall inside. Every boundary here
 * is a genuine observed value, so there's no exclusive/inclusive
 * before/after trick to get right (unlike the original function) - a
 * cash flow landing exactly on an observation date is still handled
 * correctly because its Modified Dietz weight naturally goes to ~0 or
 * ~1 depending on which end of the interval it lands on.
 *
 * securityHistories: {securityId: [{date, value_eur}]} for every
 *   security in scope (caller filters - see scopedPerformance()).
 * cashFlows: [{date, amount}], signed as in modifiedDietzReturn().
 * observationDates: every date treated as a valuation checkpoint for
 *   this scope (caller builds this from the same securities it passed
 *   in securityHistories).
 * asOfDate: latest read-point: 'today' / latest known data.
 *
 * A cash flow dated before the first observation in scope is silently
 * outside every sub-period (there's no valuation to attribute it
 * against) - consistent with this app's "no fabrication before real
 * data exists" discipline elsewhere.
 */
function chainLinkedReturn(securityHistories, cashFlows, observationDates, asOfDate) {
  const allDates = [...new Set(observationDates)].sort();
  if (allDates.length && allDates[allDates.length - 1] !== asOfDate) allDates.push(asOfDate);
  if (!allDates.length) return { subPeriods: [], totalReturnPct: null };

  const observationSet = new Set(observationDates);
  const totalAt = (date) =>
    Object.values(securityHistories).reduce((sum, h) => sum + valueOfSecurityAsOf(h, date), 0);

  const subPeriods = [];
  for (let i = 0; i < allDates.length - 1; i++) {
    const startDate = allDates[i];
    const endDate = allDates[i + 1];
    const startValue = totalAt(startDate);
    const endValue = totalAt(endDate);
    const flowsInPeriod = cashFlows.filter((cf) => cf.date > startDate && cf.date <= endDate);
    const returnPct = startValue > 0
      ? modifiedDietzReturn(startValue, endValue, flowsInPeriod, startDate, endDate)
      : null;
    subPeriods.push({
      startDate, endDate, startValue, endValue, cashFlows: flowsInPeriod, returnPct,
      endIsObservation: observationSet.has(endDate),
    });
  }

  const totalReturnPct = subPeriods.length
    ? (subPeriods.reduce((prod, p) => prod * (p.returnPct == null ? 1 : 1 + p.returnPct / 100), 1) - 1) * 100
    : null;

  return { subPeriods, totalReturnPct: subPeriods.length ? Math.round(totalReturnPct * 100) / 100 : null };
}

/**
 * Smoothed DAILY index series for charting only - never a stored fact,
 * never a claim about what a valuation "really" was on an unobserved
 * day. Spreads each sub-period's already-real compounded return evenly
 * across its elapsed calendar days (geometric daily-equivalent rate) so
 * a chart can draw a smooth line between real observations instead of a
 * step function. Every day is flagged `real` - true only on genuine
 * observation dates (charts.js already renders real:false stretches as
 * a dashed segment, same convention the mock data uses today). This is
 * the plan doc's "Derived normalized performance observation" - always
 * kept distinguishable from an actual "Observed valuation".
 */
function deriveNormalizedDailySeries(subPeriods, { base = 100 } = {}) {
  if (!subPeriods.length) return [];
  const series = [{ date: subPeriods[0].startDate, value: base, real: true }];
  let level = base;
  for (const period of subPeriods) {
    const days = daysBetweenDates(period.startDate, period.endDate);
    if (days <= 0) continue;
    const periodReturn = period.returnPct == null ? 0 : period.returnPct / 100;
    const dailyRate = Math.pow(1 + periodReturn, 1 / days) - 1;
    for (let d = 1; d <= days; d++) {
      level = level * (1 + dailyRate);
      const isLastDay = d === days;
      series.push({
        date: shiftDateBy(period.startDate, d),
        value: Math.round(level * 10000) / 10000,
        real: isLastDay ? !!period.endIsObservation : false,
      });
    }
  }
  return series;
}

// Default external-cash-flow types, used at every hierarchy level for
// now: deposit/withdrawal/buy/sell all count as money crossing the
// scope's boundary. This intentionally matches TODAY's existing
// portfolio-level behaviour (analytics.js's own cashFlowDates
// construction) rather than the plan doc's proposed refinement
// (portfolio scope = deposit/withdrawal only, since buy/sell are
// internal moves within the same portfolio). That refinement is a real
// behaviour CHANGE to the headline number, not just a bugfix, and the
// plan doc is explicit it needs validating against real historical BPI
// data first (section C's "open implementation-time question") - not
// done yet. Ships the validated bugfix (Modified Dietz + observation-
// date boundaries) now; callers can override externalTypes once that
// validation happens, without any other change to this function.
const DEFAULT_EXTERNAL_CASH_FLOW_TYPES = ["deposit", "withdrawal", "buy", "sell"];

/**
 * Single entry point for cash-flow-neutral performance at any of the
 * three hierarchy levels this app's Performance & Benchmark Engine plan
 * defines - portfolio / account / security. What changes per level is
 * entirely the caller's job: which securities are in scope
 * (securityHistories) and which transactions are relevant
 * (transactions, pre-filtered by account_id/security_id as needed) -
 * this function itself has no level-specific branching, so there's
 * nothing here to keep in sync as new scopes get added later.
 *
 * securityHistories: {securityId: [{date, value_eur}]} - already
 *   filtered to the securities in scope by the caller.
 * transactions: transaction rows relevant to this scope.
 * asOfDate: latest date to compute through.
 * externalTypes: which transaction TYPES count as external cash flow
 *   for this scope - see DEFAULT_EXTERNAL_CASH_FLOW_TYPES above for why
 *   the default is what it is today.
 *
 * Returns totalReturnPct/totalReturnAvailable (never a fabricated 0%
 * when there's insufficient data - see this app's *Available flag
 * convention), the raw subPeriods, a dailySeries for charting, and the
 * data-quality facts (firstDate/lastDate/observationCount/hadCashFlows)
 * every performance figure in this plan is required to expose.
 */
function scopedPerformance({ level, securityHistories, transactions, asOfDate, externalTypes = DEFAULT_EXTERNAL_CASH_FLOW_TYPES }) {
  const cashFlows = transactions
    .filter((t) => externalTypes.includes(t.type))
    .map((t) => ({
      date: t.date,
      amount: (t.type === "deposit" || t.type === "buy") ? Number(t.amount || 0) : -Number(t.amount || 0),
    }));

  const observationDates = [...new Set(
    Object.values(securityHistories).flatMap((h) => h.map((v) => v.date))
  )].sort();

  if (!observationDates.length) {
    return {
      totalReturnPct: null, totalReturnAvailable: false, subPeriods: [], dailySeries: [],
      firstDate: cashFlows[0]?.date || null, lastDate: asOfDate,
      observationCount: 0, hadCashFlows: cashFlows.length > 0,
    };
  }

  const result = chainLinkedReturn(securityHistories, cashFlows, observationDates, asOfDate);

  return {
    totalReturnPct: result.totalReturnPct,
    totalReturnAvailable: result.totalReturnPct != null,
    subPeriods: result.subPeriods,
    dailySeries: deriveNormalizedDailySeries(result.subPeriods),
    firstDate: observationDates[0],
    lastDate: asOfDate,
    observationCount: observationDates.length,
    hadCashFlows: cashFlows.length > 0,
  };
}

/**
 * Calendar-year breakdown for scopedPerformance() - mirrors
 * annualReturns()'s relationship to chainLinkedPortfolioReturn() above
 * (same rangeStart-as-synthetic-anchor technique, reused rather than a
 * second calculation method), but built on the new chainLinkedReturn()
 * engine so the yearly figures stay consistent with the new headline
 * total: chaining every year's returnPct together reproduces
 * scopedPerformance()'s own totalReturnPct exactly, because a calendar-
 * year edge is a plain read-point (never a cash flow, never a second
 * observation invented at that date) - same reasoning annualReturns()'s
 * own comment gives, now verified for this engine too (see
 * scratchpad/validate_engine.js).
 */
function scopedAnnualReturns({ securityHistories, transactions, asOfDate, inceptionDate, externalTypes = DEFAULT_EXTERNAL_CASH_FLOW_TYPES }) {
  const cashFlows = transactions
    .filter((t) => externalTypes.includes(t.type))
    .map((t) => ({
      date: t.date,
      amount: (t.type === "deposit" || t.type === "buy") ? Number(t.amount || 0) : -Number(t.amount || 0),
    }));
  const allObservationDates = [...new Set(
    Object.values(securityHistories).flatMap((h) => h.map((v) => v.date))
  )].sort();

  const startYear = Number(inceptionDate.slice(0, 4));
  const endYear = Number(asOfDate.slice(0, 4));
  const years = {};
  for (let y = startYear; y <= endYear; y++) {
    const rangeStart = y === startYear ? inceptionDate : `${y}-01-01`;
    const rangeEnd = y === endYear ? asOfDate : `${y}-12-31`;
    const obsInRange = allObservationDates.filter((d) => d > rangeStart && d <= rangeEnd);
    const flowsInRange = cashFlows.filter((cf) => cf.date > rangeStart && cf.date <= rangeEnd);
    const yearResult = chainLinkedReturn(securityHistories, flowsInRange, [rangeStart, ...obsInRange], rangeEnd);
    years[y] = { rangeStart, rangeEnd, returnPct: yearResult.totalReturnPct, hasObservationInYear: obsInRange.length > 0 };
  }
  return years;
}

/* ============================================================
   Security-level market-price analytics (Phase 2 of the market-data
   roadmap - see docs/implementation-roadmap.md). Pure functions only:
   every one of these takes an already-fetched price array (the shape
   js/db.js:getHistoricalPrices() returns - {date, close, adjusted_close,
   source}) and never touches Supabase/EODHD itself. That's the
   architecture boundary this phase was explicitly required to keep:

     daily_prices -> db.js (market-data access) -> HERE (security
     analytics) -> Security UI

   This answers "how did the SECURITY ITSELF perform" (a market price
   moving) - a different question from valueOfSecurityAsOf()/
   chainLinkedPortfolioReturn() above, which answer "what was MY
   POSITION worth" (a portfolio holding's value). They're kept as
   entirely separate functions on purpose, never sharing one calculation
   just because both produce a percentage - conflating "the ETF was up
   10%" with "my position was up 6%" (a real, expected divergence once
   purchase timing/contributions/FX are involved) is exactly the mistake
   this separation exists to prevent.

   Every function here uses `close`, never `adjusted_close`, for price
   return - `adjusted_close` is threaded through unused for now (see
   dailyReturns()) so a distributing (non-Accumulating) security added
   later can get true total-return figures without a data-model change,
   without today's Accumulating-only holdings silently changing meaning.
   ============================================================ */

/** Minimum-history gates as configuration, not magic numbers scattered
    through each function below - change one place to change the whole
    policy. Each is a deliberate judgment call (see the Phase 2
    methodology proposal this was approved against), not a mathematical
    requirement - adjust freely. */
const SECURITY_ANALYTICS_THRESHOLDS = {
  minObservationsForDailyReturn: 2,
  minDaysFor1YReturn: 350,
  minDaysForAnnualisedReturn: 180,
  minObservationsForVolatility: 60,
  minObservationsForDrawdown: 60,
  tradingDaysPerYear: 252,
};

function daysBetweenDates(dateA, dateB) {
  return Math.round((new Date(dateB) - new Date(dateA)) / 86400000);
}

function shiftDateBy(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Nearest observation ON OR AFTER `date` - the right anchor for "start
    of period" questions (YTD, calendar year, 1Y): a security whose own
    history starts mid-year should anchor to ITS first real observation,
    never a synthesized Jan-1 price. */
function priceOnOrAfter(priceHistory, date) {
  let best = null;
  for (const p of priceHistory) {
    if (p.date < date) continue;
    if (best === null || p.date < best.date) best = p;
  }
  return best;
}

/** Nearest observation ON OR BEFORE `date` - the right anchor for "end
    of period" (never a future price). */
function priceOnOrBefore(priceHistory, date) {
  let best = null;
  for (const p of priceHistory) {
    if (p.date > date) continue;
    if (best === null || p.date > best.date) best = p;
  }
  return best;
}

/** Shared period-return primitive every metric below is built from - one
    formula, not one per metric. Returns null (not 0%) when either anchor
    is missing or the anchors collapse to the same/reversed observation -
    "no qualifying data" must never look like "no growth". */
function priceReturnBetween(priceHistory, rangeStart, rangeEnd) {
  const startObs = priceOnOrAfter(priceHistory, rangeStart);
  const endObs = priceOnOrBefore(priceHistory, rangeEnd);
  if (!startObs || !endObs || startObs.date >= endObs.date) return null;
  return {
    returnPct: Math.round((endObs.close / startObs.close - 1) * 10000) / 100,
    startDate: startObs.date,
    startPrice: startObs.close,
    endDate: endObs.date,
    endPrice: endObs.close,
    daysElapsed: daysBetweenDates(startObs.date, endObs.date),
  };
}

/** Daily price-return series - r_t = close_t/close_{t-1} - 1 between
    CONSECUTIVE available observations only, never gap-filled. Each point
    carries its own daysElapsed so a missed fetch day (e.g. a 3-day gap
    from a cron outage) stays visibly not-1-day rather than silently
    posing as a normal daily return. adjusted_close is carried through
    unused (adjustedReturnPct) - kept, not computed into anything yet,
    so the price-return/adjusted-return distinction survives in the data
    even though today's Accumulating-only holdings make them coincide. */
function dailyReturns(priceHistory) {
  const sorted = [...priceHistory].sort((a, b) => a.date.localeCompare(b.date));
  const returns = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], curr = sorted[i];
    if (!prev.close || !curr.close) continue;
    const point = {
      date: curr.date,
      returnPct: (curr.close / prev.close - 1) * 100,
      daysElapsed: daysBetweenDates(prev.date, curr.date),
    };
    if (prev.adjusted_close && curr.adjusted_close) {
      point.adjustedReturnPct = (curr.adjusted_close / prev.adjusted_close - 1) * 100;
    }
    returns.push(point);
  }
  return returns;
}

/** Since the security's own first real observation through its latest -
    the one return that's always computable the moment ANY 2 observations
    exist, deliberately never labeled "since inception" (this app already
    uses that term for the PORTFOLIO's own inception, a different date). */
function securitySinceDataAvailableReturn(priceHistory, thresholds = SECURITY_ANALYTICS_THRESHOLDS) {
  if (priceHistory.length < thresholds.minObservationsForDailyReturn) return null;
  const sorted = [...priceHistory].sort((a, b) => a.date.localeCompare(b.date));
  return priceReturnBetween(sorted, sorted[0].date, sorted[sorted.length - 1].date);
}

/** Year-to-date, anchored at the LATEST REAL observation, never today's
    calendar date - a security whose data is a day stale still gets a
    genuine YTD as of what's actually known, not a fabricated "as of
    today" figure. */
function securityYtdReturn(priceHistory, asOfDate) {
  const year = asOfDate.slice(0, 4);
  return priceReturnBetween(priceHistory, `${year}-01-01`, asOfDate);
}

/** Trailing 1-year - only computed once real coverage actually spans
    close to a year (minDaysFor1YReturn), so a security with 4 months of
    history never gets labeled "1Y Return" over a shorter window. */
function securityOneYearReturn(priceHistory, asOfDate, thresholds = SECURITY_ANALYTICS_THRESHOLDS) {
  const sorted = [...priceHistory].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  if (daysBetweenDates(sorted[0].date, asOfDate) < thresholds.minDaysFor1YReturn) return null;
  return priceReturnBetween(sorted, shiftDateBy(asOfDate, -365), asOfDate);
}

/** CAGR over the full available (since-data-available) period - distinct
    from "average annual return" (arithmetic mean of yearly figures, not
    implemented here - needs >=2 FULL calendar years, which no currently
    tracked security has yet). Gated on minDaysForAnnualisedReturn:
    annualising a handful of weeks amplifies noise into a meaningless
    number (a 5% move over 30 days annualises past +900%). */
function securityCAGR(priceHistory, asOfDate, thresholds = SECURITY_ANALYTICS_THRESHOLDS) {
  const period = securitySinceDataAvailableReturn(priceHistory, thresholds);
  if (!period || period.daysElapsed < thresholds.minDaysForAnnualisedReturn) return null;
  const years = period.daysElapsed / 365;
  return {
    ...period,
    cagrPct: Math.round((Math.pow(period.endPrice / period.startPrice, 1 / years) - 1) * 10000) / 100,
  };
}

/** Calendar-year breakdown, same anchor-clipping convention as the
    portfolio-level annualReturns() above (first year clips to the
    security's own first observation, not Jan-1) - reused deliberately,
    not reinvented, so "partial year" means the same thing at both
    levels. isPartialYear/isYTD are explicit flags so the UI can label
    "Partial year - 11 Aug - 31 Dec" / "YTD - 1 Jan - 7 Aug" instead of
    presenting either as an ordinary full calendar year - and
    hasObservationInYear stays false (never a fabricated 0%) for any
    year with no real observation at all. */
function securityAnnualReturns(priceHistory, asOfDate) {
  const sorted = [...priceHistory].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return {};
  const startYear = Number(sorted[0].date.slice(0, 4));
  const endYear = Number(asOfDate.slice(0, 4));
  const years = {};
  for (let y = startYear; y <= endYear; y++) {
    const rangeStart = y === startYear ? sorted[0].date : `${y}-01-01`;
    const rangeEnd = y === endYear ? asOfDate : `${y}-12-31`;
    const result = priceReturnBetween(sorted, rangeStart, rangeEnd);
    years[y] = {
      rangeStart,
      rangeEnd,
      returnPct: result ? result.returnPct : null,
      hasObservationInYear: !!result,
      isPartialYear: rangeStart !== `${y}-01-01`,
      isYTD: y === endYear && rangeEnd !== `${y}-12-31`,
    };
  }
  return years;
}

/** Annualised volatility = sample stdev (n-1, we're estimating from a
    sample, not observing the full population) of DAILY returns x
    sqrt(252) - your own stated preference, validated against the
    methodology proposal. Gated on minObservationsForVolatility (60
    trading days, ~3 months) - below that a handful of outlier days
    dominates the estimate. averageDailyReturnPct is folded in here
    (not a separate top-level metric, per your own instruction that it's
    an analytical input, not a headline UI number) since volatility
    already computes the mean as part of the stdev calculation - no
    second pass needed. */
function securityVolatility(priceHistory, thresholds = SECURITY_ANALYTICS_THRESHOLDS) {
  const returns = dailyReturns(priceHistory);
  if (returns.length < thresholds.minObservationsForVolatility) return null;
  const values = returns.map((r) => r.returnPct / 100);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  const dailyStdDev = Math.sqrt(variance);
  return {
    annualisedVolatilityPct: Math.round(dailyStdDev * Math.sqrt(thresholds.tradingDaysPerYear) * 10000) / 100,
    averageDailyReturnPct: Math.round(mean * 10000) / 100,
    observationCount: returns.length,
    periodStart: returns[0].date,
    periodEnd: returns[returns.length - 1].date,
  };
}

/** Maximum drawdown over the full AVAILABLE history - close-based (the
    price you could actually have traded at, not a distribution-adjusted
    figure), never a rolling window. periodStart/periodEnd are always
    returned alongside the number specifically so the UI can never
    present this as "all-time" when coverage is really ~1 year - see
    this app's own EODHD free-tier limitation. Gated on the same
    60-observation minimum as volatility (same "too little data is just
    noise" concern). */
function securityMaxDrawdown(priceHistory, thresholds = SECURITY_ANALYTICS_THRESHOLDS) {
  const sorted = [...priceHistory].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < thresholds.minObservationsForDrawdown) return null;
  let peak = sorted[0].close;
  let maxDrawdownPct = 0;
  for (const p of sorted) {
    if (p.close > peak) peak = p.close;
    const drawdownPct = (p.close / peak - 1) * 100;
    if (drawdownPct < maxDrawdownPct) maxDrawdownPct = drawdownPct;
  }
  return {
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    periodStart: sorted[0].date,
    periodEnd: sorted[sorted.length - 1].date,
  };
}

/** The one entry point Security UI should call - bundles every metric
    above plus provenance (source data-quality principle applied at the
    security-market-data level: source/coverage/price field/currency, all
    read straight from the data, never invented). `available: false` is
    the honest, structural answer for anything with no daily_prices rows
    at all (BPI Dinâmico - no data_provider_symbol, so getHistoricalPrices()
    naturally returns []) - the UI's job is to render that as "market-
    price analytics unavailable for this security type", never as empty
    or zeroed cards. Sharpe and "average annual return" are deliberately
    NOT included here - see this project's Phase 2 methodology proposal
    for why (no sourced EUR risk-free rate; fewer than 2 full calendar
    years on record for anything currently tracked). asOfDate is always
    the latest REAL observation in priceHistory, never today's calendar
    date - never an invented "as of". */
function securityMarketAnalytics(security, priceHistory, thresholds = SECURITY_ANALYTICS_THRESHOLDS) {
  if (!priceHistory || !priceHistory.length) {
    return { available: false, reason: "no-market-data" };
  }
  const sorted = [...priceHistory].sort((a, b) => a.date.localeCompare(b.date));
  const asOfDate = sorted[sorted.length - 1].date;
  return {
    available: true,
    provenance: {
      source: sorted[sorted.length - 1].source || null,
      priceFieldUsed: "close",
      currency: security.currency || null,
      firstObservationDate: sorted[0].date,
      lastObservationDate: asOfDate,
      // importedAt: when Portfol.io actually fetched/stored the latest
      // observation (daily_prices.fetched_at) - kept explicitly distinct
      // from lastObservationDate (the market's own as-of date, what the
      // security traded at). For this automated daily_prices pipeline
      // there's no separate "last confirmed" step beyond the fetch
      // itself, so importedAt IS the closest thing to a "last updated"
      // fact here too - not a second, invented timestamp.
      importedAt: sorted[sorted.length - 1].fetched_at || null,
      observationCount: sorted.length,
    },
    sinceDataAvailable: securitySinceDataAvailableReturn(sorted, thresholds),
    ytd: securityYtdReturn(sorted, asOfDate),
    oneYear: securityOneYearReturn(sorted, asOfDate, thresholds),
    cagr: securityCAGR(sorted, asOfDate, thresholds),
    annualReturns: securityAnnualReturns(sorted, asOfDate),
    volatility: securityVolatility(sorted, thresholds),
    maxDrawdown: securityMaxDrawdown(sorted, thresholds),
  };
}

window.costBasisFromTransactions = costBasisFromTransactions;
window.unrealisedPnL = unrealisedPnL;
window.costDrag = costDrag;
window.productScore = productScore;
window.valueOfSecurityAsOf = valueOfSecurityAsOf;
window.indexValueSeries = indexValueSeries;
window.chainLinkedPortfolioReturn = chainLinkedPortfolioReturn;
window.annualReturns = annualReturns;
window.modifiedDietzReturn = modifiedDietzReturn;
window.chainLinkedReturn = chainLinkedReturn;
window.deriveNormalizedDailySeries = deriveNormalizedDailySeries;
window.scopedPerformance = scopedPerformance;
window.scopedAnnualReturns = scopedAnnualReturns;
window.SECURITY_ANALYTICS_THRESHOLDS = SECURITY_ANALYTICS_THRESHOLDS;
window.dailyReturns = dailyReturns;
window.securityMarketAnalytics = securityMarketAnalytics;
