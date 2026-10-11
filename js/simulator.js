/* ============================================================
   simulator.js - the Simulator page. Renders; the maths lives in
   simulator-engine.js (unit-tested).

   Model in one paragraph: the current portfolio is split into three
   blocks - Cash (no volatility), "Rest" (everything else) and X (the
   security being bought or sold). Their volatilities and correlations come
   from real monthly returns (portfolio index, the security's own price
   history, and the S&P 500 for beta). Expected returns are ASSUMPTIONS:
   CAPM (risk-free rate + beta x an equity risk premium you can change) for
   equities, and the matching Treasury yield for Treasury ETFs. The page
   then compares Sharpe before and after, sweeps trade sizes for the best
   Sharpe, projects a range of outcomes, and adds up costs. Every input
   shows the date it was last updated.
   ============================================================ */

const FRESHNESS_LIMIT_DAYS = { "US Treasury yield": 4, "Benchmark": 10, "ETF prices": 4, "US inflation": 60, "Fund facts": 60 };
const TREASURY_BUCKETS = [
  { key: "3month", label: "3 months", group: "Short" },
  { key: "2year", label: "2 years", group: "Short" },
  { key: "5year", label: "5 years", group: "Mid" },
  { key: "10year", label: "10 years", group: "Mid" },
  { key: "30year", label: "30 years", group: "Long" },
];
// Which Treasury yield an ETF's expected return is anchored to.
const TREASURY_ETF_YIELD = { "Short (1-3 years)": "2year", "Mid (7-10 years)": "10year", "Long (20+ years)": "30year" };
const DEFAULT_ERP_PCT = 5.0;
const MIN_OVERLAP_MONTHS = 10;

