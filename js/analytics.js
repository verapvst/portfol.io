/* ============================================================
   analytics.js - Migration Plan Phase 3: Overview reads Supabase
   directly instead of repository.js's hand-kept mirror.

   getPortfolioDataLive() returns the EXACT same contract shape as
   repository.js's getMockPortfolioData() (see that file's header comment
   for the full shape) - ui.js/app.js/charts.js need zero changes, the
   seam repository.js's own comment describes ("UI -> repository ->
   mock | Excel parser | API") is exactly what this file now sits behind.

   Deliberate, honest boundary - NOT everything below is computed from
   Supabase: assetClassAllocation, countries, regions and
   notCountrySpecificWeight still come from repository.js's real data,
   because their source (the Allocations / Detailed Portfolio / Security
   Classifications sheets) hasn't been migrated to Supabase yet (Migration
   Plan §2.6/§3.3/§3.4, Phase 4-5). Per the workbook doc's own Dashboard
   Principle - "if a metric cannot be derived from the database, the
   missing data belongs in the database, not the dashboard" - faking a
   Supabase-only version of these would mean either recomputing something
   coarser than what's already real and known, or inventing structure
   that isn't there. repository.js doesn't disappear yet; it shrinks to
   cover only what hasn't migrated, exactly as much as is still true and
   no more. It disappears entirely once Phase 4/5 land.
   ============================================================ */

