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

  // ---------- Cash-flow boundaries (for TWR) ----------
  // Every buy/sell/deposit/withdrawal transaction date is treated as an
  // EXTERNAL portfolio cash flow. KNOWN, DOCUMENTED LIMITATION (see
  // calculations.js:chainLinkedPortfolioReturn()'s own comment): the
  // schema has no flag distinguishing "funded by new money" from
  // "funded by selling something else first" - every buy/sell counts as
  // external. Correct for the real data today (zero sells on record),
  // not correct in general the day a rebalance happens - not silently
  // pretending otherwise.
  const cashFlowDates = [...new Set(
    transactionsRaw.filter((t) => ["buy", "sell", "deposit", "withdrawal"].includes(t.type)).map((t) => t.date)
  )].sort();
  const inceptionDate = cashFlowDates[0] || null;

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

  // ---------- TWR ----------
  // Portfolio-level chain-linked TWR (calculations.js:
  // chainLinkedPortfolioReturn()) - replaces the old "longest-history
  // holding drives the whole portfolio" simplification, confirmed
  // invalid the moment UETW/AVWS/XDEQ/SPYM each accumulated a second
  // real valuation. Never each holding's own TWR blended afterward -
  // total portfolio value at each cash-flow boundary already embeds
  // every holding's historical weight.
  const latestDate = allObservationDates[allObservationDates.length - 1] || "0000-00-00";
  const twrResult = cashFlowDates.length
    ? chainLinkedPortfolioReturn(securityHistories, cashFlowDates, latestDate)
    : { subPeriods: [], totalReturnPct: null };
  const totalReturnAvailable = twrResult.totalReturnPct != null;
  const totalReturnPct = totalReturnAvailable ? twrResult.totalReturnPct : 0;

  // Calendar-year breakdown - same chain-linking primitive, sliced at
  // Dec-31/Jan-1 boundaries (calculations.js:annualReturns()), not a
  // second calculation method.
  const yearlyReturns = inceptionDate ? annualReturns(securityHistories, cashFlowDates, latestDate, inceptionDate) : {};

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

  // Each holding's OWN naive return (its latest observation vs. its
  // first) - a genuinely different question from the portfolio-level
  // TWR above. Naive, not chain-linked, because every position today is
  // a single lot (bought once, never added to) - a simple first-vs-last
  // comparison is mathematically exact for that case. This is POSITION
  // return, not the security's own market-price return (they currently
  // coincide only because there's no second purchase/partial sale yet
  // to make them diverge - see docs/implementation-roadmap.md's
  // Performance & Analytics Architecture section for why these aren't
  // the same concept in general).
  const holdings = holdingsRaw.map((h) => {
    const ownReturnPct = h.history.length >= 2
      ? Math.round(((h.history[h.history.length - 1].value_eur / h.history[0].value_eur) - 1) * 10000) / 100
      : 0;
    return {
      id: h.security.id,
      name: h.security.name,
      ticker: h.security.ticker || "—",
      type: h.security.type,
      accountId: h.accountId,
      value: h.value,
      weight: totalValue ? Math.round((h.value / totalValue) * 10000) / 100 : 0,
      returnPct: ownReturnPct,
      ...unrealisedPnL(h.value, costBasisFromTransactions(txnsBySecurity.get(h.security.id) || [])),
      tone: tokenColor("asset", h.security.name.replace(/[^a-zA-Z0-9]/g, "_")),
    };
  });

  // currency carried through from the real accounts row (already fetched
  // above) so currencyDrill (shell.js) can match holdings to a currency
  // by real account data instead of a hardcoded account-name check.
  const accounts = accountsRows.map((a) => ({ id: a.id, name: a.name, currency: a.currency, tone: tokenColor("account", a.name) }));
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
        // Calendar-year breakdown (calculations.js:annualReturns()) -
        // {2017: {returnPct}, 2018: {...}, ...}. Not yet rendered
        // anywhere - the seam Performance can build a "2024: +X% / 2025:
        // +X% / 2026 YTD: +X%" view on top of once there's a UI slot for
        // it, per docs/implementation-roadmap.md's Performance &
        // Analytics Architecture section.
        yearlyReturns,
        todayChange: 0, todayChangePct: 0, cash,
      },
    },
    settings: { currency: "EUR", benchmark: null, timezone: "Europe/Lisbon" },
    metadata: { lastUpdated: new Date().toISOString(), source: "supabase", version: "1.0.0" },
  };
}

