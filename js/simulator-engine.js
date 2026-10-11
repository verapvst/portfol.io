/* ============================================================
   simulator-engine.js - the maths behind the Simulator. Pure functions:
   no DOM, no Supabase, no globals read, so every number can be unit-tested
   (see tests/simulator-engine.test.js) and the page only RENDERS what this
   file computes.

   What it does, in plain terms:
   - turns price/value series into MONTHLY returns (never across a gap),
   - aligns several assets on the months they all have,
   - builds an annualised covariance matrix,
   - applies a hypothetical buy/sell to the current weights,
   - scores the result (expected return, volatility, Sharpe) and searches
     trade sizes for the best Sharpe,
   - projects a position forward with a stated model, and adds up costs.

   What it deliberately does NOT do: predict the market. Expected returns
   are ASSUMPTIONS the caller chooses and the page labels as such (CAPM from
   a stated equity risk premium, a current Treasury yield for bonds, or the
   asset's own history shown only as a reference). The ranking and
   suggestions are model output for research, not advice.
   ============================================================ */

const MONTHS_PER_YEAR = 12;

/* ---------- Returns ---------- */

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }

function monthIndex(key) {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
}

/** Last value in each calendar month -> Map(monthKey -> value). Input is
    [{date:"YYYY-MM-DD", value}] in any order; non-positive/NaN values are
    ignored. */
function monthEndValues(points) {
  const sorted = [...points]
    .filter((p) => p && p.date && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = new Map();
  for (const p of sorted) byMonth.set(monthKeyOf(p.date), p.value);
  return byMonth;
}

/** Monthly simple returns from month-end values. A return is only produced
    when the PREVIOUS calendar month is also present - a missing month is a
    gap, never silently turned into a two-month "monthly" return.
    -> [{month, r}] oldest first. */
function monthlyReturns(points) {
  const ends = monthEndValues(points);
  const keys = [...ends.keys()].sort();
  const out = [];
  for (let i = 1; i < keys.length; i++) {
    if (monthIndex(keys[i]) - monthIndex(keys[i - 1]) !== 1) continue;
    out.push({ month: keys[i], r: ends.get(keys[i]) / ends.get(keys[i - 1]) - 1 });
  }
  return out;
}

/** Aligns named return series on the months ALL of them have.
    series: { id: [{month, r}] } -> { months: [...], data: { id: [r...] } } */
function alignReturns(series) {
  const ids = Object.keys(series);
  if (!ids.length) return { months: [], data: {} };
  const maps = ids.map((id) => new Map(series[id].map((x) => [x.month, x.r])));
  const common = [...maps[0].keys()].filter((m) => maps.every((mp) => mp.has(m))).sort();
  const data = {};
  ids.forEach((id, i) => { data[id] = common.map((m) => maps[i].get(m)); });
  return { months: common, data };
}

/* ---------- Statistics ---------- */

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

function covariance(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  const ma = mean(a), mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}

function correlation(a, b) {
  const c = covariance(a, b), va = covariance(a, a), vb = covariance(b, b);
  if (c == null || !va || !vb) return null;
  return c / Math.sqrt(va * vb);
}

/** Beta of `asset` to `market` (both monthly returns on the same months). */
function beta(asset, market) {
  const c = covariance(asset, market), v = covariance(market, market);
  return c == null || !v ? null : c / v;
}

/** Annualised volatility (%) from monthly returns. */
function annualisedVolPct(returns) {
  const v = covariance(returns, returns);
  return v == null ? null : Math.sqrt(v * MONTHS_PER_YEAR) * 100;
}

/** Geometric annualised return (%) from monthly returns. */
function cagrPct(returns) {
  if (!returns.length) return null;
  const growth = returns.reduce((g, r) => g * (1 + r), 1);
  return (Math.pow(growth, MONTHS_PER_YEAR / returns.length) - 1) * 100;
}

/** Worst peak-to-trough fall (%) of a month-end value series, as a negative
    number (0 if it never fell). */
function maxDrawdownPct(points) {
  const ends = monthEndValues(points);
  let peak = -Infinity, worst = 0;
  for (const v of ends.values()) {
    if (v > peak) peak = v;
    worst = Math.min(worst, (v / peak - 1) * 100);
  }
  return worst;
}

/** Annualised covariance matrix (decimal, not %) for the ids, in order.
    cash-like assets can be passed as ids with `zeroVar` so they get a
    zero row/column. */
function annualCovMatrix(aligned, ids, zeroVarIds = []) {
  const n = ids.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (zeroVarIds.includes(ids[i]) || zeroVarIds.includes(ids[j])) continue;
      const c = covariance(aligned.data[ids[i]], aligned.data[ids[j]]);
      if (c == null) return null;
      m[i][j] = m[j][i] = c * MONTHS_PER_YEAR;
    }
  }
  return m;
}

