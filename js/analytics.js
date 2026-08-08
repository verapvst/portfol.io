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

  // ---------- TWR ----------
  // Generic, not hardcoded to one fund by name: the security with the
  // longest real valuation history drives the portfolio TWR, exactly
  // matching today's real methodology (repository.js's own comment) -
  // it degenerates to this automatically because a newly-bought security
  // has only one valuation (0 elapsed time, a real 0% sub-period), so it
  // can never be the longest history. True multi-security chain-linking
  // only matters once more than one holding has real interim history.
  const twrDriver = holdingsRaw.reduce((best, h) => (h.history.length > best.history.length ? h : best), { history: [] });
  const totalReturnPct = twrDriver.history.length >= 2
    ? Math.round(((twrDriver.history[twrDriver.history.length - 1].value_eur / twrDriver.history[0].value_eur) - 1) * 10000) / 100
    : 0;
  const valueSeries = twrDriver.history.map((v) => ({ date: v.date, value: v.value_eur, real: true }));

  // ---------- XIRR ----------
  // Same generic solver as repository.js (window.xirr, still loaded) -
  // every real transaction is a dated cash flow, current total value is
  // the hypothetical terminal one, on the latest valuation date across
  // all holdings.
  const latestDate = holdingsRaw.reduce((d, h) => (h.history[h.history.length - 1].date > d ? h.history[h.history.length - 1].date : d), "0000-00-00");
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

  const holdings = holdingsRaw.map((h) => ({
    id: h.security.id,
    name: h.security.name,
    ticker: h.security.ticker || "—",
    type: h.security.type,
    accountId: h.accountId,
    value: h.value,
    weight: totalValue ? Math.round((h.value / totalValue) * 10000) / 100 : 0,
    returnPct: h.security.id === twrDriver.security?.id ? totalReturnPct : 0,
    ...unrealisedPnL(h.value, costBasisFromTransactions(txnsBySecurity.get(h.security.id) || [])),
    tone: tokenColor("asset", h.security.name.replace(/[^a-zA-Z0-9]/g, "_")),
  }));

  const accounts = accountsRows.map((a) => ({ id: a.id, name: a.name, tone: tokenColor("account", a.name) }));
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
    history: { valueSeries, inceptionDate: valueSeries[0]?.date || null, benchmarks: null },
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
        totalReturnPct, totalReturnAvailable: twrDriver.history.length >= 2,
        investorReturnPct, investorReturnAvailable,
        todayChange: 0, todayChangePct: 0, cash,
      },
    },
    settings: { currency: "EUR", benchmark: null, timezone: "Europe/Lisbon" },
    metadata: { lastUpdated: new Date().toISOString(), source: "supabase", version: "1.0.0" },
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
    }
  }
  return getMockPortfolioData();
}