const state = {
  signedIn: false,
  data: null,
  universe: [],
  brokers: [],
  rates: {},
  inflation: null,
  projections: [],
  fresh: [],
  priceCache: new Map(),
  lastRun: null,
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(`${String(dateStr).slice(0, 10)}T00:00:00`).getTime()) / 86400000);
}
function fmtDay(dateStr) {
  if (!dateStr) return "—";
  return new Date(`${String(dateStr).slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtStamp(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`);
const eur = (v) => (v == null || !Number.isFinite(v) ? "—" : fmtEUR(v));

/* ---------- Data loading ---------- */

async function loadMarketData() {
  const db = window.db;
  const [freshRes, projRes, cpiRes, ...rateRes] = await Promise.all([
    db.from("market_data_freshness").select("*"),
    db.from("market_projections").select("*").order("topic").order("published_date", { ascending: false }),
    db.from("inflation_rates").select("date, value").eq("series", "cpi_us").order("date", { ascending: false }).limit(14),
    ...TREASURY_BUCKETS.map((b) => db.from("risk_free_rates").select("date, rate_pct, fetched_at").eq("maturity", b.key).order("date", { ascending: false }).limit(1)),
  ]);
  state.fresh = freshRes.error ? [] : freshRes.data || [];
  state.projections = projRes.error ? [] : projRes.data || [];
  state.rates = {};
  TREASURY_BUCKETS.forEach((b, i) => {
    const row = rateRes[i].data?.[0];
    if (row) state.rates[b.key] = { rate: Number(row.rate_pct), date: row.date, fetchedAt: row.fetched_at };
  });
  state.inflation = inflationFromCpi(cpiRes.data || []);
}

/** Year-on-year inflation (%) from the CPI index levels: latest vs the
    observation exactly 12 months earlier. null if either is missing. */
function inflationFromCpi(rows) {
  if (!rows.length) return null;
  const latest = rows[0];
  const [y, m] = latest.date.split("-").map(Number);
  const prevKey = `${y - 1}-${String(m).padStart(2, "0")}`;
  const prev = rows.find((r) => r.date.startsWith(prevKey));
  return prev ? { yoyPct: (Number(latest.value) / Number(prev.value) - 1) * 100, date: latest.date } : { yoyPct: null, date: latest.date };
}

async function loadPrivateData() {
  const db = window.db;
  state.data = await getPortfolioDataAuto();
  setCurrentPortfolioData(state.data);
  const [secRes, brokerRes] = await Promise.all([
    db.from("securities").select("id, name, type, isin, currency, asset_class, theme, sub_theme, data_provider_symbol, price_currency, security_details(ter_pct, aum_eur_millions, last_verified, return_1y_pct, launched_date)").order("name"),
    db.from("brokers").select("id, name, etf_commission, fx_fee_pct, fractional_etfs").order("name"),
  ]);
  if (secRes.error) throw secRes.error;
  state.universe = (secRes.data || []).filter((s) => s.type !== "Cash").map((s) => {
    const d = Array.isArray(s.security_details) ? s.security_details[0] : s.security_details;
    return { ...s, details: d || null };
  });
  state.brokers = brokerRes.data || [];
}

/** All close prices for one security, oldest first (paged: PostgREST caps a
    response at 1000 rows). Cached for the session. */
async function loadPriceHistory(securityId) {
  if (state.priceCache.has(securityId)) return state.priceCache.get(securityId);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await window.db.from("daily_prices")
      .select("date, close, adjusted_close, fetched_at").eq("security_id", securityId)
      .order("date", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  state.priceCache.set(securityId, rows);
  return rows;
}

/* ---------- Freshness + rates + outlook (public) ---------- */

function freshnessLimit(dataset) {
  const key = Object.keys(FRESHNESS_LIMIT_DAYS).find((k) => dataset.startsWith(k));
  return key ? FRESHNESS_LIMIT_DAYS[key] : 7;
}

function renderFreshness() {
  const wantedMissing = ["ETF prices", "US inflation (CPI)"].filter((d) => !state.fresh.some((f) => f.dataset === d));
  const rows = [...state.fresh];
  let staleCount = 0;
  const html = rows.sort((a, b) => a.dataset.localeCompare(b.dataset)).map((f) => {
    const age = daysSince(f.latest_date);
    const limit = freshnessLimit(f.dataset);
    const status = age == null ? "none" : age <= limit ? "fresh" : "stale";
    if (status !== "fresh") staleCount++;
    return `
      <div class="sim-fresh-row is-${status}">
        <span class="sim-fresh-name">${esc(f.dataset)}</span>
        <span class="sim-fresh-date">${fmtDay(f.latest_date)}${age != null ? ` <small>(${age === 0 ? "today" : `${age}d ago`})</small>` : ""}</span>
        <span class="sim-dot"></span>
      </div>`;
  }).join("") + wantedMissing.map((d) => `
      <div class="sim-fresh-row is-none"><span class="sim-fresh-name">${esc(d)}</span><span class="sim-fresh-date">no data yet</span><span class="sim-dot"></span></div>`).join("");
  staleCount += wantedMissing.length;

  $("sim-fresh-body").innerHTML = html || `<p class="sim-empty">No freshness information available.</p>`;
  const badge = $("sim-fresh-badge");
  badge.textContent = staleCount ? `${staleCount} input${staleCount === 1 ? "" : "s"} out of date` : "All inputs fresh";
  badge.className = `sim-badge ${staleCount ? "is-warn" : "is-ok"}`;

  const actions = $("sim-fresh-actions");
  if (!state.signedIn) { actions.innerHTML = ""; return; }
  actions.innerHTML = `
    <button type="button" class="sim-btn" id="sim-refresh-yields">Refresh Treasury yields</button>
    <button type="button" class="sim-btn" id="sim-refresh-cpi">Refresh inflation</button>`;
  $("sim-refresh-yields").addEventListener("click", refreshYields);
  $("sim-refresh-cpi").addEventListener("click", () => refreshFunction("fetch-inflation", {}, "Inflation", ""));
}

async function refreshFunction(name, body, label, slowNote) {
  const msg = $("sim-fresh-msg");
  msg.className = "sim-note";
  msg.textContent = `Refreshing ${label}… ${slowNote}`;
  document.querySelectorAll("#sim-fresh-actions .sim-btn").forEach((b) => { b.disabled = true; });
  try {
    const { data, error } = await window.db.functions.invoke(name, { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await loadMarketData();
    renderFreshness(); renderRates();
    msg.textContent = `${label} refreshed.`;
  } catch (err) {
    msg.className = "sim-note is-error";
    msg.textContent = `Couldn't refresh ${label}: ${err.message || err}. (The edge function may not be deployed yet.)`;
    document.querySelectorAll("#sim-fresh-actions .sim-btn").forEach((b) => { b.disabled = false; });
  }
}

/** One request per maturity: a single request for all five exceeds the Edge
    Function compute limit, and the data provider also rate-limits per minute. */
async function refreshYields() {
  const msg = $("sim-fresh-msg");
  msg.className = "sim-note";
  document.querySelectorAll("#sim-fresh-actions .sim-btn").forEach((b) => { b.disabled = true; });
  const failed = [];
  for (let i = 0; i < TREASURY_BUCKETS.length; i++) {
    const b = TREASURY_BUCKETS[i];
    msg.textContent = `Refreshing Treasury yields: ${b.label} (${i + 1} of ${TREASURY_BUCKETS.length})… the data provider limits calls per minute, so this takes about a minute.`;
    try {
      const { data, error } = await window.db.functions.invoke("fetch-risk-free-rate", { body: { maturities: [b.key] } });
      if (error) throw error;
      const r = data?.results?.[0];
      if (r && r.status !== "ok") throw new Error(r.error || r.status);
    } catch (err) { failed.push(`${b.label}: ${err.message || err}`); }
    if (i < TREASURY_BUCKETS.length - 1) await new Promise((res) => setTimeout(res, 13000));
  }
  await loadMarketData();
  renderFreshness(); renderRates();
  $("sim-fresh-msg").className = failed.length ? "sim-note is-error" : "sim-note";
  $("sim-fresh-msg").textContent = failed.length ? `Some yields couldn't be refreshed - ${failed.join("; ")}` : "Treasury yields refreshed.";
}

function renderRates() {
  const groups = ["Short", "Mid", "Long"];
  const cells = groups.map((g) => {
    const items = TREASURY_BUCKETS.filter((b) => b.group === g).map((b) => {
      const r = state.rates[b.key];
      return `
        <div class="sim-rate">
          <span class="sim-rate-label">${b.label}</span>
          <span class="sim-rate-value">${r ? pct(r.rate) : "—"}</span>
          <span class="sim-rate-date">${r ? `as of ${fmtDay(r.date)}` : "no data yet"}</span>
        </div>`;
    }).join("");
    return `<div class="sim-rate-group"><p class="sim-rate-group-title">${g}</p>${items}</div>`;
  }).join("");

  const infl = state.inflation;
  const r10 = state.rates["10year"];
  const real10 = infl?.yoyPct != null && r10 ? ((1 + r10.rate / 100) / (1 + infl.yoyPct / 100) - 1) * 100 : null;
  $("sim-rates-body").innerHTML = `
    <div class="sim-rate-grid">${cells}</div>
    <div class="sim-infl">
      <div class="sim-rate"><span class="sim-rate-label">US inflation (CPI, year on year)</span><span class="sim-rate-value">${infl?.yoyPct != null ? pct(infl.yoyPct) : "—"}</span><span class="sim-rate-date">${infl ? `as of ${fmtDay(infl.date)}` : "no data yet"}</span></div>
      <div class="sim-rate"><span class="sim-rate-label">Real 10-year yield (yield minus inflation)</span><span class="sim-rate-value">${real10 != null ? pct(real10) : "—"}</span><span class="sim-rate-date">${r10 && infl?.yoyPct != null ? "derived from the two figures above" : "needs both"}</span></div>
    </div>
    <p class="sim-note">US Treasury yields from Alpha Vantage; CPI from Alpha Vantage (US Bureau of Labor Statistics data). The 3-month yield is the risk-free rate used for Sharpe ratios.</p>`;
}

function renderOutlook() {
  if (!state.projections.length) { $("sim-outlook-body").innerHTML = `<p class="sim-empty">No projections loaded yet (run migration 0040).</p>`; return; }
  const byTopic = new Map();
  for (const p of state.projections) {
    if (!byTopic.has(p.topic)) byTopic.set(p.topic, []);
    byTopic.get(p.topic).push(p);
  }
  $("sim-outlook-body").innerHTML = [...byTopic.entries()].map(([topic, items]) => `
    <div class="sim-outlook-topic">
      <p class="sim-outlook-title">${esc(topic)}</p>
      ${items.map((p) => {
        const url = safeUrl(p.source_url);
        return `
        <div class="sim-proj">
          <div class="sim-proj-head">
            <span class="sim-proj-metric">${esc(p.metric)}${p.horizon ? ` <small>(${esc(p.horizon)})</small>` : ""}</span>
            <span class="sim-tag ${p.confidence === "primary" ? "is-primary" : "is-secondary"}">${p.confidence === "primary" ? "primary source" : "secondary coverage"}</span>
          </div>
          <p class="sim-proj-value">${esc(p.value_text)}</p>
          ${p.scope_note ? `<p class="sim-proj-note">${esc(p.scope_note)}</p>` : ""}
          <p class="sim-proj-src">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.source_name)}</a>` : esc(p.source_name)} · published ${p.published_date ? fmtDay(p.published_date) : "date not stated"} · retrieved ${fmtDay(p.retrieved_at)}</p>
        </div>`;
      }).join("")}
    </div>`).join("");
}

/* ---------- Trade ticket ---------- */

function heldNonCash() {
  return (state.data?.portfolio?.holdings || []).filter((h) => h.type !== "Cash");
}
function cashHolding() {
  return (state.data?.portfolio?.holdings || []).find((h) => h.type === "Cash") || null;
}
function lastPriceRow(rows) {
  return rows && rows.length ? rows[rows.length - 1] : null;
}
function listingCurrency(symbol, priceCurrency = null) {
  // The currency the price is QUOTED in is stored when the symbol is verified
  // (securities.price_currency, migration 0042); the exchange suffix is only
  // a fallback for rows verified before that column existed.
  if (priceCurrency) return priceCurrency;
  const ex = (symbol || "").split(".").pop();
  if (["XETRA", "F", "PA", "AS", "MI", "MC", "LS", "BR", "HE"].includes(ex)) return "EUR";
  if (ex === "LSE") return "GBX";
  if (ex === "SW") return "CHF";
  return null;
}

function securityOptionsHTML(side, selected) {
  if (side === "sell") {
    const held = heldNonCash();
    if (!held.length) return `<option value="">You hold nothing to sell</option>`;
    return held.map((h) => `<option value="${esc(h.id)}"${h.id === selected ? " selected" : ""}>${esc(h.name)} (${eur(h.value)})</option>`).join("");
  }
  const groups = new Map();
  for (const s of state.universe) {
    const g = s.theme || (s.type === "Fund" ? "Funds" : s.type === "PPR" || s.type === "Insurance" ? "Retirement / insurance" : "Other ETFs");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([g, items]) => `
    <optgroup label="${esc(g)}">${items.map((s) => `<option value="${esc(s.id)}"${s.id === selected ? " selected" : ""}>${esc(s.name)}${s.data_provider_symbol ? "" : " (no price data yet)"}</option>`).join("")}</optgroup>`).join("");
}

function renderTicket() {
  const body = $("sim-ticket-body");
  if (!state.signedIn) { body.innerHTML = lockedHTML({ hint: "Simulating a trade needs your holdings, so it's private." }); return; }
  const cash = cashHolding();
  const defaultBroker = state.brokers.find((b) => /trading\s*212/i.test(b.name)) || state.brokers[0];
  body.innerHTML = `
    <div class="sim-form">
      <div class="sim-field"><label>Action</label>
        <div class="sim-seg" id="sim-side"><button type="button" class="is-active" data-side="buy">Buy</button><button type="button" data-side="sell">Sell</button></div>
        <p class="sim-help" id="sim-side-help">Buy any security in the database. Sell only what you hold.</p></div>
      <div class="sim-field sim-wide"><label for="sim-security">Security</label><select id="sim-security">${securityOptionsHTML("buy")}</select></div>
      <div class="sim-field"><label for="sim-amount">Amount (EUR)</label><input id="sim-amount" type="number" min="0" step="any" inputmode="decimal" value="100"></div>
      <div class="sim-field"><label for="sim-years">Holding period (years)</label><input id="sim-years" type="number" min="1" max="40" step="1" value="5"></div>
      <div class="sim-field"><label for="sim-funding">Funded by</label>
        <select id="sim-funding">
          <option value="new">New money (portfolio grows)</option>
          ${cash ? `<option value="cash">My cash (${eur(cash.value)})</option>` : ""}
        </select></div>
      <div class="sim-field"><label for="sim-broker">Broker (for costs)</label>
        <select id="sim-broker">${state.brokers.map((b) => `<option value="${esc(b.id)}"${b === defaultBroker ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
      <div class="sim-field"><label for="sim-erp">Equity risk premium (% / year)</label><input id="sim-erp" type="number" step="0.1" value="${DEFAULT_ERP_PCT}">
        <p class="sim-help">An assumption: the extra return stocks are expected to earn over the risk-free rate. 4-6% is a common range.</p></div>
      <div class="sim-field"><label for="sim-mu">Expected return override (% / year, optional)</label><input id="sim-mu" type="number" step="0.1" placeholder="leave empty to use the model">
        <p class="sim-help">Your own view of this security's yearly return (after fees). Leave empty to use CAPM / the Treasury yield.</p></div>
    </div>
    <div class="sim-actions"><button type="button" class="sim-btn sim-primary" id="sim-run">Run simulation</button><button type="button" class="sim-btn" id="sim-refresh-price">Refresh live price</button></div>
    <p class="sim-note" id="sim-ticket-msg"></p>`;

  const side = () => document.querySelector("#sim-side .is-active").dataset.side;
  document.querySelectorAll("#sim-side button").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll("#sim-side button").forEach((b) => b.classList.toggle("is-active", b === btn));
    $("sim-security").innerHTML = securityOptionsHTML(side());
    $("sim-side-help").textContent = side() === "sell" ? "You can only sell what you hold; the amount is capped at the position." : "Buy any security in the database. Sell only what you hold.";
    const f = $("sim-funding");
    if (f.options[0]) f.options[0].textContent = side() === "sell" ? "Proceeds leave the portfolio" : "New money (portfolio grows)";
    if (f.options[1]) f.options[1].textContent = side() === "sell" ? `Proceeds go to my cash (${eur(cash?.value)})` : `My cash (${eur(cash?.value)})`;
  }));
  $("sim-run").addEventListener("click", () => runFromTicket());
  $("sim-refresh-price").addEventListener("click", async () => {
    const id = $("sim-security").value;
    await refreshPrice(id, $("sim-ticket-msg"));
  });
}