/* ---------- Expected return assumptions ---------- */

/** CAPM: rf + beta * equity risk premium, all in % per year. */
function capmExpectedPct({ rfPct, beta: b, erpPct }) {
  return rfPct + b * erpPct;
}

/* ---------- Portfolio maths ---------- */

/** weights: array summing to ~1; mu: decimal expected returns; cov: annual
    covariance matrix (decimal). -> { mu, sigma, sharpe } (decimals). */
function portfolioStats({ weights, mu, cov, rf }) {
  const n = weights.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += weights[i] * mu[i];
  let v = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += weights[i] * weights[j] * cov[i][j];
  const sigma = Math.sqrt(Math.max(v, 0));
  return { mu: m, sigma, sharpe: sigma > 0 ? (m - rf) / sigma : null };
}

/** Applies one hypothetical trade to a list of positions.
    positions: [{id, value}] (EUR, includes a cash position if any).
    trade: { id, side: "buy"|"sell", amount, funding }
      buy  funding "new"  : amount is NEW money added to the portfolio
           funding "cash" : amount is moved out of `cashId` (capped at its value)
      sell funding "withdraw": proceeds leave the portfolio
           funding "cash"    : proceeds go to `cashId`
    A buy of an id not yet held adds a position. Selling more than held is
    clamped to the position (you can only sell what you hold).
    -> { positions, appliedAmount, clamped } */
function applyTrade(positions, trade, cashId = null) {
  const next = positions.map((p) => ({ ...p }));
  const find = (id) => next.find((p) => p.id === id);
  let amount = Math.max(0, Number(trade.amount) || 0);
  let clamped = false;

  if (trade.side === "sell") {
    const pos = find(trade.id);
    const held = pos ? pos.value : 0;
    if (amount > held) { amount = held; clamped = true; }
    if (pos) pos.value -= amount;
    if (trade.funding === "cash" && cashId) {
      const cash = find(cashId);
      if (cash) cash.value += amount;
    }
  } else {
    if (trade.funding === "cash" && cashId) {
      const cash = find(cashId);
      const available = cash ? cash.value : 0;
      if (amount > available) { amount = available; clamped = true; }
      if (cash) cash.value -= amount;
    }
    const pos = find(trade.id);
    if (pos) pos.value += amount;
    else next.push({ id: trade.id, value: amount });
  }
  return { positions: next, appliedAmount: amount, clamped };
}

function weightsOf(positions, ids) {
  const total = positions.reduce((s, p) => s + p.value, 0);
  return ids.map((id) => {
    const p = positions.find((x) => x.id === id);
    return total > 0 && p ? p.value / total : 0;
  });
}

/** Scores the portfolio before and after a trade. `ids` fixes the asset order
    used by mu/cov; every position id must be in it. */
function scoreTrade({ positions, ids, mu, cov, rf, trade, cashId }) {
  const before = portfolioStats({ weights: weightsOf(positions, ids), mu, cov, rf });
  const applied = applyTrade(positions, trade, cashId);
  const after = portfolioStats({ weights: weightsOf(applied.positions, ids), mu, cov, rf });
  return { before, after, applied };
}

/** Sweeps trade sizes from 0 to `maxAmount` and returns the Sharpe curve and
    the best point. A `maxWeight` cap (0-1) drops sizes that would put more
    than that share of the portfolio in the traded asset. */