async function getPortfolioDataLive() {
  const portfolioId = await ensurePortfolio();
  if (!portfolioId) throw new Error("No portfolio for the current user.");

  const [accountsRows, securitiesRows, txnRows, valRows] = await Promise.all([
    loadAccountsForPortfolio(portfolioId),
    loadSecurities(),
    window.db.from("transactions").select("*").eq("portfolio_id", portfolioId).eq("voided", false),
    window.db.from("valuations").select("*").eq("portfolio_id", portfolioId),
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
  for (const list of valuationsBySecurity.values()) list.sort((a, b) => a.date.localeCompare(b.date));

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
  // externalTypes deliberately still matches the OLD function's exact
  // type set (buy/sell/deposit/withdrawal) - narrowing portfolio scope
  // to deposit/withdrawal-only (buy/sell would be internal moves within
  // the same portfolio) is a real behaviour change the plan flags as
  // needing validation against real historical BPI data first, not done
  // yet. This ships the validated bugfix only.
  const latestDate = allObservationDates[allObservationDates.length - 1] || "0000-00-00";
  const portfolioPerformance = scopedPerformance({
    level: "portfolio", securityHistories, transactions: transactionsRaw, asOfDate: latestDate,
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
    ? scopedAnnualReturns({ securityHistories, transactions: transactionsRaw, asOfDate: latestDate, inceptionDate })
    : {};

  // ---------- XIRR ----------
  // Same generic solver as repository.js (window.xirr, still loaded) -
  // every real transaction is a dated cash flow, current total value is
  // the hypothetical terminal one, on the latest valuation date across
  // all holdings.
  const cashflows = [
    ...transactionsRaw
      .filter((t) => ["buy", "deposit"].includes(t.type))
      .map((t) => ({ date: t.date, amount: -Number(t.amount || 0) })),
    ...transactionsRaw
      .filter((t) => ["sell", "withdrawal", "dividend"].includes(t.type))
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
  const holdings = holdingsRaw.map((h) => {
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
  });

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
    const accountSecurityIds = holdings.filter((h) => h.accountId === a.id).map((h) => h.id);
    const accountSecurityHistories = Object.fromEntries(
      accountSecurityIds.map((id) => [id, securityHistories[id] || []])
    );
    const accountTransactions = transactionsRaw.filter((t) => t.account_id === a.id);
    const perf = scopedPerformance({
      level: "account", securityHistories: accountSecurityHistories, transactions: accountTransactions, asOfDate: latestDate,
    });
    return { id: a.id, name: a.name, ...perf };
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

  const largest = holdings.length ? [...holdings].sort((a, b) => b.weight - a.weight)[0] : null;
  const health = {
    holdingsCount: holdings.length,
    accountsCount: accounts.length,
    transactionsCount: transactions.length,
    countriesCount: staticReal.countries.length,
    assetClassesCount: staticReal.assetClassAllocation.length,
    currenciesCount: currency.length,
    largestPosition: largest ? { name: largest.name, weight: largest.weight } : { name: "—", weight: 0 },
    cashRatio: totalValue ? Math.round((cash / totalValue) * 10000) / 100 : 0,
  };

  return {
    portfolio: { holdings, accounts, cash, transactions },
    history: { valueSeries, inceptionDate, benchmarks: null, marketData },
    analytics: {
      assetClassAllocation: staticReal.assetClassAllocation,
      productAllocation,
      accountAllocation,
      regions: staticReal.regions,
      countries: staticReal.countries,
      notCountrySpecificWeight: staticReal.notCountrySpecificWeight,
      currency,
      health,
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
  const [historyRes, flowsRes, allocRes] = await Promise.all([
    window.db.rpc("public_portfolio_value_history"),
    window.db.rpc("public_cash_flow_dates"),
    window.db.rpc("public_portfolio_allocation"),
  ]);
  if (historyRes.error) throw historyRes.error;
  if (flowsRes.error) throw flowsRes.error;
  if (allocRes.error) throw allocRes.error;

  const historyRows = historyRes.data || [];
  const flows = flowsRes.data || [];
  const allocRows = allocRes.data || [];

  // One synthetic "portfolio" history - see this function's own header
  // comment for why a single entry is equivalent input here.
  const portfolioHistory = historyRows
    .map((r) => ({ date: r.date, value_eur: r.scaled_value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const securityHistories = { portfolio: portfolioHistory };

  const allObservationDates = portfolioHistory.map((p) => p.date);
  const latestDate = allObservationDates[allObservationDates.length - 1] || "0000-00-00";
  const valueSeries = portfolioHistory.map((p) => ({ date: p.date, value: p.value_eur, real: true }));

  const cashFlowDates = [...new Set(flows.map((f) => f.date))].sort();
  const inceptionDate = cashFlowDates[0] || null;

  const twrResult = cashFlowDates.length
    ? chainLinkedPortfolioReturn(securityHistories, cashFlowDates, latestDate)
    : { subPeriods: [], totalReturnPct: null };
  const totalReturnAvailable = twrResult.totalReturnPct != null;
  const totalReturnPct = totalReturnAvailable ? twrResult.totalReturnPct : 0;
  const yearlyReturns = inceptionDate ? annualReturns(securityHistories, cashFlowDates, latestDate, inceptionDate) : {};

  // ---------- Layer 2 aggregate allocation - category-level only ----------
  const byDimension = (dim) => allocRows.filter((r) => r.dimension === dim && r.weight_pct > 0);
  const assetClassAllocation = byDimension("asset_class")
    .map((r) => ({ name: r.category, weight: r.weight_pct, tone: tokenColor("assetClass", r.category) }));
  const REGION_TONE = { "United States": "orange", "Europe": "blue", "Emerging Markets": "green", "Other": "grey" };
  const regions = byDimension("geography")
    .map((r) => ({ name: r.category, weight: r.weight_pct, tone: REGION_TONE[r.category] || "grey" }));

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
    portfolio: { holdings: [], accounts: [], cash: null, transactions: [] },
    history: { valueSeries, inceptionDate, benchmarks: null, marketData: {} },
    analytics: {
      assetClassAllocation,
      productAllocation: [],
      accountAllocation: [],
      regions,
      countries: [],
      notCountrySpecificWeight: 100,
      currency: [],
      health,
      performance: {
        totalValue: null, investedCapital: null, unrealisedGain: null, unrealisedGainPct: null,
        totalReturnPct, totalReturnAvailable,
        investorReturnPct: 0, investorReturnAvailable: false,
        yearlyReturns,
        // Same reasoning as investorReturnPct above: real amounts,
        // deliberately never exposed to anon (public_cash_flow_dates()
        // returns date+type only, no amount) - null here, not a guess.
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
    portfolio: { holdings: [], accounts: [], cash: null, transactions: [] },
    history: { valueSeries: [], inceptionDate: null, benchmarks: null, marketData: {} },
    analytics: {
      assetClassAllocation: [], productAllocation: [], accountAllocation: [],
      regions: [], countries: [], notCountrySpecificWeight: 100, currency: [],
      health: {
        holdingsCount: null, accountsCount: null, transactionsCount: null, countriesCount: null,
        assetClassesCount: null, currenciesCount: null, largestPosition: null, cashRatio: 0,
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
