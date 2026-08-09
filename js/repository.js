/* ============================================================
   repository.js - the data access layer. UI code (ui.js, charts.js,
   shell.js) reads only through getPortfolioData(); nothing outside
   this file should reach into the mock data below directly.

   This is the Repository pattern: the entry point at the top is a
   stable seam, the mock implementation below it is one interchangeable
   backend behind that seam.

     UI -> repository (getPortfolioData) -> mock | Excel parser | API

   Swapping what backs the dashboard is a change to the body of
   getPortfolioData(), never to rendering code.
   ============================================================ */

/**
 * Contract - the returned object always has these domains:
 *
 *   portfolio: { holdings, accounts, cash, transactions }
 *   history:   { valueSeries, inceptionDate, benchmarks, marketData }
 *   analytics: { assetClassAllocation, productAllocation, accountAllocation,
 *                regions, countries, notCountrySpecificWeight, currency,
 *                health, performance }
 *   settings:  { currency, benchmark, timezone }
 *   metadata:  { lastUpdated, source, version }
 *
 * See getMockPortfolioData below for the exact shape of each field.
 * KPI-card presentation (icon, tone, label, note text) and portfolio-
 * insight sentences are NOT part of this contract - those are UI
 * concerns computed from portfolio/analytics by ui.js, not stored data.
 *
 * Phase 2 order: 1) historical registry (see archive/) feeds
 * history.valueSeries / analytics.performance, 2) Excel parser produces
 * portfolio.holdings, 3) BPI merges in as another entry in
 * portfolio.accounts, 4) analytics (allocation/region/health) get
 * computed here from the merged portfolio instead of being stored data.
 * Each step replaces one piece of this function's body; the UI does
 * not change.
 */
function getPortfolioData() {
  return getMockPortfolioData();
}

/**
 * XIRR (Investor Return) - the annualised return the INVESTOR actually
 * earned, given the real timing and size of their own cash flows. This
 * is deliberately a generic solver over an arbitrary list of dated cash
 * flows, not a formula special-cased to today's two flows - the moment
 * a new contribution/withdrawal lands in Transactions, it's one more
 * entry in the `cashflows` array this function takes, never a rewrite.
 *
 * cashflows: [{ date: "YYYY-MM-DD", amount }] - negative = money the
 * investor put in, positive = money they'd get back if they cashed out
 * on that date (the final entry is always "current total value, as of
 * its own valuation date" - not a real withdrawal, a hypothetical one).
 *
 * Solves NPV(r) = sum(amount_i / (1+r)^(years since first flow)) = 0
 * via Newton-Raphson, falling back to bisection if Newton doesn't
 * converge (guards against a bad first derivative on unusual cash-flow
 * shapes - two contributions and one terminal value always converges
 * cleanly, but this shouldn't silently break once the flow list grows).
 */
function xirr(cashflows) {
  const d0 = new Date(cashflows[0].date);
  const yearsSince = (d) => (new Date(d) - d0) / (365 * 86400000);
  const npv = (r) => cashflows.reduce((s, cf) => s + cf.amount / Math.pow(1 + r, yearsSince(cf.date)), 0);
  const npvDerivative = (r) => cashflows.reduce((s, cf) => {
    const t = yearsSince(cf.date);
    return s - (t * cf.amount) / Math.pow(1 + r, t + 1);
  }, 0);

  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(r);
    const fp = npvDerivative(r);
    if (Math.abs(fp) < 1e-12) break;
    const next = r - f / fp;
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
  }

  // Newton didn't converge (e.g. a pathological cash-flow shape) - fall
  // back to bisection over a wide, sane range rather than returning a
  // wrong number.
  let lo = -0.9999, hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Mock data source behind getPortfolioData(). "Mock" here means "not
 * live-refreshed this session" - wherever a figure is actually known
 * (total value, holdings, accounts, EUR/USD split, the real country
 * list) it's the real number established earlier in this project, not
 * an invented one. Where nothing real exists yet (asset-class split
 * inside BPI Dinâmico, regional roll-up beyond the known countries), the
 * gap is labelled explicitly ("Mixed Fund", "Other / not yet mapped")
 * instead of guessed at. Phase 2 replaces this whole function; nothing
 * outside it should read these numbers directly.
 */