/** getPortfolioDataPublic() - real portfolio structure/performance for
    SIGNED-OUT visitors, with zero monetary values ever transmitted.
    Reads only supabase/migrations/0013_public_portfolio_functions.sql's
    three RPC functions - anon has no other path to any real table, and
    none of those three functions has a monetary return column, full
    stop (see that migration's own verification query).

    The trick that keeps this both safe AND accurate: every security's
    real €-valued history arrives already divided by one portfolio-wide
    constant (0013's own comment explains why), so it's a dimensionless
    ratio, never €. Fed into the EXACT SAME valueOfSecurityAsOf()/
    chainLinkedPortfolioReturn()/annualReturns() the authenticated path
    uses (calculations.js) - scaling every input by one constant never
    changes a ratio-based calculation's result, so this produces
    numerically IDENTICAL percentages to the real computation, with zero
    new TWR math written here to get wrong.

    Deliberately NOT computed here: Investor Return (XIRR). XIRR is
    money-WEIGHTED by construction - it needs each cash flow's real
    relative SIZE, which this function set intentionally never exposes
    (matching Vera's own separate, stricter, earlier requirement that
    Transactions stays a full gated preview - amounts hidden - even
    signed in with values off). investorReturnAvailable stays honestly
    false here rather than approximating a money-weighted number from
    data that was deliberately withheld.

    Also NOT included: history.marketData (Security Detail's own real
    EODHD data - that page stays authenticated-only, out of scope for
    this pass) and portfolio.transactions (a labelled activity feed -
    0013's public_cash_flow_dates() returns date+type only specifically
    so it can feed TWR's boundaries without ever building a
    reconstructible "what happened when" list, per that function's own
    comment). */
