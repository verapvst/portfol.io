/* ============================================================
   analytics.js - Migration Plan Phase 3: Overview reads Supabase
   directly instead of repository.js's hand-kept mirror.

   getPortfolioDataLive() returns the EXACT same contract shape as
   repository.js's getMockPortfolioData() (see that file's header comment
   for the full shape) - ui.js/app.js/charts.js need zero changes, the
   seam repository.js's own comment describes ("UI -> repository ->
   mock | Excel parser | API") is exactly what this file now sits behind.

   Deliberate, honest boundary - NOT everything below is computed from
   Supabase: countries, regions and notCountrySpecificWeight still come
   from repository.js's real data, because their source (the Detailed
   Portfolio / Security Classifications sheets) hasn't been migrated to
   Supabase yet (Migration Plan §2.6/§3.4, Phase 4-5). Per the workbook
   doc's own Dashboard Principle - "if a metric cannot be derived from
   the database, the missing data belongs in the database, not the
   dashboard" - faking a Supabase-only version of these would mean
   either recomputing something coarser than what's already real and
   known, or inventing structure that isn't there. repository.js doesn't
   disappear yet; it shrinks to cover only what hasn't migrated, exactly
   as much as is still true and no more. It disappears entirely once
   Phase 4/5 land.

   assetClassAllocation moved OFF that static list (this session,
   2026-08-28) - see computeAssetClassAllocation()/
   SECURITY_ASSET_CLASS_SPLIT below: it's now computed fresh from real,
   live portfolio.holdings weights blended with each specific security's
   own known composition, kept separate per holding rather than one
   static portfolio-level snapshot. Not the full Phase 4/5 migration
   (that reads real composition from Data Hub's own
   security_details.top_holdings/all_holdings uploads, still not wired
   up) - a smaller, honest interim step using known real facts about
   each security, that fixed a genuine bug (BPI Dinâmico and BPI
   Universal, two different funds, were being silently blended into one
   number) without waiting for that larger migration.
   ============================================================ */

/** Loads real benchmark reference data + history (supabase/migrations/
    0016_benchmark_and_fx_history.sql, Performance & Benchmark Engine
    plan). Public, non-portfolio-scoped data - safe to call regardless
    of auth state (RLS grants anon+authenticated read). Wrapped in its
    own try/catch so a benchmark-load failure (network hiccup, RLS
    misconfiguration) never breaks the rest of the page - degrades to
    null, the same honest "not available" the UI already knows how to
    render, never a fabricated line.

    Returns null on failure, or an array of
    { id, name, symbol, instrumentType, dataType, currency, series } -
    `series` is the benchmark's OWN raw {date, value, real:true,
    frequency} history (value = index_level, e.g. real SPX/NDX levels,
    not an ETF price - see db.js's own header comment), unclipped
    against the portfolio and not yet normalized. Clipping to the
    overlapping real window (calculations.js:clipToCommonWindow()) and
    rebasing to 100 (indexValueSeries()) happens at render time, per
    page, since which series are actually being compared depends on
    which checkboxes are ticked there - this function's only job is to
    fetch the real data once. frequency is carried through per-point
    (today: 'monthly' throughout, from the historical CSV import,
    0019) so nothing downstream has to infer coverage density from
    point spacing or silently assume daily. */
async function loadBenchmarkSeries() {
  try {
    const benchmarks = await loadBenchmarks();
    const histories = await Promise.all(benchmarks.map((b) => getBenchmarkHistory(b.id)));
    return benchmarks.map((b, i) => ({
      id: b.id,
      name: b.name,
      symbol: b.symbol,
      instrumentType: b.instrument_type,
      // The live-tracking proxy this benchmark is displayed under the
      // same name with (0028_benchmark_proxy_automation.sql) - e.g.
      // "S&P 500" stays "S&P 500" everywhere in the UI, this is only
      // the methodology footnote ("tracked using SPY"). Null until a
      // proxy is configured for this benchmark.
      proxySymbol: b.proxy_symbol,
      dataType: b.data_type,
      currency: b.currency,
      // symbol/instrumentType carried PER POINT (from benchmark_history,
      // not the benchmarks row above) - a single benchmark's series can
      // span a frozen real-index-level segment (SPX/NDX) and a later
      // SPY/QQQ proxy segment. calculations.js:indexValueSeries() reads
      // these per point to detect exactly where that switch happens and
      // chain-link across it instead of dividing incompatible scales.
      series: histories[i].map((row) => ({
        date: row.date,
        priceDate: row.price_date,
        value: row.index_level,
        real: true,
        frequency: row.frequency,
        symbol: row.symbol,
        instrumentType: row.instrument_type,
      })),
    }));
  } catch (err) {
    console.warn("Benchmark data unavailable:", err);
    return null;
  }
}

/** Known real per-security asset-class composition - NOT computed from
    live position data (no pipeline for that exists yet; see this file's
    header comment on assetClassAllocation/regions/countries/currency
    still being repository.js's not-yet-migrated static import). Real,
    sourced facts about each specific fund/ETF, kept separate PER
    SECURITY on purpose - blending BPI Dinâmico and BPI Universal
    (Fundo) into one number was exactly the bug the app owner caught
    2026-08-28: repository.js's old bpiInternalSplit was BPI Dinâmico's
    own real June-2026-factsheet split, but got scaled by the WHOLE BPI
    account's weight (both funds combined) as if it were the account's
    one single blended split - a leftover from when BPI Dinâmico was the
    only BPI holding, silently wrong the moment BPI Universal became a
    second one. Replace an entry here with real composition data the
    moment it's available via Data Hub's BPI Monthly Factsheet/Detailed
    Portfolio upload (security_details.top_holdings/all_holdings, 0011/
    0012 - already wired to write real data, just not yet wired to be
    READ back into this computation, a separate, larger piece of work)
    - this lookup is the honest interim source until then, matched by
    ticker first (stable), falling back to name for the two BPI funds
    that have none. A holding with no entry here falls into
    "Unclassified" in computeAssetClassAllocation() below, never a
    guessed split. */
const SECURITY_ASSET_CLASS_SPLIT = {
  // BPI Dinâmico - real, from its own June 2026 monthly factsheet (BPI
  // Ficha Mensal): Liquidez 5.67% / Obrigações 36.04% / Ações 37.77% /
  // Outros Investimentos 20.53%.
  "BPI Dinâmico": { source: "BPI Ficha Mensal, Jun 2026", split: { Equities: 37.77, Bonds: 36.04, Alternatives: 20.53, Cash: 5.67 } },
  // BPI Universal (Fundo) - its declared benchmark mandate (60% MSCI
  // World / 40% Euro Bond, supabase/migrations/
  // 0006_seed_products_and_brokers.sql) - real, but a different
  // provenance from BPI Dinâmico's own live-factsheet number above
  // (a target mandate, not a monthly actual holding breakdown), kept
  // labelled as such wherever this is shown.
  "BPI Universal (Fundo)": { source: "Declared benchmark mandate (60/40)", split: { Equities: 60, Bonds: 40, Alternatives: 0, Cash: 0 } },
  // Trading 212 ETFs - each a real equity index/factor tracker, 100%
  // equity by construction (their own fund fact sheets) - matched by
  // ticker, more stable than a display name that can pick up suffixes
  // like "(Acc)" over time.
  UETW: { source: "Fund fact sheet (index tracker)", split: { Equities: 100, Bonds: 0, Alternatives: 0, Cash: 0 } },
  AVWS: { source: "Fund fact sheet (factor ETF)", split: { Equities: 100, Bonds: 0, Alternatives: 0, Cash: 0 } },
  XDEQ: { source: "Fund fact sheet (factor ETF)", split: { Equities: 100, Bonds: 0, Alternatives: 0, Cash: 0 } },
  SPYM: { source: "Fund fact sheet (index tracker)", split: { Equities: 100, Bonds: 0, Alternatives: 0, Cash: 0 } },
};