function sharpeCurve({ positions, ids, mu, cov, rf, tradeBase, cashId, maxAmount, steps = 40, maxWeight = 1 }) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const amount = (maxAmount * i) / steps;
    const applied = applyTrade(positions, { ...tradeBase, amount }, cashId);
    const w = weightsOf(applied.positions, ids);
    const tradedWeight = w[ids.indexOf(tradeBase.id)] ?? 0;
    if (tradedWeight > maxWeight + 1e-9) continue;
    const s = portfolioStats({ weights: w, mu, cov, rf });
    points.push({ amount: applied.appliedAmount, weight: tradedWeight, sharpe: s.sharpe, mu: s.mu, sigma: s.sigma });
  }
  const scored = points.filter((p) => p.sharpe != null);
  const best = scored.reduce((b, p) => (b == null || p.sharpe > b.sharpe ? p : b), null);
  return { points, best };
}

/* ---------- Projection and costs ---------- */

/** Lognormal projection of `amount` over `years`.
    muPct = expected arithmetic return (% per year, NET of fund costs),
    sigmaPct = annual volatility (%). Returns the median and the 10th/90th
    percentile outcomes in nominal terms, and the same deflated by
    `inflationPct`. This is a model of a RANGE, not a forecast. */
function projectValue({ amount, muPct, sigmaPct, years, inflationPct = 0 }) {
  const mu = muPct / 100, sigma = sigmaPct / 100;
  const drift = (mu - 0.5 * sigma * sigma) * years;
  const spread = sigma * Math.sqrt(years);
  const z90 = 1.2815515655446004;
  const at = (z) => amount * Math.exp(drift + z * spread);
  const deflator = Math.pow(1 + inflationPct / 100, years);
  const nominal = { p10: at(-z90), median: at(0), p90: at(z90) };
  return {
    nominal,
    real: { p10: nominal.p10 / deflator, median: nominal.median / deflator, p90: nominal.p90 / deflator },
    expectedNominal: amount * Math.exp(mu * years),
  };
}

/** Costs of a trade held for `years`. All EUR.
    terPct: fund ongoing charge (% per year) - already inside the fund's
    price, shown so the cumulative drag is visible, NOT charged again on top.
    commissionPct/commissionFlat: broker commission per trade (a buy and,
    eventually, the sale). fxPct: broker FX fee when the fund currency isn't
    the account currency. */
function tradeCosts({ amount, years, terPct = 0, commissionPct = 0, commissionFlat = 0, fxPct = 0, roundTrip = true }) {
  const commissionOne = amount * (commissionPct / 100) + commissionFlat;
  const fxOne = amount * (fxPct / 100);
  const legs = roundTrip ? 2 : 1;
  const terYear = amount * (terPct / 100);
  return {
    terPerYear: terYear,
    terOverHorizon: terYear * years,
    commission: commissionOne * legs,
    fx: fxOne * legs,
    totalOneOff: (commissionOne + fxOne) * legs,
    totalOverHorizon: terYear * years + (commissionOne + fxOne) * legs,
  };
}

/* ---------- Data-quality gate ---------- */

/** Warnings the page must show before it shows a number. */
function dataWarnings({ overlapMonths, candidateMonths, priceAgeDays, ratesAgeDays, minMonths = 36 }) {
  const w = [];
  if (candidateMonths < 18) w.push({ level: "high", text: `Only ${candidateMonths} months of price history - volatility, beta and correlation are very unreliable (36+ months is a reasonable minimum).` });
  else if (overlapMonths < minMonths) w.push({ level: "medium", text: `Only ${overlapMonths} months overlap with your portfolio (${minMonths}+ is better) - treat correlation and Sharpe as rough.` });
  if (priceAgeDays != null && priceAgeDays > 4) w.push({ level: "medium", text: `The latest price is ${priceAgeDays} days old - refresh it before relying on the amount of units.` });
  if (ratesAgeDays != null && ratesAgeDays > 5) w.push({ level: "medium", text: `Treasury yields are ${ratesAgeDays} days old.` });
  return w;
}

const SimulatorEngine = {
  monthEndValues, monthlyReturns, alignReturns, covariance, correlation, beta,
  annualisedVolPct, cagrPct, maxDrawdownPct, annualCovMatrix, capmExpectedPct,
  portfolioStats, applyTrade, scoreTrade, sharpeCurve, projectValue, tradeCosts,
  dataWarnings, weightsOf,
};

if (typeof window !== "undefined") window.SimulatorEngine = SimulatorEngine;
if (typeof module !== "undefined") module.exports = SimulatorEngine;