async function getPortfolioDataPublic() {
  const [snapshotRes, flowsRes, accountsRes] = await Promise.all([
    window.db.rpc("public_portfolio_snapshot"),
    window.db.rpc("public_cash_flow_dates"),
    window.db.rpc("public_accounts"),
  ]);
  if (snapshotRes.error) throw snapshotRes.error;
  if (flowsRes.error) throw flowsRes.error;
  if (accountsRes.error) throw accountsRes.error;

  const snapshot = snapshotRes.data || [];
  const flows = flowsRes.data || [];
  const accountsRows = accountsRes.data || [];

  // ---------- Per-security scaled history, same shape valueOfSecurityAsOf()
  // already expects (date, value_eur) - "value_eur" here is the scaled
  // ratio, not euros, but the function itself is scale-agnostic (it
  // just finds the nearest-prior point), so nothing about it needs to
  // change to consume this safely.
  const securitiesById = new Map();
  const securityHistories = {};
  for (const row of snapshot) {
    if (!securitiesById.has(row.security_id)) {
      securitiesById.set(row.security_id, { id: row.security_id, name: row.security_name, type: row.security_type, accountId: row.account_id });
    }
    const list = securityHistories[row.security_id] || (securityHistories[row.security_id] = []);
    list.push({ date: row.date, value_eur: row.scaled_value });
  }
  for (const list of Object.values(securityHistories)) list.sort((a, b) => a.date.localeCompare(b.date));

  const allObservationDates = [...new Set(snapshot.map((r) => r.date))].sort();
  const latestDate = allObservationDates[allObservationDates.length - 1] || "0000-00-00";
  const valueSeries = allObservationDates.map((date) => ({
    date,
    value: Object.values(securityHistories).reduce((s, h) => s + valueOfSecurityAsOf(h, date), 0),
    real: true,
  }));

  const cashFlowDates = [...new Set(flows.map((f) => f.date))].sort();
  const inceptionDate = cashFlowDates[0] || null;

  const twrResult = cashFlowDates.length
    ? chainLinkedPortfolioReturn(securityHistories, cashFlowDates, latestDate)
    : { subPeriods: [], totalReturnPct: null };
  const totalReturnAvailable = twrResult.totalReturnPct != null;
  const totalReturnPct = totalReturnAvailable ? twrResult.totalReturnPct : 0;
  const yearlyReturns = inceptionDate ? annualReturns(securityHistories, cashFlowDates, latestDate, inceptionDate) : {};

  // ---------- Holdings: weight/return %, no value ----------
  const totalScaled = [...securitiesById.keys()].reduce((s, id) => s + valueOfSecurityAsOf(securityHistories[id], latestDate), 0);
  const holdings = [...securitiesById.values()].map((sec) => {
    const hist = securityHistories[sec.id];
    const latestVal = valueOfSecurityAsOf(hist, latestDate);
    const ownReturnPct = hist.length >= 2
      ? Math.round(((hist[hist.length - 1].value_eur / hist[0].value_eur) - 1) * 10000) / 100
      : 0;
    return {
      id: sec.id, name: sec.name, ticker: "—", type: sec.type, accountId: sec.accountId,
      value: null, costBasis: null, pnl: null, pnlPct: null,
      weight: totalScaled ? Math.round((latestVal / totalScaled) * 10000) / 100 : 0,
      returnPct: ownReturnPct,
      tone: tokenColor("asset", sec.name.replace(/[^a-zA-Z0-9]/g, "_")),
    };
  });

  const accounts = accountsRows.map((a) => ({ id: a.id, name: a.name, currency: a.currency, tone: tokenColor("account", a.name) }));
  const accountAllocation = accounts.map((a) => {
    const weight = holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + h.weight, 0);
    return { name: a.name, value: null, weight: Math.round(weight * 100) / 100, tone: a.tone };
  });
  const productAllocation = holdings.map((h) => ({ id: h.id, name: h.name, ticker: h.ticker, weight: h.weight, tone: h.tone }));

  const currencyMap = new Map();
  for (const a of accountAllocation) {
    const account = accountsRows.find((row) => row.name === a.name);
    const code = account?.currency || "EUR";
    currencyMap.set(code, (currencyMap.get(code) || 0) + a.weight);
  }
  const currency = [...currencyMap.entries()].map(([code, weight]) => ({
    code, weight: Math.round(weight * 100) / 100, tone: code === "EUR" ? "coral" : "blue",
  }));

  // ---------- Still-real, not-yet-migrated fields - same source and
  // same reasoning as getPortfolioDataLive() above: real, non-monetary,
  // shown identically regardless of auth state. ----------
  const staticReal = getMockPortfolioData().analytics;

  const largest = holdings.length ? [...holdings].sort((a, b) => b.weight - a.weight)[0] : null;
  const cashHolding = holdings.find((h) => h.type === "Cash");
  const health = {
    holdingsCount: holdings.length,
    accountsCount: accounts.length,
    transactionsCount: flows.length,
    countriesCount: staticReal.countries.length,
    assetClassesCount: staticReal.assetClassAllocation.length,
    currenciesCount: currency.length,
    largestPosition: largest ? { name: largest.name, weight: largest.weight } : { name: "—", weight: 0 },
    cashRatio: cashHolding ? cashHolding.weight : 0,
  };

  return {
    portfolio: { holdings, accounts, cash: null, transactions: [] },
    history: { valueSeries, inceptionDate, benchmarks: null, marketData: {} },
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
        totalValue: null, investedCapital: null, unrealisedGain: null, unrealisedGainPct: null,
        totalReturnPct, totalReturnAvailable,
        investorReturnPct: 0, investorReturnAvailable: false,
        yearlyReturns,
        todayChange: null, todayChangePct: null, cash: null,
      },
    },
    settings: { currency: "EUR", benchmark: null, timezone: "Europe/Lisbon" },
    metadata: { lastUpdated: new Date().toISOString(), source: "public-real", version: "1.0.0" },
  };
}

/** The single entry point app.js calls - lets init() stay one call site
    regardless of which backend actually answers it. Falls back to the
    mock on any failure (signed out, RLS empty, a real error) so Overview
    never renders blank; console.warn so a real bug doesn't hide silently. */
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
      // Signed-out AND the public RPC path failed (0013's functions not
      // deployed yet, a real error, etc.) - same "don't render blank,
      // don't hide a real bug" reasoning as the authenticated branch
      // above, tagged with its own distinct source so this specific
      // failure mode is identifiable too.
      console.warn("Public portfolio data load failed, falling back to mock:", err);
      const fallback = getMockPortfolioData();
      fallback.metadata.source = "mock-fallback-error";
      fallback.metadata.loadError = err.message || String(err);
      return fallback;
    }
  }
  return getMockPortfolioData();
}