/** Blends every currently-held security's own known composition
    (SECURITY_ASSET_CLASS_SPLIT above), weighted by that security's REAL
    LIVE portfolio weight - replaces the old static repository.js
    snapshot for this one field. Each class carries `byHolding` (per-
    security contribution + its own source) so shell.js's
    assetClassDrill() can show BPI Dinâmico and BPI Universal (or any
    other two holdings sharing a class) as genuinely separate rows with
    real numbers, instead of one hand-derived "whatever's left over"
    approximation. A holding with no known composition contributes to
    "Unclassified" instead of a guess - same honesty rule as everywhere
    else in this app. */
function computeAssetClassAllocation(holdings) {
  const CLASSES = ["Equities", "Bonds", "Alternatives", "Cash"];
  const perClass = Object.fromEntries(CLASSES.map((c) => [c, { total: 0, byHolding: [] }]));
  const unclassified = { total: 0, byHolding: [] };

  for (const h of holdings) {
    const known = SECURITY_ASSET_CLASS_SPLIT[h.ticker] || SECURITY_ASSET_CLASS_SPLIT[h.name];
    if (!known) {
      unclassified.total = Math.round((unclassified.total + h.weight) * 100) / 100;
      unclassified.byHolding.push({ name: h.name, weight: h.weight, source: "No known composition yet" });
      continue;
    }
    for (const cls of CLASSES) {
      const pct = known.split[cls] || 0;
      if (pct <= 0) continue;
      const contribution = Math.round((pct * h.weight / 100) * 100) / 100;
      if (contribution <= 0) continue;
      perClass[cls].total = Math.round((perClass[cls].total + contribution) * 100) / 100;
      perClass[cls].byHolding.push({ name: h.name, weight: contribution, source: known.source });
    }
  }

  const out = CLASSES.map((c) => ({
    name: c,
    weight: perClass[c].total,
    tone: tokenColor("assetClass", c),
    byHolding: perClass[c].byHolding.sort((a, b) => b.weight - a.weight),
  })).filter((c) => c.weight > 0);

  if (unclassified.total > 0) {
    out.push({
      name: "Unclassified", weight: unclassified.total, tone: tokenColor("assetClass", "Unclassified"),
      byHolding: unclassified.byHolding,
    });
  }
  return out;
}

/** Real, privacy-safe "Investment journey" milestones for the public
    Overview (recruiter-readiness audit §7/§12) - built ONLY from
    public_cash_flow_dates()'s own {date, type} shape (no security, no
    amount - never crosses that function's own privacy boundary).
    "Diversification" is detected, not invented: the real date with the
    most simultaneous 'buy' events IS a genuine fact ("several positions
    opened the same day"), derivable from type+date alone without ever
    naming what was bought. Returns [] when there's no real cash-flow
    data to build from yet (never a placeholder milestone). */
function computePublicMilestones(flows, inceptionDate) {
  if (!flows.length || !inceptionDate) return [];
  const milestones = [{ date: inceptionDate, label: "Portfolio inception" }];

  const buysByDate = new Map();
  for (const f of flows) {
    if (f.type !== "buy") continue;
    buysByDate.set(f.date, (buysByDate.get(f.date) || 0) + 1);
  }
  let busiestDate = null;
  let busiestCount = 0;
  for (const [date, count] of buysByDate.entries()) {
    if (count > busiestCount) { busiestDate = date; busiestCount = count; }
  }
  if (busiestDate && busiestDate !== inceptionDate && busiestCount >= 2) {
    milestones.push({ date: busiestDate, label: `Diversified into ${busiestCount} new holdings` });
  }

  const lastDate = flows[flows.length - 1]?.date;
  if (lastDate && lastDate !== inceptionDate && lastDate !== busiestDate) {
    milestones.push({ date: lastDate, label: "Most recent recorded activity" });
  }

  return milestones.sort((a, b) => a.date.localeCompare(b.date));
}