function getMockPortfolioData() {
  const totalValue = 495.44; // BPI Dinâmico 335.44 (2026-08-04) + Trading212 sleeve 160.00
  const investedCapital = 410.00;
  const inceptionDate = "2017-06-21";
  const unrealisedGain = 85.44;
  // Time-Weighted Return, not a naive gain/invested % - that formula
  // dilutes toward 0% every time fresh capital is added (see the T212
  // sleeve, bought today with 0 elapsed time to gain or lose anything),
  // which would make "adding money" look like "the portfolio performed
  // better", exactly backwards. TWR isolates the return actually earned:
  // BPI Dinâmico is the only holding with a return history (single
  // lump-sum subscription in 2017, no interim contributions since), so
  // its own trajectory (249.59 -> 335.44) IS the portfolio's TWR to
  // date. T212 contributes a real 0% sub-period until it has time
  // behind it - chain-linking will matter once it does.
  const totalReturnPct = 34.40;
  const todayChange = 0;
  const todayChangePct = 0;
  const cash = 0;

  // Investor Return (XIRR) - real cash flows straight from Transactions
  // (BPI-DIN-000001's €250 on 2017-06-21, the four T212 buys totalling
  // €160 on 2026-08-04), plus the current total value as a hypothetical
  // "sold everything today" terminal flow on its own valuation date.
  // Annualised, unlike totalReturnPct above (cumulative TWR) - the two
  // numbers living on different time bases is expected, not a bug; see
  // the investor-return info popover for why they're not meant to match.
  const xirrCashflows = [
    { date: "2017-06-21", amount: -250.00 },
    { date: "2026-08-04", amount: -160.00 },
    { date: "2026-08-04", amount: totalValue },
  ];
  // Exposed alongside the percentage itself (see analytics.performance
  // below) so a page can show "insufficient history" instead of a
  // fabricated 0% - always true here since the mock always has real
  // cash flows, but the live Supabase path's equivalent flag genuinely
  // varies, and both read the same field name.
  const investorReturnAvailable = xirrCashflows.length >= 2;
  const investorReturnPct = investorReturnAvailable ? Math.round(xirr(xirrCashflows) * 10000) / 100 : 0;

  // currency: real settlement currency per account (BPI Dinâmico is
  // EUR-denominated, the Trading212 sleeve is USD - see the
  // exposure-currency info popover) - carried on portfolio.accounts
  // itself so currencyDrill (shell.js) can match holdings to a currency
  // by real account data instead of a hardcoded account-name check.
  const accounts = [
    { id: "bpi", name: "BPI", currency: "EUR", tone: tokenColor("account", "BPI") },
    { id: "t212", name: "Trading212", currency: "USD", tone: tokenColor("account", "Trading212") },
  ];

  // Real buy amounts, the same figures already cited above (BPI's €250
  // subscription, each T212 ETF's own buy) - not re-typed as a separate
  // "cost basis" number, fed through the one shared costBasisFromTransactions()
  // (calculations.js) every page uses, so this mock and the live Supabase
  // path can never compute Unrealised P&L two different ways. No units
  // recorded here (T212's per-ETF unit counts aren't tracked in this
  // mock, and BPI Dinâmico's fund subscription never had one) - the
  // no-sells branch of that function needs none, so nothing is invented.
  const holdingBuys = {
    "bpi-dinamico": [{ type: "buy", amount: 250.00 }],
    "uetw": [{ type: "buy", amount: 80.00 }],
    "avws": [{ type: "buy", amount: 40.00 }],
    "xdeq": [{ type: "buy", amount: 24.00 }],
    "spym": [{ type: "buy", amount: 16.00 }],
  };

  const holdings = [
    { id: "bpi-dinamico", name: "BPI Dinâmico", ticker: "—", type: "Fund", accountId: "bpi", value: 335.44, weight: 67.71, returnPct: 34.40, tone: tokenColor("asset", "BPI_Dinamico") },
    { id: "uetw", name: "UBS Core MSCI World", ticker: "UETW", type: "ETF", accountId: "t212", value: 80.00, weight: 16.15, returnPct: 0, tone: tokenColor("asset", "UETW") },
    { id: "avws", name: "Avantis Global Small Cap Value", ticker: "AVWS", type: "ETF", accountId: "t212", value: 40.00, weight: 8.07, returnPct: 0, tone: tokenColor("asset", "AVWS") },
    { id: "xdeq", name: "Xtrackers MSCI World Quality", ticker: "XDEQ", type: "ETF", accountId: "t212", value: 24.00, weight: 4.84, returnPct: 0, tone: tokenColor("asset", "XDEQ") },
    { id: "spym", name: "SPDR Emerging Markets", ticker: "SPYM", type: "ETF", accountId: "t212", value: 16.00, weight: 3.23, returnPct: 0, tone: tokenColor("asset", "SPYM") },
  ].map((h) => ({ ...h, ...unrealisedPnL(h.value, costBasisFromTransactions(holdingBuys[h.id] || [])) }));

  const accountAllocation = accounts.map((a) => {
    const value = holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + h.value, 0);
    return { name: a.name, value, weight: Math.round((value / totalValue) * 10000) / 100, tone: a.tone };
  });

  const productAllocation = holdings.map((h) => ({ id: h.id, name: h.name, ticker: h.ticker, weight: h.weight, tone: h.tone }));

  // BPI Dinâmico's real internal asset-class split, from the workbook's
  // Allocations sheet (source: BPI Ficha Mensal, June 2026) - Liquidez
  // 5.67% / Obrigações 36.04% / Ações 37.77% / Outros Investimentos
  // 20.53%, each scaled by BPI's own share of the total portfolio and
  // blended with the Trading212 sleeve (100% equity, a real fact from
  // its own fund fact sheets). Replaces the old single "Mixed Fund"
  // catch-all bucket now that the real breakdown is in the workbook.
  const t212Weight = accountAllocation.find((a) => a.name === "Trading212").weight;
  const bpiWeight = accountAllocation.find((a) => a.name === "BPI").weight;
  const bpiInternalSplit = { Cash: 5.67, Bonds: 36.04, Equities: 37.77, Alternatives: 20.53 };
  const scaledBpi = Object.fromEntries(
    Object.entries(bpiInternalSplit).map(([k, v]) => [k, Math.round((v * bpiWeight / 100) * 100) / 100])
  );
  const assetClassAllocation = [
    { name: "Equities", weight: Math.round((scaledBpi.Equities + t212Weight) * 100) / 100, tone: tokenColor("assetClass", "Equities") },
    { name: "Bonds", weight: scaledBpi.Bonds, tone: tokenColor("assetClass", "Bonds") },
    { name: "Alternatives", weight: scaledBpi.Alternatives, tone: tokenColor("assetClass", "Alternatives") },
    { name: "Cash", weight: scaledBpi.Cash, tone: tokenColor("assetClass", "Cash") },
  ];

  // Geographic exposure - fully real, derived from the workbook's
  // Detailed Portfolio sheet (every security manually classified by
  // issuer/ETF index/fund mandate, never by regulatory category, never
  // guessed) PLUS a real look-through layer: every security whose
  // Exposure Country is a broad mandate (World / Emerging Markets) that
  // genuinely tracks (or, for Trading212's own funds, closely matches)
  // a real published index gets decomposed into that index's own real,
  // dated country weights - sourced from MSCI's official index
  // factsheets (msci.com, Jul 31 2026) and Avantis' own real fund
  // factsheet for AVWS specifically (30 Jun 2026, since it's actively
  // managed and doesn't track an index exactly). This is look-through,
  // not a new classification: the security's Exposure Country/Region
  // in Detailed Portfolio is still "World"/"Emerging Markets" - see the
  // Region tab, which is unaffected by this and still answers "what's
  // this fund's mandate", not "which countries does it hold".
  //
  // Every index factsheet used here only discloses its own top 5
  // countries plus a lump "Other" for the rest (MSCI doesn't publish
  // the full country table on this factsheet) - that residual stays
  // honestly folded into notCountrySpecificWeight below, not guessed at.
  //
  // Still not decomposed: BPI Dinâmico's ~25 actively-managed/thematic
  // "World"/"Europe"/"Emerging Markets" fund-of-fund positions (Big
  // Data, Climate, Health Science, absolute-return, global bond funds,
  // ...) - each would need its own real, individually-researched fund
  // factsheet rather than borrowing an index's, and most are small
  // (<1% each). Real, deliberate scope boundary, not an oversight.
  const countries = [
    { name: "United States", iso: 840, weight: 31.73 },
    { name: "Japan", iso: 392, weight: 4.06 },
    { name: "Spain", iso: 724, weight: 3.71 },
    { name: "Germany", iso: 276, weight: 3.26 },
    { name: "United Kingdom", iso: 826, weight: 1.22 },
    { name: "China", iso: 156, weight: 1.20 },
    { name: "Taiwan", iso: 158, weight: 1.03 },
    { name: "Canada", iso: 124, weight: 0.93 },
    { name: "South Korea", iso: 410, weight: 0.79 },
    { name: "Portugal", iso: 620, weight: 0.73 },
    { name: "France", iso: 250, weight: 0.55 },
    { name: "India", iso: 356, weight: 0.45 },
    { name: "Australia", iso: 36, weight: 0.21 },
    { name: "Netherlands", iso: 528, weight: 0.20 },
    { name: "Sweden", iso: 752, weight: 0.19 },
    { name: "Switzerland", iso: 756, weight: 0.17 },
    { name: "Brazil", iso: 76, weight: 0.16 },
  ];
  const notCountrySpecificWeight = Math.round((100 - countries.reduce((s, c) => s + c.weight, 0)) * 100) / 100;

  // regions: aggregated straight from Exposure Region (same source
  // column, coarser dimension) - not derived from the countries list,
  // since "World"/"Global"/"Unknown" are real region-level facts about
  // holdings that were never country-specific to begin with.
  const regions = [
    { name: "World", weight: 40.09, tone: "purple" },
    { name: "Europe", weight: 33.62, tone: "blue" },
    { name: "North America", weight: 7.81, tone: "orange" },
    { name: "Unknown", weight: 7.62, tone: "grey" },
    { name: "Emerging Markets", weight: 6.19, tone: "green" },
    { name: "Asia", weight: 2.75, tone: "coral" },
    { name: "Global", weight: 1.91, tone: "amber" },
  ];

  // Real: BPI Dinâmico is EUR-denominated, the Trading212 ETF sleeve is
  // USD - this is settlement/account currency, not the underlying
  // economic currency exposure of what each fund actually holds (a
  // world-equity ETF traded in EUR still has real USD/JPY/GBP exposure
  // through its holdings) - that finer breakdown isn't in the workbook.
  const currency = [
    { code: "EUR", weight: bpiWeight, tone: "coral" },
    { code: "USD", weight: t212Weight, tone: "blue" },
  ];

  const transactions = [
    { id: "a1", label: "BPI Dinâmico subscription", date: inceptionDate },
    { id: "a2", label: "Bought UETW", date: "2026-07-01" },
    { id: "a3", label: "Bought AVWS", date: "2026-07-01" },
    { id: "a4", label: "Bought XDEQ", date: "2026-07-01" },
    { id: "a5", label: "Bought SPYM", date: "2026-07-01" },
  ];

  // BPI Dinâmico's real monthly Portfolio Values history (02_Portfolio
  // Workbook.xlsx, "Portfolio Values" sheet) - this WAS the entire
  // portfolio until Trading212 opened on 2026-08-04, so its value alone
  // is the real portfolio value series for every point before that date.
  // `real: true` = an actual dated NAV observation (BPI quarterly
  // report, a BPI/T212 quote, or the subscription itself); `real: false`
  // = linearly interpolated between the two nearest real anchors (see
  // that row's Notes in the workbook for exactly which two) - flagged
  // here so a future chart pass can render interpolated stretches
  // differently instead of pretending every point was observed.
  // Last point is swapped to totalValue: from 2026-08-04 the portfolio
  // also includes the Trading212 sleeve, so this is the one point where
  // "BPI Dinâmico alone" and "whole portfolio" genuinely diverge.
  const valueSeries = [
    { date: "2017-06-21", value: 249.59, real: true }, { date: "2017-07-03", value: 248.58, real: true },
    { date: "2017-07-24", value: 248.58, real: true }, { date: "2017-08-31", value: 249.28, real: false },
    { date: "2017-09-30", value: 249.84, real: false }, { date: "2017-10-31", value: 250.41, real: false },
    { date: "2017-11-30", value: 250.97, real: false }, { date: "2017-12-31", value: 251.55, real: false },
    { date: "2018-01-31", value: 252.12, real: false }, { date: "2018-02-28", value: 252.64, real: false },
    { date: "2018-03-31", value: 253.22, real: false }, { date: "2018-04-30", value: 253.78, real: false },
    { date: "2018-05-31", value: 254.35, real: false }, { date: "2018-06-30", value: 254.91, real: false },
    { date: "2018-07-31", value: 255.49, real: false }, { date: "2018-08-31", value: 256.06, real: false },
    { date: "2018-09-30", value: 256.62, real: false }, { date: "2018-10-31", value: 257.19, real: false },
    { date: "2018-11-30", value: 257.75, real: false }, { date: "2018-12-31", value: 258.33, real: false },
    { date: "2019-01-31", value: 258.90, real: false }, { date: "2019-02-28", value: 259.42, real: false },
    { date: "2019-03-31", value: 260.00, real: false }, { date: "2019-04-30", value: 260.56, real: false },
    { date: "2019-05-31", value: 261.13, real: false }, { date: "2019-06-30", value: 261.69, real: false },
    { date: "2019-07-31", value: 262.27, real: false }, { date: "2019-08-31", value: 262.84, real: false },
    { date: "2019-09-30", value: 263.40, real: false }, { date: "2019-10-31", value: 263.98, real: false },
    { date: "2019-11-30", value: 264.53, real: false }, { date: "2019-12-31", value: 265.11, real: false },
    { date: "2020-01-31", value: 265.68, real: false }, { date: "2020-02-29", value: 266.22, real: false },
    { date: "2020-03-31", value: 266.80, real: false }, { date: "2020-04-30", value: 267.36, real: false },
    { date: "2020-05-31", value: 267.93, real: false }, { date: "2020-06-30", value: 268.49, real: false },
    { date: "2020-07-31", value: 269.07, real: false }, { date: "2020-08-31", value: 269.64, real: false },
    { date: "2020-09-30", value: 270.20, real: false }, { date: "2020-10-31", value: 270.77, real: false },
    { date: "2020-11-30", value: 271.33, real: false }, { date: "2020-12-31", value: 271.91, real: false },
    { date: "2021-01-31", value: 272.48, real: false }, { date: "2021-02-28", value: 273.00, real: false },
    { date: "2021-03-31", value: 273.58, real: false }, { date: "2021-04-30", value: 274.14, real: false },
    { date: "2021-05-31", value: 274.71, real: false }, { date: "2021-06-30", value: 275.27, real: false },
    { date: "2021-07-31", value: 275.85, real: false }, { date: "2021-08-31", value: 276.42, real: false },
    { date: "2021-09-30", value: 276.98, real: false }, { date: "2021-10-31", value: 277.55, real: false },
    { date: "2021-11-30", value: 278.11, real: false }, { date: "2021-12-31", value: 278.69, real: false },
    { date: "2022-01-31", value: 279.26, real: false }, { date: "2022-02-28", value: 279.78, real: false },
    { date: "2022-03-31", value: 280.36, real: true }, { date: "2022-04-30", value: 274.74, real: false },
    { date: "2022-05-31", value: 268.92, real: false }, { date: "2022-06-30", value: 263.30, real: true },
    { date: "2022-07-31", value: 261.04, real: false }, { date: "2022-08-31", value: 258.78, real: false },
    { date: "2022-09-30", value: 256.60, real: true }, { date: "2022-10-31", value: 256.75, real: false },
    { date: "2022-11-30", value: 256.90, real: false }, { date: "2022-12-31", value: 257.05, real: true },
    { date: "2023-01-31", value: 259.07, real: false }, { date: "2023-02-28", value: 260.89, real: false },
    { date: "2023-03-31", value: 262.91, real: true }, { date: "2023-04-30", value: 263.96, real: false },
    { date: "2023-05-31", value: 265.05, real: false }, { date: "2023-06-30", value: 266.10, real: true },
    { date: "2023-07-31", value: 265.16, real: false }, { date: "2023-08-31", value: 264.23, real: false },
    { date: "2023-09-30", value: 263.32, real: true }, { date: "2023-10-31", value: 267.49, real: false },
    { date: "2023-11-30", value: 271.54, real: false }, { date: "2023-12-31", value: 275.71, real: true },
    { date: "2024-01-31", value: 279.39, real: false }, { date: "2024-02-29", value: 282.84, real: false },
    { date: "2024-03-31", value: 286.52, real: true }, { date: "2024-04-30", value: 287.34, real: false },
    { date: "2024-05-31", value: 288.19, real: false }, { date: "2024-06-30", value: 289.01, real: true },
    { date: "2024-07-31", value: 291.23, real: false }, { date: "2024-08-31", value: 293.45, real: false },
    { date: "2024-09-30", value: 295.60, real: true }, { date: "2024-10-31", value: 296.56, real: false },
    { date: "2024-11-30", value: 297.49, real: false }, { date: "2024-12-31", value: 298.45, real: true },
    { date: "2025-01-31", value: 300.47, real: false }, { date: "2025-02-28", value: 302.30, real: false },
    { date: "2025-03-31", value: 304.33, real: false }, { date: "2025-04-30", value: 306.29, real: false },
    { date: "2025-05-31", value: 308.31, real: false }, { date: "2025-06-30", value: 310.27, real: false },
    { date: "2025-07-31", value: 312.30, real: false }, { date: "2025-08-31", value: 314.32, real: false },
    { date: "2025-09-30", value: 316.28, real: false }, { date: "2025-10-31", value: 318.31, real: false },
    { date: "2025-11-30", value: 320.27, real: false }, { date: "2025-12-31", value: 322.29, real: false },
    { date: "2026-01-31", value: 324.32, real: false }, { date: "2026-02-28", value: 326.15, real: false },
    { date: "2026-03-31", value: 328.17, real: false }, { date: "2026-04-30", value: 330.13, real: false },
    { date: "2026-05-31", value: 332.16, real: false }, { date: "2026-06-30", value: 334.12, real: false },
    { date: "2026-07-31", value: 336.14, real: true }, { date: "2026-08-04", value: 335.44, real: true },
  ];
  // Deliberately NOT totalValue here: this series is a return trajectory
  // (BPI Dinâmico's own value, cash-flow neutral - see totalReturnPct
  // above), not "everything currently held". Ending it at totalValue
  // would draw a fake jump for the T212 lump sum, which hasn't earned
  // anything yet - exactly the "just deposit money and it looks like
  // performance" distortion this whole fix exists to avoid.

  // Same calendar-year breakdown the live path computes
  // (calculations.js:annualReturns()) - reused here, not a second
  // formula, so Showcase and Private show the same kind of number even
  // though the underlying series differs. Single pseudo-security (this
  // whole series already IS the cash-flow-neutral trajectory above), one
  // cash flow at inception, matching the mock's own real fact ("exactly
  // one cash flow, the 2017 subscription, no interim contributions").
  const yearlyReturns = window.annualReturns
    ? window.annualReturns(
        { series: valueSeries.map((p) => ({ date: p.date, value_eur: p.value })) },
        [inceptionDate],
        valueSeries[valueSeries.length - 1].date,
        inceptionDate
      )
    : {};

  const largest = [...holdings].sort((a, b) => b.weight - a.weight)[0];
  const health = {
    holdingsCount: holdings.length,
    accountsCount: accounts.length,
    transactionsCount: transactions.length,
    countriesCount: countries.length,
    assetClassesCount: assetClassAllocation.length,
    currenciesCount: currency.length,
    largestPosition: { name: largest.name, weight: largest.weight },
    cashRatio: Math.round((cash / totalValue) * 10000) / 100,
  };

  return {
    portfolio: { holdings, accounts, cash, transactions },
    // marketData: real per-security price history (js/db.js:
    // getHistoricalPrices(), backed by daily_prices) - genuinely empty
    // here, not a stub to fill in later. Showcase/mock has no live
    // market-data provider behind it and never will (see EODHD's own
    // ToS - real provider data stays Private-only); Phase 2/3 UI must
    // treat an empty marketData map as "no market-data feed for this
    // mode", the same honest gap this file already applies everywhere
    // else (e.g. totalReturnAvailable, investorReturnAvailable).
    history: { valueSeries, inceptionDate, benchmarks: null, marketData: {} },
    analytics: {
      assetClassAllocation,
      productAllocation,
      accountAllocation,
      regions,
      countries,
      notCountrySpecificWeight,
      currency,
      health,
      performance: {
        totalValue,
        investedCapital,
        unrealisedGain,
        // Simple gain ÷ invested, as its own honestly-labeled figure
        // ("Unrealised Gain %") - NOT a stand-in for totalReturnPct
        // (TWR). Kept distinct on purpose: this one legitimately does
        // move when capital is added/withdrawn (it's answering "what
        // fraction of my money is currently profit", not "how did the
        // investment perform") - conflating the two was the original bug.
        unrealisedGainPct: Math.round((unrealisedGain / investedCapital) * 10000) / 100,
        totalReturnPct,
        // Real, dated NAV history exists for the whole series (see
        // valueSeries below) - always true in the mock, unlike the live
        // path where it genuinely depends on how many Valuations exist.
        totalReturnAvailable: true,
        investorReturnPct,
        investorReturnAvailable,
        yearlyReturns,
        todayChange,
        todayChangePct,
        cash,
      },
    },
    settings: { currency: "EUR", benchmark: null, timezone: "Europe/Lisbon" },
    metadata: { lastUpdated: new Date().toISOString(), source: "mock", version: "1.0.0" },
  };
}

window.getPortfolioData = getPortfolioData;
window.getMockPortfolioData = getMockPortfolioData;
