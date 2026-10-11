// Run: node tests/simulator-engine.test.cjs
const assert = require("assert");
const fs = require("fs");
const path = require("path");
// The engine is a plain browser script; load it the way the page does.
const mod = { exports: {} };
new Function("module", fs.readFileSync(path.join(__dirname, "../js/simulator-engine.js"), "utf8"))(mod);
const E = mod.exports;
const close = (a, b, eps = 1e-9, msg = "") => assert.ok(Math.abs(a - b) < eps, `${msg} expected ${b}, got ${a}`);

// 1. monthly returns: month-end values, and a gap is NOT bridged
{
  const pts = [
    { date: "2026-01-15", value: 100 }, { date: "2026-01-31", value: 100 },
    { date: "2026-02-28", value: 110 },
    { date: "2026-04-30", value: 121 }, // March missing -> no Feb->Apr "monthly" return
    { date: "2026-05-31", value: 133.1 },
  ];
  const r = E.monthlyReturns(pts);
  assert.deepStrictEqual(r.map((x) => x.month), ["2026-02", "2026-05"]);
  close(r[0].r, 0.10); close(r[1].r, 0.10);
}

// 2. alignment keeps only common months
{
  const a = [{ month: "2026-01", r: 0.01 }, { month: "2026-02", r: 0.02 }, { month: "2026-03", r: 0.03 }];
  const b = [{ month: "2026-02", r: 0.05 }, { month: "2026-03", r: 0.06 }];
  const al = E.alignReturns({ a, b });
  assert.deepStrictEqual(al.months, ["2026-02", "2026-03"]);
  assert.deepStrictEqual(al.data.a, [0.02, 0.03]);
}

// 3. covariance / correlation / beta
{
  const m = [0.01, -0.02, 0.03, 0.00, 0.02, -0.01];
  const twice = m.map((x) => 2 * x);
  const inv = m.map((x) => -x);
  close(E.beta(twice, m), 2, 1e-12, "beta of 2x market");
  close(E.correlation(m, twice), 1, 1e-12, "corr with 2x");
  close(E.correlation(m, inv), -1, 1e-12, "corr with inverse");
  close(E.covariance(m, m), E.annualisedVolPct(m) ** 2 / 1e4 / 12, 1e-12, "vol from variance");
}

// 4. portfolio stats for two assets: sigma^2 = w'Cw
{
  const cov = [[0.04, 0.0], [0.0, 0.09]];
  const s = E.portfolioStats({ weights: [0.5, 0.5], mu: [0.06, 0.08], cov, rf: 0.02 });
  close(s.mu, 0.07);
  close(s.sigma, Math.sqrt(0.25 * 0.04 + 0.25 * 0.09), 1e-12);
  close(s.sharpe, (0.07 - 0.02) / s.sigma, 1e-12);
}

// 5. trades: sell clamps to what is held; buy from cash clamps to the cash balance
{
  const pos = [{ id: "A", value: 100 }, { id: "CASH", value: 50 }];
  const s = E.applyTrade(pos, { id: "A", side: "sell", amount: 500, funding: "cash" }, "CASH");
  assert.ok(s.clamped); close(s.appliedAmount, 100);
  close(s.positions.find((p) => p.id === "A").value, 0);
  close(s.positions.find((p) => p.id === "CASH").value, 150);

  const b = E.applyTrade(pos, { id: "B", side: "buy", amount: 80, funding: "cash" }, "CASH");
  assert.ok(b.clamped); close(b.appliedAmount, 50);
  close(b.positions.find((p) => p.id === "B").value, 50);
  close(b.positions.find((p) => p.id === "CASH").value, 0);

  const n = E.applyTrade(pos, { id: "B", side: "buy", amount: 80, funding: "new" }, "CASH");
  assert.ok(!n.clamped);
  close(n.positions.reduce((t, p) => t + p.value, 0), 230); // new money grows the portfolio
  assert.strictEqual(pos[0].value, 100); // input not mutated
}

// 6. Sharpe curve: an uncorrelated asset with a positive excess return improves Sharpe, and the
//    weight cap is respected
{
  const ids = ["A", "B"];
  const cov = [[0.04, 0], [0, 0.04]];
  const mu = [0.06, 0.06];
  const positions = [{ id: "A", value: 1000 }];
  const res = E.sharpeCurve({ positions, ids, mu, cov, rf: 0.02, tradeBase: { id: "B", side: "buy", funding: "new" }, maxAmount: 1000, steps: 40 });
  // two equal uncorrelated assets: best is 50/50 -> buy 1000 of B
  close(res.best.amount, 1000, 1e-6);
  assert.ok(res.best.sharpe > E.portfolioStats({ weights: [1, 0], mu, cov, rf: 0.02 }).sharpe);
  const capped = E.sharpeCurve({ positions, ids, mu, cov, rf: 0.02, tradeBase: { id: "B", side: "buy", funding: "new" }, maxAmount: 1000, steps: 40, maxWeight: 0.25 });
  assert.ok(capped.best.weight <= 0.25 + 1e-9);
}

// 7. projection: zero volatility collapses to deterministic growth; percentiles are ordered; real < nominal
{
  const z = E.projectValue({ amount: 1000, muPct: 5, sigmaPct: 0, years: 10, inflationPct: 2 });
  close(z.nominal.median, 1000 * Math.exp(0.05 * 10), 1e-6);
  close(z.nominal.p10, z.nominal.p90, 1e-6);
  const p = E.projectValue({ amount: 1000, muPct: 6, sigmaPct: 20, years: 10, inflationPct: 2.5 });
  assert.ok(p.nominal.p10 < p.nominal.median && p.nominal.median < p.nominal.p90);
  assert.ok(p.real.median < p.nominal.median);
}

// 8. costs: round trip doubles one-off costs; TER accumulates over the horizon
{
  const c = E.tradeCosts({ amount: 1000, years: 5, terPct: 0.4, commissionPct: 0.1, commissionFlat: 1, fxPct: 0.15 });
  close(c.terPerYear, 4); close(c.terOverHorizon, 20);
  close(c.commission, 2 * (1 + 1)); close(c.fx, 2 * 1.5);
  close(c.totalOverHorizon, 20 + 4 + 3);
  const one = E.tradeCosts({ amount: 1000, years: 1, commissionPct: 0.1, roundTrip: false });
  close(one.commission, 1);
}

// 9. max drawdown & CAGR
{
  const pts = [100, 120, 90, 110].map((v, i) => ({ date: `2026-0${i + 1}-28`, value: v }));
  close(E.maxDrawdownPct(pts), (90 / 120 - 1) * 100, 1e-9);
  const rets = [0.01, 0.01, 0.01];
  close(E.cagrPct(rets), (Math.pow(1.01 ** 3, 4) - 1) * 100, 1e-9);
}

// 10. data warnings
{
  assert.strictEqual(E.dataWarnings({ overlapMonths: 60, candidateMonths: 80, priceAgeDays: 1, ratesAgeDays: 1 }).length, 0);
  assert.strictEqual(E.dataWarnings({ overlapMonths: 60, candidateMonths: 6, priceAgeDays: 1, ratesAgeDays: 1 })[0].level, "high");
  assert.strictEqual(E.dataWarnings({ overlapMonths: 10, candidateMonths: 80, priceAgeDays: 9, ratesAgeDays: 9 }).length, 3);
}

console.log("simulator-engine: all tests passed");