async function getPortfolioDataLive() {
  const portfolioId = await ensurePortfolio();
  if (!portfolioId) throw new Error("No portfolio for the current user.");

  const [accountsRows, securitiesRows, txnRows, valRows, costRows] = await Promise.all([
    loadAccountsForPortfolio(portfolioId),
    loadSecurities(),
    window.db.from("transactions").select("*").eq("portfolio_id", portfolioId).eq("voided", false),
    window.db.from("valuations").select("*").eq("portfolio_id", portfolioId),
    getCosts(portfolioId),
  ]);
  const transactionsRaw = txnRows.data || [];
  const valuationsRaw = valRows.data || [];
  if (txnRows.error) throw txnRows.error;
  if (valRows.error) throw valRows.error;

  const securityById = Object.fromEntries(securitiesRows.map((s) => [s.id, s]));
  const accountById = Object.fromEntries(accountsRows.map((a) => [a.id, a]));

  // ---------- Current position per security ----------
  // Value = the security's own latest valuation (already a total EUR
  // position value in this schema, not a per-unit price - see Migration
  // Plan §2.5). Units = summed from Transactions, kept for display only.
  const valuationsBySecurity = new Map();
  for (const v of valuationsRaw) {
    const list = valuationsBySecurity.get(v.security_id) || [];
    list.push(v);
    valuationsBySecurity.set(v.security_id, list);
  }
  // Tie-break by created_at, not just date: the valuations query above
  // has no ORDER BY, so Postgres/PostgREST gives no guarantee about the
  // order two same-date rows arrive in - without this, "the latest
  // value" for a date with more than one observation (a correction
  // superseding a stale row, e.g.) would resolve non-deterministically,
  // flipping between page loads. Real incident: BPI Universal got a
  // stale value_eur=0 "auto: full exit" row and a same-day correction -
  // both dated 2026-08-23, only created_at tells them apart.
  for (const list of valuationsBySecurity.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || "").localeCompare(b.created_at || ""));
  }

  const unitsBySecurity = new Map();
  const accountBySecurity = new Map(); // last account a security was transacted through
  for (const t of transactionsRaw) {
    const sign = t.type === "sell" ? -1 : t.type === "buy" ? 1 : 0;
    unitsBySecurity.set(t.security_id, (unitsBySecurity.get(t.security_id) || 0) + sign * (t.units || 0));
    accountBySecurity.set(t.security_id, t.account_id);
  }

  const positionSecurityIds = new Set([...valuationsBySecurity.keys(), ...unitsBySecurity.keys()]);
  const holdingsRaw = [...positionSecurityIds]
    .map((secId) => {
      const security = securityById[secId];
      if (!security) return null;
      const history = valuationsBySecurity.get(secId) || [];
      const latest = history[history.length - 1];
      if (!latest) return null;
      return { security, accountId: accountBySecurity.get(secId), value: latest.value_eur, history };
    })
    .filter(Boolean);

  const totalValue = Math.round(holdingsRaw.reduce((s, h) => s + h.value, 0) * 100) / 100;

  // ---------- Invested capital, cash ----------
  const investedCapital = Math.round(
    transactionsRaw.filter((t) => t.type === "buy").reduce((s, t) => s + Number(t.amount || 0), 0) * 100
  ) / 100;
  const cashHolding = holdingsRaw.find((h) => h.security.type === "Cash");
  const cash = cashHolding ? cashHolding.value : 0;

  // ---------- Contributions vs. withdrawals ----------
  // External cash movement only (type 'deposit'/'withdrawal', against
  // the Cash security - see 0001_initial_schema.sql), deliberately NOT
  // buy/sell - those already have their own meaning above
  // (investedCapital), and counting a buy as a "contribution" too would
  // double-count money that was deposited, then invested, as two
  // separate contribution events. Real amounts, gated the same way
  // every other € figure on this drawer already is (formatMoney/
  // isOwnerMode() in shell.js) - nothing new to gate here.
  const contributionsTotal = Math.round(
    transactionsRaw.filter((t) => t.type === "deposit").reduce((s, t) => s + Number(t.amount || 0), 0) * 100
  ) / 100;
  const withdrawalsTotal = Math.round(
    transactionsRaw.filter((t) => t.type === "withdrawal").reduce((s, t) => s + Number(t.amount || 0), 0) * 100
  ) / 100;

  // ---------- Combined value series (every date any holding has a real
  // observation) ----------
  // real:true throughout - each point is a genuine point-in-time total
  // (sum of valueOfSecurityAsOf() across every holding, nearest-prior -
  // calculations.js), never a fabricated smoothing point. This replaces
  // the old single-driver series (one holding's own points only) with
  // the SAME density, correctly summed with whatever else was actually
  // in the portfolio on each of those dates - richer, not coarser, and
  // still never interpolated on the live path (exactly as before).
  const securityHistories = Object.fromEntries(holdingsRaw.map((h) => [h.security.id, h.history]));
  const allObservationDates = [...new Set(valuationsRaw.map((v) => v.date))].sort();

  // ---------- Real per-security market data (db.js: getHistoricalPrices())
  // ----------
  // Only for securities EODHD (or any future provider) actually covers -
  // data_provider_symbol null means "not exchange-traded / not yet
  // verified" (see 0004_daily_prices.sql), not an error, so those are
  // silently skipped rather than queried for nothing. Kept as its own
  // history.marketData map, deliberately NOT merged into holdingsRaw's
  // .history (valuations - position value) - Phase 2/3 build security-
  // level returns/UI on top of this; nothing reads it yet.
  const trackedSecurityIds = securitiesRows.filter((s) => s.data_provider_symbol).map((s) => s.id);
  const marketDataLists = await Promise.all(trackedSecurityIds.map((id) => getHistoricalPrices(id)));
  const marketData = Object.fromEntries(trackedSecurityIds.map((id, i) => [id, marketDataLists[i]]));
  const valueSeries = allObservationDates.map((date) => ({
    date,
    value: Math.round(Object.values(securityHistories).reduce((s, h) => s + valueOfSecurityAsOf(h, date), 0) * 100) / 100,
    real: true,
  }));

  // ---------- TWR (cash-flow-neutral, calculations.js: scopedPerformance())
  // ----------
  // Performance & Benchmark Engine plan, section C: replaces the old
  // chainLinkedPortfolioReturn() call (still kept, untouched, for
  // whatever else references it - see that function's own updated
  // header comment for why it wasn't rewritten in place). Boundaries
  // here are real valuation-observation dates, never a cash-flow-only
  // date with nothing observed there - the bug the old function had,
  // confirmed against a live worked example (plan doc section B): a
  // deposit landing between two valuations used to get counted almost
  // entirely as return. Any deposit/withdrawal/buy/sell inside an
  // interval is isolated via Modified Dietz weighting instead.
  //
  // externalTypes: PORTFOLIO_EXTERNAL_CASH_FLOW_TYPES (calculations.js) -
  // deposit/withdrawal only. A buy/sell moves money from cash into a
  // security WITHIN the same portfolio, never across the portfolio's
  // own boundary, so it must not be treated as external here (that was
  // the deferred refinement this comment used to describe as
  // "needing validation first" - validated against Vera's own real
  // data, now the default at this scope). Account/security-level calls
  // elsewhere in this file deliberately keep the wider default - see
  // their own comments for why a buy IS external at those scopes.
  const latestDate = allObservationDates[allObservationDates.length - 1] || "0000-00-00";
  const portfolioPerformance = scopedPerformance({
    level: "portfolio", securityHistories, transactions: transactionsRaw, asOfDate: latestDate,
    externalTypes: PORTFOLIO_EXTERNAL_CASH_FLOW_TYPES,
  });
  const totalReturnAvailable = portfolioPerformance.totalReturnAvailable;
  const totalReturnPct = totalReturnAvailable ? portfolioPerformance.totalReturnPct : 0;

  // inceptionDate now means "the earliest date the displayed TWR figure
  // is actually measured from" (the first real valuation observation),
  // not "the first cash flow" as before - the two coincided under the
  // old cash-flow-only-boundary engine by construction, but the new
  // engine's return series can only ever start at a real observation
  // (see chainLinkedReturn()'s own comment: a cash flow dated before any
  // observation is silently outside every sub-period, per this app's
  // no-fabrication discipline). Keeping "since {inceptionDate}"
  // (shell.js/app.js/performance.js/ui.js) honestly matched to where
  // the number actually starts, not to an earlier date the calculation
  // never actually used.
  const inceptionDate = portfolioPerformance.firstDate;

  // Calendar-year breakdown - same chain-linking primitive, sliced at
  // Dec-31/Jan-1 boundaries (calculations.js:scopedAnnualReturns()), not
  // a second calculation method - and Node-verified to chain back to
  // portfolioPerformance.totalReturnPct exactly (scratchpad/validate_engine.js).
  const yearlyReturns = inceptionDate
    ? scopedAnnualReturns({
        securityHistories, transactions: transactionsRaw, asOfDate: latestDate, inceptionDate,
        externalTypes: PORTFOLIO_EXTERNAL_CASH_FLOW_TYPES,
      })
    : {};

  // ---------- XIRR ----------
  // Same generic solver as repository.js (window.xirr, still loaded) -
  // every real, non-backfill transaction is a dated cash flow, current
  // total value is the hypothetical terminal one, on the latest
  // valuation date across all holdings.
  //
  // is_backfill (0026) transactions are excluded here on purpose - a
  // backfill deposit/buy records capital that already existed before
  // this app tracked it (a CSV import with no purchase transaction
  // behind it, or a cash balance recognized after the fact), not real
  // money leaving your pocket on that date. XIRR is money-weighted, so
  // counting it as a normal cash flow would demand an unrealistic
  // annualised rate to reconcile a large "contribution" that isn't
  // actually new. TWR is unaffected - deposit/withdrawal stay external
  // regardless of this flag, since TWR only needs to know it's capital,
  // not why it's being recorded now.
  const cashflows = [
    ...transactionsRaw
      .filter((t) => ["buy", "deposit"].includes(t.type) && !t.is_backfill)
      .map((t) => ({ date: t.date, amount: -Number(t.amount || 0) })),
    ...transactionsRaw
      .filter((t) => ["sell", "withdrawal", "dividend"].includes(t.type) && !t.is_backfill)
      .map((t) => ({ date: t.date, amount: Number(t.amount || 0) })),
    { date: latestDate, amount: totalValue },
  ].sort((a, b) => a.date.localeCompare(b.date));
  // Exposed alongside the percentage (analytics.performance below) so a
  // page shows "insufficient history" instead of a fabricated 0% when
  // there aren't yet 2 real cash flows to solve XIRR from - genuinely
  // varies here, unlike the mock's always-true equivalent.
  const investorReturnAvailable = cashflows.length >= 2;
  const investorReturnPct = investorReturnAvailable ? Math.round(xirr(cashflows) * 10000) / 100 : 0;

  const unrealisedGain = Math.round((totalValue - investedCapital) * 100) / 100;
  const unrealisedGainPct = investedCapital ? Math.round((unrealisedGain / investedCapital) * 10000) / 100 : 0;

  // ---------- Holdings / allocation views ----------
  // Cost basis / Unrealised P&L: grouped straight from the same real
  // transactionsRaw already loaded above, through the one shared
  // costBasisFromTransactions()/unrealisedPnL() (calculations.js) that
  // repository.js's mock also calls - Portfolio Detail (and whatever
  // reads holdings after it) gets identical figures regardless of which
  // backend answered getPortfolioDataAuto().
  const txnsBySecurity = new Map();
  for (const t of transactionsRaw) {
    const list = txnsBySecurity.get(t.security_id) || [];
    list.push(t);
    txnsBySecurity.set(t.security_id, list);
  }

  // Each holding's OWN cash-flow-neutral return (calculations.js:
  // scopedPerformance(), level:'security') - a genuinely different
  // question from the portfolio-level TWR above. Replaces the old naive
  // first-vs-last comparison: that was only mathematically exact while
  // every position was a single lot bought once - the moment a security
  // gets a second purchase, a first-vs-last comparison would count that
  // new money as return (plan doc section 8's own example: buying €250
  // more of a holding must not read as "+250%"). scopedPerformance()
  // uses that security's own buy/sell transactions as its cash-flow
  // boundaries (Vera's own stated principle: "buy IS a cash flow into
  // that security"), so this is correct in general, not just today.
  // Still a genuinely different question from the security's own
  // market-price return (securityMarketAnalytics(), calculations.js) -
  // see docs/implementation-roadmap.md's Performance & Analytics
  // Architecture section for why those aren't the same concept.
  // Excludes a fully-exited position (latest valuation = 0, either
  // auto-closed by a full Sell - transactions.js - or manually zeroed
  // via Update Portfolio) from the CURRENT holdings list - it should
  // no longer read as something you own. securityHistories/valueSeries
  // above are built from the unfiltered holdingsRaw on purpose: past
  // dates must keep counting this security's real historical value,
  // only its current-and-forward contribution should ever be 0 - which
  // it already is by construction once that closing valuation exists,
  // so totalValue needs no separate adjustment here.
  const shapeHolding = (h) => {
    const securityTransactions = txnsBySecurity.get(h.security.id) || [];
    const securityPerformance = scopedPerformance({
      level: "security",
      securityHistories: { [h.security.id]: h.history },
      transactions: securityTransactions,
      asOfDate: latestDate,
    });
    return {
      id: h.security.id,
      name: h.security.name,
      ticker: h.security.ticker || "—",
      type: h.security.type,
      accountId: h.accountId,
      value: h.value,
      weight: totalValue ? Math.round((h.value / totalValue) * 10000) / 100 : 0,
      // returnPct keeps the existing 0-when-unavailable fallback so
      // today's holdings table/UI (which just formats a number) doesn't
      // need to change in this phase; returnAvailable is exposed
      // alongside it for the "Insufficient history" UI this plan's data-
      // quality requirement calls for, once that UI work happens.
      returnPct: securityPerformance.totalReturnAvailable ? securityPerformance.totalReturnPct : 0,
      returnAvailable: securityPerformance.totalReturnAvailable,
      ...unrealisedPnL(h.value, costBasisFromTransactions(securityTransactions)),
      tone: tokenColor("asset", h.security.name.replace(/[^a-zA-Z0-9]/g, "_")),
    };
  };
  // allHoldings: EVERY position ever held, including a fully-exited one
  // (current value now €0, e.g. BPI Universal). product-detail.js's
  // "Your Position" and shell.js's drill-down drawer (holdingDrill())
  // read THIS, not the filtered `holdings` below - otherwise a closed
  // position's detail view silently rendered nothing at all the moment
  // its value hit 0, instead of an honest "you held this, here's how it
  // did" (real bug, caught 2026-08-28 - same class of issue the
  // accountPerformance/securityPerformance/strategyPerformance fix above
  // already addressed for the Performance page's scope selector).
  const allHoldings = holdingsRaw.map(shapeHolding);
  const holdings = allHoldings.filter((h) => h.value !== 0);

  // currency/institution/accountType/jurisdiction all carried through
  // from the real accounts row already fetched above (loadAccountsForPortfolio,
  // db.js - the same query accounts.js itself reads) - no second query,
  // just no longer dropping fields that were already in memory. currency
  // matches accounts.js/currencyDrill's own real-data precedent; the
  // other three feed shell.js:accountDrill()'s preview. Public mode's
  // own accounts source (public_accounts() RPC, 0013) deliberately
  // returns id/name/currency only, so institution/accountType/
  // jurisdiction are naturally absent there - nothing to gate here.
  const accounts = accountsRows.map((a) => ({
    id: a.id, name: a.name, currency: a.currency, tone: tokenColor("account", a.name),
    institution: a.institutions?.name || null, accountType: a.account_type || null, jurisdiction: a.jurisdiction || null,
  }));

  // ---------- Account-level performance (BPI vs Trading 212, etc.) ----------
  // Performance & Benchmark Engine plan, section C/H: "account" is the
  // confirmed sub-portfolio grouping level (no separate portfolios
  // table - one portfolio per user stays true). Same scopedPerformance()
  // engine as the portfolio total above, just re-scoped: securityHistories
  // filtered to this account's own holdings, transactions filtered to
  // this account_id. Unlike the portfolio-level scope, externalTypes
  // here was never in question - a buy IS a cash flow crossing INTO
  // this account even when the money came from elsewhere in the same
  // portfolio, so the default (deposit/withdrawal/buy/sell) applies
  // as-is, no override needed.
  const accountPerformance = accounts.map((a) => {
    // holdingsRaw here, deliberately NOT holdings - holdings is filtered
    // to value !== 0 (see its own comment above) for "what do I
    // currently own" UI (Holdings Table/Allocation), and a fully closed/
    // redeemed position's CURRENT value correctly hits 0 there. But its
    // real historical valuations still exist and this account's own
    // Total Return must keep counting them - reusing the filtered array
    // here silently erased a closed position's ENTIRE account-scoped
    // history the moment its value hit 0, not just its current-and-
    // forward contribution (real bug: BPI's account scope showed
    // "Insufficient history" despite 9 real years of BPI Dinâmico data,
    // the moment BPI Dinâmico's balance went to €0 on the ETF move).
    const accountSecurityIds = holdingsRaw.filter((h) => h.accountId === a.id).map((h) => h.security.id);
    const accountSecurityHistories = Object.fromEntries(
      accountSecurityIds.map((id) => [id, securityHistories[id] || []])
    );
    const accountTransactions = transactionsRaw.filter((t) => t.account_id === a.id);
    const perf = scopedPerformance({
      level: "account", securityHistories: accountSecurityHistories, transactions: accountTransactions, asOfDate: latestDate,
      // A brand-new account (e.g. Trading 212's first ~11 days) can
      // technically compute a real return the moment it has 2
      // observations - correct, but overconfident to headline. Gated
      // here, not at portfolio/security scope - see
      // MIN_DAYS_FOR_ACCOUNT_RETURN's own comment (calculations.js).
      minDays: MIN_DAYS_FOR_ACCOUNT_RETURN,
    });
    // Calendar-year breakdown for THIS account - same
    // scopedAnnualReturns() primitive the portfolio-level yearlyReturns
    // above already uses, just re-scoped (mirrors accountPerformance's
    // own relationship to the portfolio-level TWR). Only computed once
    // this account has at least one real observation (perf.firstDate) -
    // an account with zero valuations yet has no inception date to
    // anchor a year breakdown to, same guard the portfolio-level call
    // already applies.
    const yearlyReturns = perf.firstDate
      ? scopedAnnualReturns({
          securityHistories: accountSecurityHistories, transactions: accountTransactions,
          asOfDate: latestDate, inceptionDate: perf.firstDate,
        })
      : {};
    return { id: a.id, name: a.name, ...perf, yearlyReturns };
  });

  // ---------- Security-level performance (full bundle, for drill-down)
  // ----------
  // holdings[].returnPct/.returnAvailable above are the compact figures
  // already wired into the holdings table; this is the SAME
  // scopedPerformance() call, re-shaped to match accountPerformance's own
  // {id, name, ...perf, yearlyReturns, quant} bundle so the Performance
  // page's scope selector can treat a single security exactly like an
  // account - one drill-down mechanism, not two.
  const securityPerformance = holdingsRaw.map((h) => {
    // holdingsRaw, not holdings - same reasoning as accountPerformance
    // above: a fully redeemed security (e.g. BPI Dinâmico, value now €0)
    // must still be selectable under Securities scope with its full real
    // history, not vanish from the list entirely just because it's
    // currently worth nothing.
    const id = h.security.id;
    const securityTransactions = txnsBySecurity.get(id) || [];
    const perf = scopedPerformance({
      level: "security", securityHistories: { [id]: securityHistories[id] || [] },
      transactions: securityTransactions, asOfDate: latestDate,
    });
    const yearlyReturns = perf.firstDate
      ? scopedAnnualReturns({
          securityHistories: { [id]: securityHistories[id] || [] }, transactions: securityTransactions,
          asOfDate: latestDate, inceptionDate: perf.firstDate,
        })
      : {};
    return { id, name: h.security.name, accountId: h.accountId, ...perf, yearlyReturns };
  });

  // ---------- Strategy / mini-portfolio performance (e.g. "Global Tilts")
  // ----------
  // securities.sub_portfolio (0001_initial_schema.sql) - present in the
  // schema since the original workbook import, never read or written
  // anywhere until now. Dormant until a security is explicitly tagged
  // (see docs/performance-benchmark-architecture.md for how to tag one) -
  // a security with no tag simply belongs to no strategy, and this never
  // changes any account- or portfolio-level number, which stay computed
  // over ALL holdings regardless of tagging. Same re-scoping pattern as
  // accountPerformance above: this strategy's own member securities'
  // histories + only THEIR transactions, nothing invented or double
  // counted (a security's own transactions still count once, at its
  // account AND at its strategy - two different, non-overlapping
  // groupings of the same underlying facts, exactly like an account and
  // an asset class already can overlap without double-counting value).
  // holdingsRaw, not holdings - same reasoning as accountPerformance/
  // securityPerformance above: a strategy with a now-fully-redeemed
  // member (BPI Dinâmico, €0 today) must still show that member's real
  // historical contribution, not silently drop it the moment its
  // current value hits 0.
  const strategyNames = [...new Set(holdingsRaw.map((h) => h.security.sub_portfolio).filter(Boolean))];
  const strategyPerformance = strategyNames.map((name) => {
    const memberIds = holdingsRaw.filter((h) => h.security.sub_portfolio === name).map((h) => h.security.id);
    const memberHistories = Object.fromEntries(memberIds.map((id) => [id, securityHistories[id] || []]));
    const memberTransactions = transactionsRaw.filter((t) => memberIds.includes(t.security_id));
    const perf = scopedPerformance({
      level: "strategy", securityHistories: memberHistories, transactions: memberTransactions, asOfDate: latestDate,
    });
    const yearlyReturns = perf.firstDate
      ? scopedAnnualReturns({
          securityHistories: memberHistories, transactions: memberTransactions,
          asOfDate: latestDate, inceptionDate: perf.firstDate,
        })
      : {};
    return {
      id: name, name,
      members: memberIds.map((id) => holdings.find((h) => h.id === id)).filter(Boolean),
      ...perf, yearlyReturns,
    };
  });

  const accountAllocation = accounts.map((a) => {
    const value = holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + h.value, 0);
    return { name: a.name, value, weight: totalValue ? Math.round((value / totalValue) * 10000) / 100 : 0, tone: a.tone };
  });
  const productAllocation = holdings.map((h) => ({ id: h.id, name: h.name, ticker: h.ticker, weight: h.weight, tone: h.tone }));

  // Real currency exposure by account currency (accounts.currency is real
  // Supabase data) - unlike Asset Class/Country/Region below, this one
  // genuinely doesn't need the un-migrated Allocations sheet.
  const currencyMap = new Map();
  for (const a of accountAllocation) {
    const account = accountsRows.find((row) => row.name === a.name);
    const code = account?.currency || "EUR";
    currencyMap.set(code, (currencyMap.get(code) || 0) + a.weight);
  }
  const currency = [...currencyMap.entries()].map(([code, weight]) => ({
    code, weight: Math.round(weight * 100) / 100, tone: code === "EUR" ? "coral" : "blue",
  }));

  const transactions = transactionsRaw
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({
      id: t.id,
      label: `${t.type[0].toUpperCase()}${t.type.slice(1)} ${securityById[t.security_id]?.name || ""}`.trim(),
      date: t.date,
    }));

  // ---------- Still-real, not-yet-migrated fields ----------
  // See this file's header comment - these three come from repository.js
  // on purpose, not as a shortcut.
  const staticReal = getMockPortfolioData().analytics;

  const benchmarks = await loadBenchmarkSeries();

  // ---------- Quant risk metrics (Phase 3, Product & Architecture
  // Re-Think plan §12: Volatility/Max Drawdown/Sharpe/Sortino/Beta/
  // Alpha/Correlation, calculations.js:scopedQuantMetrics()) ----------
  // Risk-free rate: fetched once here (js/db.js:getRiskFreeRates()),
  // shared by every scope below - same "one fetch, many consumers"
  // discipline loadBenchmarkSeries() itself already follows. Wrapped in
  // its own try/catch for the same reason benchmark loading is: a
  // network hiccup or the cron job not having run yet must never break
  // the rest of Performance, it just degrades Sharpe/Sortino/Alpha to
  // "unavailable" (scopedQuantMetrics() already handles an empty array
  // gracefully - see that function's own comment).
  // Bounded to a couple of years before the portfolio's own first real
  // observation - Sharpe/Sortino only ever look up a rate nearest
  // perf.lastDate, and Beta/Alpha/Correlation only align within the
  // portfolio's own real dailySeries window, so nothing before
  // inceptionDate is ever actually used. Real efficiency win on top of
  // getRiskFreeRates()'s own pagination fix (js/db.js) - without this,
  // every page load still correctly paginates through 40+ years of
  // real Treasury history just to use the last handful of years of it.
  let riskFreeRates = [];
  try {
    const riskFreeFrom = inceptionDate ? shiftDateBy(inceptionDate, -730) : undefined;
    riskFreeRates = await getRiskFreeRates("3month", { from: riskFreeFrom });
  } catch (err) {
    console.warn("Risk-free rate data unavailable:", err);
  }
  // S&P 500 is the reference benchmark for Beta/Alpha/Correlation - the
  // portfolio's own holdings are overwhelmingly US/global equity funds
  // (see Asset Class Allocation), so it's the more relevant of the two
  // available indices; Nasdaq-100 stays available on the comparison
  // chart itself, just isn't the regression benchmark. Falls back to
  // whichever benchmark IS available if sp500 itself isn't (a real
  // outage), rather than silently disabling Beta/Alpha/Correlation over
  // a benchmark ID mismatch.
  const regressionBenchmark = (benchmarks || []).find((b) => b.id === "sp500") || (benchmarks || [])[0] || null;
  const portfolioQuant = scopedQuantMetrics({
    perf: portfolioPerformance,
    benchmarkHistory: regressionBenchmark?.series || [],
    riskFreeRates,
  });
  // Same scoping as accountPerformance above - each account's own perf
  // object already carries its real subPeriods/dailySeries, so this is
  // just scopedQuantMetrics() re-applied per account, no new fetch.
  accountPerformance.forEach((a) => {
    a.quant = scopedQuantMetrics({
      perf: a, benchmarkHistory: regressionBenchmark?.series || [], riskFreeRates,
    });
  });
  securityPerformance.forEach((s) => {
    s.quant = scopedQuantMetrics({
      perf: s, benchmarkHistory: regressionBenchmark?.series || [], riskFreeRates,
    });
  });
  strategyPerformance.forEach((s) => {
    s.quant = scopedQuantMetrics({
      perf: s, benchmarkHistory: regressionBenchmark?.series || [], riskFreeRates,
    });
  });

  // Live-computed now (computeAssetClassAllocation() above), not
  // staticReal.assetClassAllocation - see that function's own comment.
  const assetClassAllocation = computeAssetClassAllocation(holdings);

  // ---------- Costs Engine (calculations.js - see that file's own
  // "Costs Engine" header comment for the full product-vs-cash-cost,
  // current-vs-historical distinction this powers) ----------
  // costRows: real `costs` table rows, fetched alongside everything
  // else above. asOfDate is latestDate (the portfolio's own latest real
  // observation), same "now" every other live figure on this page uses -
  // never wall-clock today, which could claim a rate was "current" on a
  // day this portfolio has no real data for yet.
  const currentCost = computeCurrentPortfolioCost(holdings, costRows, totalValue, latestDate);
  const costEvolution = computeCostEvolution(securityHistories, allObservationDates, costRows);
  const historicalCashCosts = computeHistoricalCashCosts(costRows, securityHistories, latestDate);
  // Per-year breakdown (embedded estimate + real cash, kept separate) -
  // see calculations.js:computeAnnualCostBreakdown()'s own header
  // comment for why embeddedEUR is an ESTIMATE, never "paid".
  const annualCostBreakdown = computeAnnualCostBreakdown(costRows, securityHistories, latestDate);

  const largest = holdings.length ? [...holdings].sort((a, b) => b.weight - a.weight)[0] : null;
  const health = {
    holdingsCount: holdings.length,
    accountsCount: accounts.length,
    transactionsCount: transactions.length,
    countriesCount: staticReal.countries.length,
    assetClassesCount: assetClassAllocation.length,
    currenciesCount: currency.length,
    largestPosition: largest ? { name: largest.name, weight: largest.weight } : { name: "—", weight: 0 },
    cashRatio: totalValue ? Math.round((cash / totalValue) * 10000) / 100 : 0,
  };

  // ---------- Publish the public performance snapshot (0031) ----------
  // Best-effort, fire-and-forget-safe: wrapped in its own try/catch so a
  // write failure (RLS misconfiguration, a network hiccup) never breaks
  // Overview for Vera herself. Percentages and a base-100 index curve
  // only - see 0031's own header for why this is safe to expose via the
  // anon-readable public_portfolio_performance() RPC. Upserted on every
  // signed-in load, not just once, so the public figure stays current
  // with whatever Vera's own session last computed.
  try {
    await window.db.from("public_performance_snapshot").upsert({
      portfolio_id: portfolioId,
      total_return_pct: totalReturnPct,
      total_return_available: totalReturnAvailable,
      investor_return_pct: investorReturnPct,
      investor_return_available: investorReturnAvailable,
      yearly_returns: yearlyReturns,
      performance_series: portfolioPerformance.dailySeries,
      inception_date: inceptionDate,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("Public performance snapshot publish failed:", err);
  }

  return {
    portfolio: { holdings, allHoldings, accounts, cash, transactions },
    // performanceSeries: the cash-flow-neutral normalized daily index
    // (calculations.js:scopedPerformance()'s own dailySeries, base 100
    // at the portfolio's own inception) - deliberately separate from
    // valueSeries (raw €, which jumps on every deposit/withdrawal and
    // is NOT safe to feed into a benchmark comparison chart). This is
    // what the Overview/Performance page's Portfolio-vs-S&P500-vs-
    // Nasdaq-100 chart is built from - see plan doc section C/§4.
    // milestones: owner mode shows its own real history inline (Holdings/
    // Transactions/Calendar), so this stays empty here - the Investment
    // Journey timeline (computePublicMilestones, below) is a signed-out-
    // only feature. Present as [] rather than omitted so every `history`
    // shape across this file/repository.js is the same shape to read.
    history: { valueSeries, performanceSeries: portfolioPerformance.dailySeries, inceptionDate, benchmarks, marketData, milestones: [] },
    analytics: {
      assetClassAllocation,
      productAllocation,
      accountAllocation,
      regions: staticReal.regions,
      countries: staticReal.countries,
      notCountrySpecificWeight: staticReal.notCountrySpecificWeight,
      currency,
      health,
      // currentCost/costEvolution/historicalCashCosts:
      // calculations.js's Costs Engine - see that section's own header
      // comment. currentCost is forward-looking (what the portfolio
      // costs to run today); historicalCashCosts is backward-looking
      // (real cash actually paid, nav_embedded costs excluded on
      // purpose - never double-counted against valuations/performance).
      costs: { current: currentCost, evolution: costEvolution, historical: historicalCashCosts, annual: annualCostBreakdown },
      performance: {
        totalValue, investedCapital, unrealisedGain, unrealisedGainPct,
        totalReturnPct, totalReturnAvailable,
        investorReturnPct, investorReturnAvailable,
        // Calendar-year breakdown (calculations.js:scopedAnnualReturns()) -
        // {2017: {returnPct}, 2018: {...}, ...}. Rendered on the
        // Performance page (renderAnnualReturns) and in the Overview's
        // Investment Performance drawer (shell.js:performanceDrill()).
        yearlyReturns,
        // Per-account cash-flow-neutral TWR (calculations.js:
        // scopedPerformance(), level:'account') - BPI vs Trading 212 as
        // the sub-portfolio drill-down level, per the plan's confirmed
        // hierarchy. Additive field - nothing existing reads this yet
        // (UI wiring is a later phase); each entry also carries its own
        // firstDate/observationCount/hadCashFlows data-quality facts.
        accountPerformance,
        // Per-security (securityPerformance) and per-strategy/mini-
        // portfolio (strategyPerformance) cash-flow-neutral TWR - same
        // {id, name, ...perf, yearlyReturns, quant} bundle shape as
        // accountPerformance above, so the Performance page's scope
        // selector can drill into an account, a security, or a tagged
        // strategy (securities.sub_portfolio) through one shared
        // mechanism. strategyPerformance is empty until at least one
        // security is tagged - an honest empty list, not a placeholder.
        securityPerformance,
        strategyPerformance,
        // Portfolio-level Volatility/Max Drawdown/Sharpe/Sortino/Beta/
        // Alpha/Correlation (calculations.js:scopedQuantMetrics()) -
        // additive field, mirrors accountPerformance's own "nothing
        // existing reads this yet until the UI wiring" precedent.
        quant: portfolioQuant,
        regressionBenchmarkId: regressionBenchmark?.id || null,
        contributionsTotal, withdrawalsTotal,
        todayChange: 0, todayChangePct: 0, cash,
      },
    },
    settings: { currency: "EUR", benchmark: null, timezone: "Europe/Lisbon" },
    metadata: { lastUpdated: new Date().toISOString(), source: "supabase", version: "1.0.0" },
  };
}

/** getPortfolioDataPublic() - real portfolio structure/performance for
    SIGNED-OUT visitors, with zero monetary values AND zero security-
    or account-level identity ever transmitted. Reads only
    supabase/migrations/0015_public_portfolio_allocation.sql's aggregate-
    only functions plus 0013's public_cash_flow_dates() - anon has no
    other path to any real table.

    This is Layer 2 ("Public Portfolio Insights") of the three-layer
    model: Layer 1 is the public research catalogue (Securities/Brokers -
    products.js/brokers.js), Layer 3 is private personal holdings
    (exact securities, weights, accounts - authenticated only). This
    function must never blur into either neighbour: it returns real,
    aggregated, category-level facts (asset-class %, geographic %, the
    portfolio-level value curve/TWR) and NOTHING that identifies a
    specific security or account. A previous version of this function
    called public_portfolio_snapshot()/public_accounts() (0013), which
    returned real security names and account names - that was a genuine
    privacy leak, not a design choice; 0015's own header comment covers
    the full history.

    The trick that keeps the value curve both safe AND accurate: the
    portfolio's real €-valued total, on every date, arrives already
    divided by one portfolio-wide constant (public_portfolio_value_
    history(), 0015 - same idea 0013 used, just summed to one series
    before it ever leaves the database). Fed as a single-entry
    securityHistories map into the EXACT SAME chainLinkedPortfolioReturn()/
    annualReturns() the authenticated path uses (calculations.js) - those
    functions only need *a* history to sum over, and one entry whose
    value already IS the portfolio total behaves identically to summing
    many partial ones. Zero new TWR math written here to get wrong.

    assetClassAllocation/regions come from public_portfolio_allocation()
    (0015) - genuinely computed server-side from each held security's own
    public research composition (security_details) weighted by its real,
    private portfolio weight. This is a real, different computation from
    getPortfolioDataLive()'s still-static repository.js numbers (see this
    file's own header comment) - the two may not agree exactly until
    Phase 4/5 unifies both onto the same source; that divergence is
    honest, not a bug.

    Deliberately empty/null: portfolio.holdings, portfolio.accounts,
    productAllocation, accountAllocation, countries (per-country map
    data), currency (account-currency exposure - in this app currency
    maps 1:1 to a specific account, so it's exactly the broker-identity
    fact that must stay private). Deliberately NOT computed: Investor
    Return (XIRR, money-weighted by construction - needs real cash-flow
    SIZE, which public_cash_flow_dates() never exposes) and
    history.marketData/portfolio.transactions (unchanged from before -
    out of scope for the public path). */
async function getPortfolioDataPublic() {
  const [historyRes, flowsRes, allocRes, perfRes] = await Promise.all([
    window.db.rpc("public_portfolio_value_history"),
    window.db.rpc("public_cash_flow_dates"),
    window.db.rpc("public_portfolio_allocation"),
    window.db.rpc("public_portfolio_performance"),
  ]);
  if (historyRes.error) throw historyRes.error;
  if (flowsRes.error) throw flowsRes.error;
  if (allocRes.error) throw allocRes.error;
  // public_portfolio_performance (0031) is allowed to fail soft - a
  // migration not yet run, or Vera never having loaded the app signed
  // in yet, should degrade to "insufficient history" below, never break
  // the whole signed-out page the way historyRes/flowsRes/allocRes
  // failing genuinely should.
  const perfRow = !perfRes.error && perfRes.data && perfRes.data.length ? perfRes.data[0] : null;

  const historyRows = historyRes.data || [];
  const flows = flowsRes.data || [];
  const allocRows = allocRes.data || [];

  // One synthetic "portfolio" history - see this function's own header
  // comment for why a single entry is equivalent input here.
  const portfolioHistory = historyRows
    .map((r) => ({ date: r.date, value_eur: r.scaled_value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const valueSeries = portfolioHistory.map((p) => ({ date: p.date, value: p.value_eur, real: true }));

  // ---------- Real TWR/XIRR/yearly breakdown, read from the signed-in
  // client's own published snapshot (0031), never recomputed here from
  // the narrower public data this path has access to - see 0031's own
  // header for why (this used to run the OLDER chainLinkedPortfolioReturn()/
  // annualReturns() against cash-flow DATES only, the exact class of
  // bug this session spent hours fixing on the signed-in side; signed-in
  // and signed-out disagreeing, sometimes with signed-out showing a
  // wrong negative return, is exactly what this migration closes).
  const inceptionDate = perfRow?.inception_date || null;
  const totalReturnAvailable = !!perfRow?.total_return_available;
  const totalReturnPct = totalReturnAvailable ? perfRow.total_return_pct : 0;
  const investorReturnAvailable = !!perfRow?.investor_return_available;
  const investorReturnPct = investorReturnAvailable ? perfRow.investor_return_pct : 0;
  const yearlyReturns = perfRow?.yearly_returns || {};
  // The same base-100 normalized index the signed-in Investment
  // Performance card and Portfolio-vs-benchmark comparison chart draw
  // from (js/app.js:initPerformanceCard) - populating this for anon too
  // means signed-out visitors see the real cash-flow-neutral curve AND
  // get the S&P 500/Nasdaq-100 comparison chart, not just the headline %.
  const performanceSeries = perfRow?.performance_series || null;

  // ---------- Public "Investment journey" milestones (recruiter-
  // readiness audit §7/§12) - real, derived from public_cash_flow_dates()
  // alone (date + TYPE only, no security/amount - that function's own
  // privacy boundary, never crossed here). "Diversification" is a real,
  // privacy-safe signal: counting how many 'buy' events land on the same
  // date reveals "several new positions opened together" without ever
  // naming what was bought. Never invented - a date only becomes a
  // milestone because it's genuinely the inception date, genuinely the
  // single busiest real buy-date (2+ buys, otherwise skipped), or
  // genuinely the latest recorded activity.
  const milestones = computePublicMilestones(flows, inceptionDate);

  // ---------- Layer 2 aggregate allocation - category-level only ----------
  const byDimension = (dim) => allocRows.filter((r) => r.dimension === dim && r.weight_pct > 0);
  const assetClassAllocation = byDimension("asset_class")
    .map((r) => ({ name: r.category, weight: r.weight_pct, tone: tokenColor("assetClass", r.category) }));
  const REGION_TONE = { "United States": "orange", "Europe": "blue", "Emerging Markets": "green", "Other": "grey" };
  const regions = byDimension("geography")
    .map((r) => ({ name: r.category, weight: r.weight_pct, tone: REGION_TONE[r.category] || "grey" }));

  const benchmarks = await loadBenchmarkSeries();

  const cashBucket = assetClassAllocation.find((a) => a.name === "Cash");
  const health = {
    // Per-holding/per-account counts aren't computable without the
    // identity data this path deliberately never fetches - left null
    // rather than a misleading 0 (see app.js's renderAll(), which hides
    // the Health/Insights cards entirely for signed-out visitors instead
    // of rendering these).
    holdingsCount: null,
    accountsCount: null,
    transactionsCount: flows.length,
    countriesCount: null,
    assetClassesCount: assetClassAllocation.length,
    currenciesCount: null,
    largestPosition: null,
    cashRatio: cashBucket ? cashBucket.weight : 0,
  };

  return {
    portfolio: { holdings: [], allHoldings: [], accounts: [], cash: null, transactions: [] },
    history: { valueSeries, performanceSeries, inceptionDate, benchmarks, marketData: {}, milestones },
    analytics: {
      assetClassAllocation,
      productAllocation: [],
      accountAllocation: [],
      regions,
      countries: [],
      notCountrySpecificWeight: 100,
      currency: [],
      health,
      // Costs are never computed for the signed-out/public path - a
      // security-level % rate isn't privacy-sensitive on its own, but
      // there's no real holding weight here to blend it against (this
      // path's own header comment: portfolio.holdings is deliberately
      // empty), so an honest empty bundle, not a guess.
      costs: {
        current: { weightedCostPct: null, coveragePct: 0, productAnnualEUR: null, platformAnnualEUR: null, totalAnnualEUR: null, monthlyEquivalentEUR: null, byHolding: [], platformItems: [] },
        evolution: [],
        historical: { totalEUR: null, byHolding: [], series: [], excluded: [] }, annual: [],
      },
      performance: {
        totalValue: null, investedCapital: null, unrealisedGain: null, unrealisedGainPct: null,
        totalReturnPct, totalReturnAvailable,
        investorReturnPct, investorReturnAvailable,
        yearlyReturns,
        // Real amounts (contributions/withdrawals/cash) stay deliberately
        // never exposed to anon (public_cash_flow_dates() returns
        // date+type only, no amount, and 0031's snapshot is percentages/
        // an index curve only) - null here, not a guess.
        contributionsTotal: null, withdrawalsTotal: null,
        todayChange: null, todayChangePct: null, cash: null,
      },
    },
    settings: { currency: "EUR", benchmark: null, timezone: "Europe/Lisbon" },
    metadata: { lastUpdated: new Date().toISOString(), source: "public-real", version: "1.0.0" },
  };
}

/** getMockPortfolioData() is Vera's REAL portfolio, hand-transcribed
    into a static JS mirror (repository.js's own header comment) - not a
    fake demo dataset. Safe as a fallback for a SIGNED-IN load failure
    (only Vera herself ever sees that screen), but never safe as a
    signed-out fallback: falling back to it there would hand an
    anonymous visitor the exact security names/weights/accounts Layer 2/
    Layer 3 exist specifically to keep private, the moment the public RPC
    path fails for any reason (network hiccup, a migration not yet run,
    a real bug). This returns the same empty/neutral shape
    getPortfolioDataPublic() itself returns when there's simply nothing
    to show - graceful degradation, never a silent leak. */
function getPortfolioDataPublicUnavailable(loadError) {
  return {
    portfolio: { holdings: [], allHoldings: [], accounts: [], cash: null, transactions: [] },
    history: { valueSeries: [], inceptionDate: null, benchmarks: null, marketData: {}, milestones: [] },
    analytics: {
      assetClassAllocation: [], productAllocation: [], accountAllocation: [],
      regions: [], countries: [], notCountrySpecificWeight: 100, currency: [],
      health: {
        holdingsCount: null, accountsCount: null, transactionsCount: null, countriesCount: null,
        assetClassesCount: null, currenciesCount: null, largestPosition: null, cashRatio: 0,
      },
      costs: {
        current: { weightedCostPct: null, coveragePct: 0, productAnnualEUR: null, platformAnnualEUR: null, totalAnnualEUR: null, monthlyEquivalentEUR: null, byHolding: [], platformItems: [] },
        evolution: [],
        historical: { totalEUR: null, byHolding: [], series: [], excluded: [] }, annual: [],
      },
      performance: {
        totalValue: null, investedCapital: null, unrealisedGain: null, unrealisedGainPct: null,
        totalReturnPct: 0, totalReturnAvailable: false,
        investorReturnPct: 0, investorReturnAvailable: false,
        yearlyReturns: {}, contributionsTotal: null, withdrawalsTotal: null,
        todayChange: null, todayChangePct: null, cash: null,
      },
    },
    settings: { currency: "EUR", benchmark: null, timezone: "Europe/Lisbon" },
    metadata: { lastUpdated: new Date().toISOString(), source: "public-unavailable", version: "1.0.0", loadError: loadError ? (loadError.message || String(loadError)) : null },
  };
}

/** The single entry point app.js calls - lets init() stay one call site
    regardless of which backend actually answers it. Falls back to the
    mock on a SIGNED-IN failure (only Vera sees that) so Overview never
    renders blank; console.warn so a real bug doesn't hide silently. A
    signed-out failure never falls back to the mock - see
    getPortfolioDataPublicUnavailable()'s own comment for why. */
async function getPortfolioDataAuto() {
  if (window.db && currentUser()) {
    try {
      return await getPortfolioDataLive();
    } catch (err) {
      console.warn("Supabase data load failed, falling back to mock:", err);
      // Signed in, but the live fetch failed - tagged distinctly from the
      // legitimate signed-out fallback below (metadata.source stays
      // "mock" there) so a page can tell "you're genuinely on Showcase
      // mock data" apart from "you're signed in, but silently looking at
      // stale mock data because something broke" - those look identical
      // otherwise, which is exactly what made a real Supabase edit
      // (updated valuations) appear to do nothing.
      const fallback = getMockPortfolioData();
      fallback.metadata.source = "mock-fallback-error";
      fallback.metadata.loadError = err.message || String(err);
      return fallback;
    }
  }
  if (window.db) {
    try {
      return await getPortfolioDataPublic();
    } catch (err) {
      // Signed-out AND the public RPC path failed (0015's functions not
      // deployed yet, a real error, etc.) - never fall back to the real
      // mock data here (see getPortfolioDataPublicUnavailable()).
      console.warn("Public portfolio data load failed:", err);
      return getPortfolioDataPublicUnavailable(err);
    }
  }
  return getMockPortfolioData();
}