async function refreshPrice(securityId, msgEl) {
  if (!securityId) return;
  msgEl.className = "sim-note"; msgEl.textContent = "Fetching the latest price…";
  try {
    const { data, error } = await window.db.functions.invoke("refresh-quote", { body: { security_id: securityId } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    state.priceCache.delete(securityId);
    msgEl.textContent = `Latest price: ${data.close} for ${fmtDay(data.date)}${data.cached ? " (fetched less than a minute ago)" : ""}.`;
  } catch (err) {
    msgEl.className = "sim-note is-error";
    msgEl.textContent = `Couldn't fetch a live price: ${err.message || err}`;
  }
}

function ticketParams() {
  return {
    side: document.querySelector("#sim-side .is-active").dataset.side,
    securityId: $("sim-security").value,
    amount: Number($("sim-amount").value),
    years: Math.max(1, Number($("sim-years").value) || 5),
    funding: $("sim-funding").value,
    brokerId: $("sim-broker").value,
    erpPct: Number($("sim-erp").value),
    muOverridePct: $("sim-mu").value === "" ? null : Number($("sim-mu").value),
  };
}

async function runFromTicket() {
  const msg = $("sim-ticket-msg");
  const p = ticketParams();
  if (!p.securityId) { msg.className = "sim-note is-error"; msg.textContent = "Pick a security first."; return; }
  if (!(p.amount > 0)) { msg.className = "sim-note is-error"; msg.textContent = "Enter an amount above zero."; return; }
  msg.className = "sim-note"; msg.textContent = "Calculating…";
  try {
    const result = await simulate(p);
    msg.textContent = "";
    state.lastRun = result;
    renderResult(result);
  } catch (err) {
    msg.className = "sim-note is-error";
    msg.textContent = err.message || String(err);
  }
}

/* ---------- The simulation ---------- */

/** Real (not interpolated) points of a daily index series, as {date, value}. */
function realPoints(series) {
  return (series || []).filter((p) => p.real).map((p) => ({ date: p.date, value: p.value }));
}

function marketMonthlyReturns() {
  const sp = (state.data?.history?.benchmarks || []).find((b) => b.id === "sp500") || (state.data?.history?.benchmarks || [])[0];
  if (!sp) return [];
  // Only the real-index segment: the later SPY proxy segment is on a ~10x
  // different scale and must never be divided against it.
  const segment = sp.series.filter((p) => !p.instrumentType || p.instrumentType === sp.instrumentType || p.instrumentType === "index");
  return SimulatorEngine.monthlyReturns(segment.map((p) => ({ date: p.date, value: p.value })));
}

function priceSeriesPoints(rows) {
  return rows.map((r) => ({ date: r.date, value: Number(r.adjusted_close ?? r.close) }));
}

/** Splits the current portfolio into blocks [CASH, R, X] with expected
    returns and an annual covariance matrix, so the engine can score a trade.
    mode "buy": X starts at 0; R = the whole non-cash portfolio.
    mode "sell": X = the held position; R = the rest of the non-cash part,
    whose variance/covariance are backed out from the portfolio's own. */
function buildBlocks({ mode, V, vCash, vX, varP, covPX, varX, muP, muX, rf }) {
  const wc = vCash / V;
  const noncash = 1 - wc;
  const notes = [];
  const muCash = rf;
  let ids = ["CASH", "R", "X"];

  const muQ = noncash > 1e-9 ? (muP - wc * rf) / noncash : muP;
  const varQ = noncash > 1e-9 ? varP / (noncash * noncash) : 0;
  const covQX = noncash > 1e-9 ? covPX / noncash : 0;

  if (mode === "buy") {
    return {
      ids, notes,
      positions: [{ id: "CASH", value: vCash }, { id: "R", value: V - vCash }, { id: "X", value: 0 }],
      mu: [muCash, muQ, muX],
      cov: [[0, 0, 0], [0, varQ, covQX], [0, covQX, varX]],
    };
  }
  // sell
  const wH = vX / V;
  const a = noncash > 1e-9 ? wH / noncash : 1;
  let valueR = V - vCash - vX;
  let muR = 0, varR = 0, covRX = 0;
  if (a >= 0.999 || valueR < 1e-9) {
    valueR = Math.max(valueR, 0);
    notes.push("This is (almost) your only non-cash holding, so there is no 'rest of the portfolio' to compare with.");
    muR = muQ; varR = 0; covRX = 0;
  } else {
    covRX = (covQX - a * varX) / (1 - a);
    varR = (varQ - a * a * varX - 2 * a * (1 - a) * covRX) / ((1 - a) * (1 - a));
    if (varR < 0) { varR = 0; notes.push("The rest-of-portfolio variance came out negative from the available history and was set to zero (approximation)."); }
    muR = (muQ - a * muX) / (1 - a);
  }
  return {
    ids, notes,
    positions: [{ id: "CASH", value: vCash }, { id: "R", value: valueR }, { id: "X", value: vX }],
    mu: [muCash, muR, muX],
    cov: [[0, 0, 0], [0, varR, covRX], [0, covRX, varX]],
  };
}

function expectedReturnFor({ sec, betaX, rfPct, erpPct, ratesByBucket, overridePct }) {
  const terPct = sec.details?.ter_pct != null ? Number(sec.details.ter_pct) : 0;
  if (overridePct != null) return { pct: overridePct, method: "your override", terApplied: false };
  const bucketKey = TREASURY_ETF_YIELD[sec.sub_theme];
  if (sec.theme === "US Treasuries" && bucketKey && ratesByBucket[bucketKey]) {
    return { pct: ratesByBucket[bucketKey].rate - terPct, method: `${bucketKey.replace("year", "-year")} Treasury yield minus fees`, terApplied: true };
  }
  return { pct: SimulatorEngine.capmExpectedPct({ rfPct, beta: betaX, erpPct }) - terPct, method: "CAPM (risk-free + beta x risk premium) minus fees", terApplied: true };
}

async function simulate(p, { quiet = false } = {}) {
  const E = SimulatorEngine;
  const sec = state.universe.find((s) => s.id === p.securityId);
  if (!sec) throw new Error("Unknown security.");
  const data = state.data;
  const perf = data.analytics.performance;
  const V = Number(perf.totalValue);
  if (!(V > 0)) throw new Error("Your portfolio has no recorded value yet.");
  const cash = cashHolding();
  const vCash = cash ? cash.value : 0;
  const held = heldNonCash().find((h) => h.id === p.securityId);
  if (p.side === "sell" && !held) throw new Error("You can only sell something you hold.");

  const rf3 = state.rates["3month"];
  if (!rf3) throw new Error("No risk-free rate yet. Refresh the Treasury yields (or run the fetch-risk-free-rate function) first.");
  const rfPct = rf3.rate;

  // --- price (needed for units and for the security's own history) ---
  const priceRows = sec.data_provider_symbol ? await loadPriceHistory(sec.id) : [];
  const last = lastPriceRow(priceRows);

  // --- return series ---
  const marketRet = marketMonthlyReturns();
  const portRet = E.monthlyReturns(realPoints(data.history.performanceSeries));
  let xRet;
  let xSource;
  if (priceRows.length >= 3) { xRet = E.monthlyReturns(priceSeriesPoints(priceRows)); xSource = "price history"; }
  else if (held) {
    const sp = (perf.securityPerformance || []).find((s) => s.id === held.id);
    xRet = E.monthlyReturns(realPoints(sp?.dailySeries));
    xSource = "your recorded valuations";
  } else {
    throw new Error(`No price history for ${sec.name} yet, so its risk can't be measured. Resolve its price symbol and backfill prices first (see the data steps).`);
  }

  const aligned = E.alignReturns({ M: marketRet, P: portRet, X: xRet });
  const overlap = aligned.months.length;
  // Hard floor. The free EODHD plan only serves about one year of history,
  // so ~10-12 monthly returns is what many ETFs will have: enough to run,
  // never enough to trust - dataWarnings() flags anything under 36 months.
  if (overlap < MIN_OVERLAP_MONTHS) {
    throw new Error(`Only ${overlap} months overlap between ${sec.name}, your portfolio and the market - at least ${MIN_OVERLAP_MONTHS} are needed to estimate risk. Backfill more price history (a longer data plan helps) or wait for more data.`);
  }

  const d = aligned.data;
  const betaP = E.beta(d.P, d.M), betaX = E.beta(d.X, d.M);
  const rho = E.correlation(d.P, d.X);
  const annual = E.annualCovMatrix(aligned, ["P", "X"]);
  const varP = annual[0][0], varX = annual[1][1], covPX = annual[0][1];

  // --- expected returns (assumptions, stated) ---
  const erpPct = Number.isFinite(p.erpPct) ? p.erpPct : DEFAULT_ERP_PCT;
  const muPpct = E.capmExpectedPct({ rfPct, beta: betaP, erpPct });
  const exp = expectedReturnFor({ sec, betaX, rfPct, erpPct, ratesByBucket: state.rates, overridePct: p.muOverridePct });

  // --- blocks and score ---
  const vX = held ? held.value : 0;
  const blocks = buildBlocks({
    mode: p.side, V, vCash, vX, varP, covPX, varX,
    muP: muPpct / 100, muX: exp.pct / 100, rf: rfPct / 100,
  });
  const trade = { id: "X", side: p.side, amount: p.amount, funding: p.funding };
  const score = E.scoreTrade({ positions: blocks.positions, ids: blocks.ids, mu: blocks.mu, cov: blocks.cov, rf: rfPct / 100, trade, cashId: "CASH" });
  const maxAmount = p.side === "sell" ? vX : Math.max(p.amount * 3, V * 0.5);
  const curve = E.sharpeCurve({ positions: blocks.positions, ids: blocks.ids, mu: blocks.mu, cov: blocks.cov, rf: rfPct / 100, tradeBase: { id: "X", side: p.side, funding: p.funding }, cashId: "CASH", maxAmount, steps: 40 });

  // --- outcomes + costs ---
  const applied = score.applied.appliedAmount;
  const inflPct = state.inflation?.yoyPct ?? 0;
  const projection = E.projectValue({ amount: applied, muPct: exp.pct, sigmaPct: Math.sqrt(varX) * 100, years: p.years, inflationPct: inflPct });
  const broker = state.brokers.find((b) => b.id === p.brokerId);
  const lc = listingCurrency(sec.data_provider_symbol, sec.price_currency);
  const costs = E.tradeCosts({
    amount: applied, years: p.years, terPct: sec.details?.ter_pct != null ? Number(sec.details.ter_pct) : 0,
    commissionPct: broker?.etf_commission != null ? Number(broker.etf_commission) : 0,
    fxPct: lc && lc !== "EUR" && broker?.fx_fee_pct != null ? Number(broker.fx_fee_pct) : 0,
  });
  const units = last && lc === "EUR" ? applied / Number(last.close) : null;

  const warnings = E.dataWarnings({
    overlapMonths: overlap, candidateMonths: xRet.length,
    priceAgeDays: last ? daysSince(last.date) : null, ratesAgeDays: daysSince(rf3.date),
  });
  blocks.notes.forEach((t) => warnings.push({ level: "info", text: t }));
  if (score.applied.clamped) warnings.push({ level: "info", text: p.side === "sell" ? "The amount was capped at the position you hold." : "The amount was capped at the cash available." });
  if (sec.currency && sec.currency !== "EUR") warnings.push({ level: "info", text: `The fund's currency is ${sec.currency}: its price in EUR also moves with the exchange rate (reflected in the EUR price history, but not hedged).` });
  if (!lc && !last) warnings.push({ level: "medium", text: "No live price is available for this security yet, so units can't be calculated." });
  if (!lc && last) warnings.push({ level: "info", text: "The price currency of this listing isn't known, so units aren't shown." });
  if (held && p.side === "buy") warnings.push({ level: "info", text: "You already hold this security; the 'rest of portfolio' block still includes it, so its correlation with the rest is somewhat overstated." });

  return {
    params: p, sec, held, V, vCash, applied, units, last, lc, broker,
    rfPct, rf3, erpPct, exp, muPpct, betaP, betaX, rho, overlap, months: xRet.length, xSource,
    volP: Math.sqrt(varP) * 100, volX: Math.sqrt(varX) * 100,
    cagrX: E.cagrPct(xRet.map((r) => r.r)), mddX: priceRows.length ? E.maxDrawdownPct(priceSeriesPoints(priceRows)) : null,
    before: score.before, after: score.after, curve, projection, costs, warnings, inflPct,
    inflationDate: state.inflation?.date, benchmarkDate: (data.history.benchmarks || [])[0]?.series?.slice(-1)[0]?.date,
    portfolioDate: (data.history.performanceSeries || []).slice(-1)[0]?.date,
  };
}

/* ---------- Result rendering ---------- */

function tile(label, value, sub = "") {
  return `<div class="sim-tile"><span class="sim-tile-label">${label}</span><span class="sim-tile-value">${value}</span>${sub ? `<span class="sim-tile-sub">${sub}</span>` : ""}</div>`;
}

function curveSVG(curve, current) {
  const pts = curve.points.filter((p) => p.sharpe != null);
  if (pts.length < 2) return "";
  const W = 560, H = 160, pad = { l: 44, r: 12, t: 12, b: 28 };
  const xs = pts.map((p) => p.amount), ys = pts.map((p) => p.sharpe);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (y) => H - pad.b - ((y - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.amount).toFixed(1)},${sy(p.sharpe).toFixed(1)}`).join(" ");
  const best = curve.best;
  return `
    <svg viewBox="0 0 ${W} ${H}" class="sim-curve" role="img" aria-label="Portfolio Sharpe ratio by trade size">
      <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" class="sim-axis"/>
      <path d="${path}" class="sim-line" fill="none"/>
      ${best ? `<circle cx="${sx(best.amount)}" cy="${sy(best.sharpe)}" r="4.5" class="sim-best"/><text x="${Math.min(sx(best.amount) + 8, W - 90)}" y="${sy(best.sharpe) < pad.t + 14 ? sy(best.sharpe) + 16 : sy(best.sharpe) - 8}" class="sim-curve-label">best ≈ ${eur(best.amount)}</text>` : ""}
      ${current ? `<circle cx="${sx(current.amount)}" cy="${sy(current.sharpe)}" r="4" class="sim-now"/>` : ""}
      <text x="${pad.l}" y="${H - 8}" class="sim-curve-label">${eur(x0)}</text>
      <text x="${W - pad.r}" y="${H - 8}" class="sim-curve-label" text-anchor="end">${eur(x1)}</text>
      <text x="4" y="${sy(y1) + 4}" class="sim-curve-label">${y1.toFixed(2)}</text>
      <text x="4" y="${sy(y0) + 4}" class="sim-curve-label">${y0.toFixed(2)}</text>
    </svg>`;
}

function renderResult(r) {
  const card = $("sim-result-card");
  card.hidden = false;
  const verb = r.params.side === "buy" ? "Buy" : "Sell";
  $("sim-result-title").textContent = `${verb} ${eur(r.applied)} of ${r.sec.name}`;

  const dSharpe = r.after.sharpe != null && r.before.sharpe != null ? r.after.sharpe - r.before.sharpe : null;
  const verdict = dSharpe == null ? "" : dSharpe > 0.005
    ? `<p class="sim-verdict is-good">Under these assumptions this trade <b>raises</b> your portfolio's Sharpe ratio by ${dSharpe.toFixed(2)}.</p>`
    : dSharpe < -0.005
      ? `<p class="sim-verdict is-bad">Under these assumptions this trade <b>lowers</b> your portfolio's Sharpe ratio by ${Math.abs(dSharpe).toFixed(2)}.</p>`
      : `<p class="sim-verdict">Under these assumptions this trade barely changes your Sharpe ratio.</p>`;

  const px = r.last
    ? `${Number(r.last.close).toFixed(2)}${r.lc ? ` ${r.lc}` : ""} <small>on ${fmtDay(r.last.date)}${r.last.fetched_at ? `, fetched ${fmtStamp(r.last.fetched_at)}` : ""}</small>`
    : "no price yet";
  const proj = r.projection;
  const bestLine = r.curve.best
    ? `Within the range tested, the portfolio's Sharpe ratio is highest at about <b>${eur(r.curve.best.amount)}</b> (${pct(r.curve.best.weight * 100, 1)} of the portfolio in this security), assuming the same inputs.`
    : "";
  const warn = r.warnings.map((w) => `<li class="is-${w.level}">${esc(w.text)}</li>`).join("");

  $("sim-result-body").innerHTML = `
    ${verdict}
    <div class="sim-tiles">
      ${tile("Latest price", px, r.units != null ? `≈ ${r.units.toFixed(3)} units for ${eur(r.applied)}` : "")}
      ${tile("Expected return", pct(r.exp.pct), r.exp.method)}
      ${tile("Volatility (history)", pct(r.volX), `${r.months} months of ${r.xSource}`)}
      ${tile("Beta to S&P 500", r.betaX != null ? r.betaX.toFixed(2) : "—", `portfolio beta ${r.betaP != null ? r.betaP.toFixed(2) : "—"}`)}
      ${tile("Correlation with your portfolio", r.rho != null ? r.rho.toFixed(2) : "—", `${r.overlap} overlapping months`)}
      ${tile("Worst fall (history)", r.mddX != null ? pct(r.mddX, 1) : "—", "peak to trough, month-end prices")}
    </div>

    <h3 class="sim-h3">Effect on your portfolio</h3>
    <div class="sim-table-wrap"><table class="sim-table">
      <thead><tr><th></th><th>Before</th><th>After</th><th>Change</th></tr></thead>
      <tbody>
        <tr><td>Expected return</td><td>${pct(r.before.mu * 100)}</td><td>${pct(r.after.mu * 100)}</td><td>${pct((r.after.mu - r.before.mu) * 100)}</td></tr>
        <tr><td>Volatility</td><td>${pct(r.before.sigma * 100)}</td><td>${pct(r.after.sigma * 100)}</td><td>${pct((r.after.sigma - r.before.sigma) * 100)}</td></tr>
        <tr><td>Sharpe ratio</td><td>${r.before.sharpe != null ? r.before.sharpe.toFixed(2) : "—"}</td><td>${r.after.sharpe != null ? r.after.sharpe.toFixed(2) : "—"}</td><td>${dSharpe != null ? (dSharpe >= 0 ? "+" : "") + dSharpe.toFixed(2) : "—"}</td></tr>
      </tbody>
    </table></div>
    <p class="sim-note">Sharpe = (expected return − ${pct(r.rfPct)} risk-free) ÷ volatility, from the model above - not your realised Sharpe on the Performance page.</p>
    ${curveSVG(r.curve, { amount: r.applied, sharpe: r.after.sharpe })}
    ${bestLine ? `<p class="sim-note">${bestLine}</p>` : ""}

    <h3 class="sim-h3">If you hold it for ${r.params.years} year${r.params.years === 1 ? "" : "s"}</h3>
    <div class="sim-tiles">
      ${tile("Likely range (10th - 90th percentile)", `${eur(proj.nominal.p10)} - ${eur(proj.nominal.p90)}`, `median ${eur(proj.nominal.median)} · started with ${eur(r.applied)}`)}
      ${tile("After inflation", `${eur(proj.real.p10)} - ${eur(proj.real.p90)}`, `at ${pct(r.inflPct)} a year${r.inflationDate ? ` (CPI as of ${fmtDay(r.inflationDate)})` : ""}`)}
      ${tile("Fund fees over the period", eur(r.costs.terOverHorizon), `${r.sec.details?.ter_pct != null ? pct(Number(r.sec.details.ter_pct)) : "TER unknown"} a year - already inside the fund's price`)}
      ${tile("Trading costs (buy + later sale)", eur(r.costs.totalOneOff), r.broker ? `${esc(r.broker.name)}: ${Number(r.broker.etf_commission) ? pct(Number(r.broker.etf_commission)) + " commission" : "no commission"}${r.lc && r.lc !== "EUR" && Number(r.broker.fx_fee_pct) ? `, ${pct(Number(r.broker.fx_fee_pct))} FX` : ""}` : "")}
    </div>
    <p class="sim-note">The range is a statistical model from the security's own volatility and the expected return above - an illustration of uncertainty, not a prediction. Taxes are not included.</p>

    ${warn ? `<ul class="sim-warnings">${warn}</ul>` : ""}

    <h3 class="sim-h3">Where each input comes from</h3>
    <div class="sim-table-wrap"><table class="sim-table sim-sources">
      <tbody>
        <tr><td>Price</td><td>${r.last ? `${fmtDay(r.last.date)}${r.last.fetched_at ? ` (fetched ${fmtStamp(r.last.fetched_at)})` : ""}` : "none"}</td></tr>
        <tr><td>Security's price history</td><td>${r.months} monthly returns, to ${fmtDay(r.last?.date)}</td></tr>
        <tr><td>Your portfolio's return history</td><td>to ${fmtDay(r.portfolioDate)}</td></tr>
        <tr><td>S&P 500 (for beta)</td><td>to ${fmtDay(r.benchmarkDate)}</td></tr>
        <tr><td>Risk-free rate (3-month Treasury)</td><td>${pct(r.rfPct)} as of ${fmtDay(r.rf3.date)}</td></tr>
        <tr><td>Fund facts (TER, size)</td><td>verified ${fmtDay(r.sec.details?.last_verified)}</td></tr>
        <tr><td>Equity risk premium</td><td>${pct(r.erpPct, 1)} - your assumption</td></tr>
      </tbody>
    </table></div>
    <p class="sim-note sim-disclaimer">Model output for research and learning. It is not personal investment advice, and markets can behave very differently from any model.</p>`;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Guided suggestions ---------- */

function renderReco() {
  const body = $("sim-reco-body");
  if (!state.signedIn) { body.innerHTML = lockedHTML({ hint: "Suggestions are ranked against your own portfolio, so they're private." }); return; }
  const themes = [...new Set(state.universe.map((s) => s.theme).filter(Boolean))].sort();
  body.innerHTML = `
    <div class="sim-form">
      <div class="sim-field"><label for="reco-objective">What matters most?</label>
        <select id="reco-objective">
          <option value="sharpe">Best risk-adjusted return (Sharpe)</option>
          <option value="growth">Highest expected growth</option>
          <option value="risk">Lowest portfolio risk</option>
        </select></div>
      <div class="sim-field"><label for="reco-amount">Amount to invest (EUR)</label><input id="reco-amount" type="number" min="0" step="any" value="100"></div>
      <div class="sim-field"><label for="reco-years">Horizon (years)</label><input id="reco-years" type="number" min="1" max="40" value="5"></div>
      <div class="sim-field"><label for="reco-cap">Max share of portfolio in one security (%)</label><input id="reco-cap" type="number" min="1" max="100" value="25"></div>
      <div class="sim-field sim-wide"><label>Which groups to consider?</label>
        <div class="sim-checks">${themes.map((t) => `<label><input type="checkbox" class="reco-theme" value="${esc(t)}" checked> ${esc(t)}</label>`).join("")}
          <label><input type="checkbox" class="reco-theme" value="__other__" checked> Everything else</label></div></div>
    </div>
    <div class="sim-actions"><button type="button" class="sim-btn sim-primary" id="reco-run">Rank securities</button></div>
    <p class="sim-note" id="reco-msg"></p>
    <div id="reco-results"></div>`;
  $("reco-run").addEventListener("click", runReco);
}

async function runReco() {
  const msg = $("reco-msg"), out = $("reco-results");
  const objective = $("reco-objective").value;
  const amount = Number($("reco-amount").value), years = Number($("reco-years").value) || 5;
  const cap = (Number($("reco-cap").value) || 25) / 100;
  const themes = new Set([...document.querySelectorAll(".reco-theme:checked")].map((c) => c.value));
  if (!(amount > 0)) { msg.className = "sim-note is-error"; msg.textContent = "Enter an amount above zero."; return; }
  const erp = Number($("sim-erp")?.value) || DEFAULT_ERP_PCT;
  const broker = $("sim-broker")?.value || state.brokers[0]?.id;

  const candidates = state.universe.filter((s) => s.data_provider_symbol && (themes.has(s.theme || "__other__") || (!s.theme && themes.has("__other__"))));
  if (!candidates.length) { msg.className = "sim-note is-error"; msg.textContent = "No securities with price data match - resolve their price symbols and backfill prices first."; out.innerHTML = ""; return; }

  msg.className = "sim-note"; out.innerHTML = "";
  const rows = [], skipped = [];
  for (let i = 0; i < candidates.length; i++) {
    msg.textContent = `Scoring ${i + 1} of ${candidates.length}: ${candidates[i].name}…`;
    try {
      const r = await simulate({ side: "buy", securityId: candidates[i].id, amount, years, funding: "new", brokerId: broker, erpPct: erp, muOverridePct: null });
      const weightAfter = r.applied / (r.V + r.applied);
      if (weightAfter > cap + 1e-9) { skipped.push({ name: candidates[i].name, why: `would be ${pct(weightAfter * 100, 1)} of the portfolio (cap ${pct(cap * 100, 0)})` }); continue; }
      rows.push(r);
    } catch (err) {
      skipped.push({ name: candidates[i].name, why: err.message });
    }
  }
  msg.textContent = "";
  const key = { sharpe: (r) => r.after.sharpe ?? -Infinity, growth: (r) => r.after.mu, risk: (r) => -r.after.sigma }[objective];
  rows.sort((a, b) => key(b) - key(a));
  const top = rows.slice(0, 5);

  out.innerHTML = `
    ${top.length ? `<div class="sim-table-wrap"><table class="sim-table sim-reco">
      <thead><tr><th>#</th><th>Security</th><th>Sharpe after</th><th>Δ Sharpe</th><th>Exp. return after</th><th>Volatility after</th><th>Correlation</th><th></th></tr></thead>
      <tbody>${top.map((r, i) => `
        <tr><td>${i + 1}</td>
          <td>${esc(r.sec.name)}<small class="sim-sub">${esc(r.sec.sub_theme || r.sec.theme || r.sec.type)} · data to ${fmtDay(r.last?.date)}${r.warnings.some((w) => w.level === "high" || w.level === "medium") ? " · <span class=\"sim-flag\">check warnings</span>" : ""}</small></td>
          <td>${r.after.sharpe != null ? r.after.sharpe.toFixed(2) : "—"}</td>
          <td>${r.after.sharpe != null && r.before.sharpe != null ? ((r.after.sharpe - r.before.sharpe) >= 0 ? "+" : "") + (r.after.sharpe - r.before.sharpe).toFixed(2) : "—"}</td>
          <td>${pct(r.after.mu * 100)}</td><td>${pct(r.after.sigma * 100)}</td><td>${r.rho != null ? r.rho.toFixed(2) : "—"}</td>
          <td><button type="button" class="sim-btn" data-open="${esc(r.sec.id)}">Open</button></td></tr>`).join("")}</tbody>
    </table></div>
    <p class="sim-note">Ranked by ${{ sharpe: "portfolio Sharpe after the trade", growth: "portfolio expected return after the trade", risk: "lowest portfolio volatility after the trade" }[objective]} for ${eur(amount)} of new money, ${years} years, max ${pct(cap * 100, 0)} per security. Same model and assumptions as the simulator above; expected returns are assumptions, so a high rank means "fits your portfolio under these assumptions", not "will go up". Model output for research, not personal advice.</p>` : `<p class="sim-empty">No candidate could be scored.</p>`}
    ${skipped.length ? `<details class="sim-skipped"><summary>${skipped.length} not scored</summary><ul>${skipped.map((s) => `<li><b>${esc(s.name)}</b>: ${esc(s.why)}</li>`).join("")}</ul></details>` : ""}`;

  out.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelector('#sim-side [data-side="buy"]').click();
    $("sim-security").value = btn.dataset.open;
    $("sim-amount").value = amount; $("sim-years").value = years;
    $("sim-ticket-card").scrollIntoView({ behavior: "smooth", block: "start" });
    runFromTicket();
  }));
}

/* ---------- Init ---------- */

async function loadPage() {
  state.signedIn = !!currentUser();
  if (!window.db) { $("sim-fresh-body").innerHTML = `<p class="sim-empty">Supabase isn't configured yet.</p>`; return; }
  try {
    await loadMarketData();
    if (state.signedIn) await loadPrivateData();
  } catch (err) {
    $("sim-fresh-msg").className = "sim-note is-error";
    $("sim-fresh-msg").textContent = err.message || String(err);
  }
  renderFreshness();
  renderRates();
  renderOutlook();
  renderTicket();
  renderReco();
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };
  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, { heading: "Simulator", subtitle: "Try a trade on your portfolio before making it." });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));
  onAuthChange(() => loadPage());
  initAuth().then(loadPage);
}

document.addEventListener("DOMContentLoaded", init);

// exposed for tests / manual checks
window.__sim = { state, buildBlocks, inflationFromCpi, simulate, renderResult };
