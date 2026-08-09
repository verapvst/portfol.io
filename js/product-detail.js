/* ============================================================
   product-detail.js - the Security Detail page ("tell me everything
   about this one product"). Reads a single security_details row (via
   db.js's loadProductDetail()) plus a real held-by-you check
   (isSecurityHeld()) - never inferred from the product catalogue
   itself. Cost Drag is computed live from this product's own TER/
   assumed gross return via calculations.js:costDrag(), never a stored
   or hardcoded figure - see that function's own comment for why.
   ============================================================ */

function $(id) { return document.getElementById(id); }

function productIdFromURL() {
  return new URLSearchParams(window.location.search).get("id");
}

function fmtPctPlain(v, digits = 2) {
  return v == null ? "—" : `${Number(v).toFixed(digits)}%`;
}
function fmtNumPlain(v, digits = 2) {
  return v == null ? "—" : Number(v).toLocaleString("en-IE", { maximumFractionDigits: digits });
}

function starsHTML(stars) {
  if (stars == null) return "—";
  return `<span class="product-stars" title="${stars} / 5">${"★".repeat(stars)}${"☆".repeat(5 - stars)}</span>`;
}

function qualityBadgeHTML(quality) {
  if (!quality) return "";
  const tone = quality === "Real" ? "real" : quality === "Partial" ? "partial" : "estimated";
  return `<span class="quality-badge quality-${tone}">${quality} data</span>`;
}

/* ---------- Section builders ---------- */

/* ---------- Scorecard ---------- */

/** Clockwise from the top, matching the old engine's own Scorecard
    dimension order (Custos/Eficiência/Retorno/Risco/Diversificação/
    Fiscalidade/Liquidez/Transparência/Escala) - not reshuffled. */
const SCORE_DIMENSIONS = [
  ["costs", "Cost"],
  ["effic", "Efficiency"],
  ["ret", "Return"],
  ["risk", "Risk"],
  ["div", "Diversification"],
  ["tax", "Tax"],
  ["liq", "Liquidity"],
  ["transp", "Transparency"],
  ["scale", "Scale"],
];

/** Thresholds match the old engine's scoreColor() exactly - not a new
    scale invented for this port. */
function scoreTone(v) {
  return v >= 70 ? "up" : v >= 45 ? "warn" : "down";
}

function scoreRingSVG(score) {
  const r = 42, c = 2 * Math.PI * r;
  if (score == null) {
    return `
      <svg viewBox="0 0 100 100" class="pd-score-ring" role="img" aria-label="No score available">
        <circle cx="50" cy="50" r="${r}" class="pd-score-ring-track"/>
        <text x="50" y="55" text-anchor="middle" class="pd-score-ring-text pd-score-ring-text-empty">—</text>
      </svg>`;
  }
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  const tone = scoreTone(score);
  return `
    <svg viewBox="0 0 100 100" class="pd-score-ring" role="img" aria-label="Score ${score} out of 100">
      <circle cx="50" cy="50" r="${r}" class="pd-score-ring-track"/>
      <circle cx="50" cy="50" r="${r}" class="pd-score-ring-fill pd-score-${tone}"
        stroke-dasharray="${filled.toFixed(2)} ${(c - filled).toFixed(2)}"
        stroke-dashoffset="${(c / 4).toFixed(2)}"/>
      <text x="50" y="55" text-anchor="middle" class="pd-score-ring-text">${score}</text>
    </svg>`;
}

/** Adapted from the old engine's Scorecard radar view (same 9 axes,
    same clockwise order) into this app's own visual language: brand
    coral fill instead of flat black/grey, var(--card-border) grid,
    var(--muted) labels, no borrowed styling. A dimension with no
    underlying data (sc[key] === null - see calculations.js:
    productScore()) is plotted at the centre but drawn as a hollow,
    dashed-stroke dot with a muted "—" label, never a filled coral point
    - "no data" must never look identical to "scored at the bottom". */
function radarChartSVG(sc) {
  const size = 320, cx = size / 2, cy = size / 2, maxR = 105;
  const n = SCORE_DIMENSIONS.length;
  const angleFor = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pointAt = (i, r) => ({ x: cx + r * Math.cos(angleFor(i)), y: cy + r * Math.sin(angleFor(i)) });

  const gridRings = [0.2, 0.4, 0.6, 0.8, 1.0].map((frac) => {
    const pts = SCORE_DIMENSIONS.map((_, i) => pointAt(i, maxR * frac));
    return `<polygon points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" class="pd-radar-grid"/>`;
  }).join("");

  const spokes = SCORE_DIMENSIONS.map((_, i) => {
    const p = pointAt(i, maxR);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" class="pd-radar-grid"/>`;
  }).join("");

  const dataPts = SCORE_DIMENSIONS.map(([key], i) => pointAt(i, (sc[key] == null ? 0 : Math.max(0, Math.min(100, sc[key]))) / 100 * maxR));
  const dataPolygon = `<polygon points="${dataPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" class="pd-radar-fill"/>`;
  const dataDots = SCORE_DIMENSIONS.map(([key], i) => {
    const p = dataPts[i];
    const empty = sc[key] == null;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" class="${empty ? "pd-radar-dot-empty" : "pd-radar-dot"}"/>`;
  }).join("");

  const labels = SCORE_DIMENSIONS.map(([key, label], i) => {
    const p = pointAt(i, maxR + 26);
    const anchor = Math.abs(p.x - cx) < 4 ? "middle" : p.x > cx ? "start" : "end";
    const valueClass = sc[key] == null ? "pd-radar-value-empty" : `pd-score-${scoreTone(sc[key])}`;
    return `
      <text x="${p.x.toFixed(1)}" y="${(p.y - 4).toFixed(1)}" text-anchor="${anchor}" class="pd-radar-label">${label}</text>
      <text x="${p.x.toFixed(1)}" y="${(p.y + 11).toFixed(1)}" text-anchor="${anchor}" class="pd-radar-value ${valueClass}">${sc[key] == null ? "—" : sc[key]}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${size} ${size}" class="pd-radar-svg" role="img" aria-label="Score breakdown by dimension">${gridRings}${spokes}${dataPolygon}${dataDots}${labels}</svg>`;
}

function scorecardHTML(p) {
  const sc = productScore(p);
  const incomplete = sc.dimensionsAvailable < sc.dimensionsTotal;
  return `
    <section class="card glass interactive" id="pd-scorecard-card">
      <div class="card-header">
        <div class="card-header-title" data-info="product-score" tabindex="0" role="button" aria-label="About this metric">
          <h2 class="section-title">Scorecard</h2>
        </div>
      </div>
      <div class="pd-scorecard-layout">
        <div class="pd-score-ring-wrap">
          ${scoreRingSVG(sc.overall)}
          <p class="pd-score-ring-caption">Overall${incomplete ? ` (${sc.dimensionsAvailable}/${sc.dimensionsTotal})` : ""}</p>
        </div>
        <div class="pd-radar-wrap">${radarChartSVG(sc)}</div>
      </div>
    </section>`;
}

function headerHTML(p, held) {
  const s = p.securities;
  return `
    <section class="card glass interactive" id="pd-header-card">
      <div class="pd-header-top">
        <div>
          <h1 class="pd-title">${s.name}${held ? '<span class="held-badge">Held</span>' : ""}</h1>
          <p class="section-hint" id="pd-subtitle">${s.institutions ? s.institutions.name : "Unknown issuer"} · ${s.type}${s.domicile ? ` · ${s.domicile}` : ""}</p>
        </div>
        ${qualityBadgeHTML(p.data_quality)}
      </div>
      <div class="pd-facts-grid">
        <div class="pd-fact"><span class="pd-fact-label">ISIN</span><span class="pd-fact-value">${s.isin || "—"}</span></div>
        <div class="pd-fact"><span class="pd-fact-label">Benchmark</span><span class="pd-fact-value">${s.benchmark || "—"}</span></div>
        <div class="pd-fact"><span class="pd-fact-label">Launched</span><span class="pd-fact-value">${p.launched_date || "—"}</span></div>
        <div class="pd-fact"><span class="pd-fact-label">AUM</span><span class="pd-fact-value">${p.aum_eur_millions != null ? `€${fmtNumPlain(p.aum_eur_millions, 1)}M` : "—"}</span></div>
        <div class="pd-fact"><span class="pd-fact-label">Rating</span><span class="pd-fact-value">${starsHTML(p.star_rating)}</span></div>
        <div class="pd-fact"><span class="pd-fact-label">SFDR</span><span class="pd-fact-value">${p.sfdr_article || "Not disclosed"}</span></div>
      </div>
      ${lastUpdatedHTML(p.updated_at, { label: "updated" })}
    </section>`;
}

function costsHTML(p) {
  return `
    <section class="card glass interactive" id="pd-costs-card">
      <div class="card-header">
        <div class="card-header-title" data-info="cost-drag" tabindex="0" role="button" aria-label="About this metric">
          <h2 class="section-title">Costs</h2>
        </div>
      </div>
      <div class="pd-stat-row">
        <div class="pd-stat"><span class="pd-stat-label">TER</span><span class="pd-stat-value">${fmtPctPlain(p.ter_pct)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Management Fee</span><span class="pd-stat-value">${fmtPctPlain(p.management_fee_pct)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Depositary Fee</span><span class="pd-stat-value">${fmtPctPlain(p.depositary_fee_pct)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Subscription Fee</span><span class="pd-stat-value">${fmtPctPlain(p.subscription_fee_pct)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Redemption Fee</span><span class="pd-stat-value">${fmtPctPlain(p.redemption_fee_pct)}</span></div>
      </div>
      ${lastUpdatedHTML(p.costs_as_of)}

      <div class="pd-cost-drag">
        <div class="pd-cost-drag-header">
          <p class="pd-cost-drag-title">Cumulative Cost Drag</p>
          <div class="filter-pills glass-quiet" id="pd-horizon-pills"></div>
        </div>
        <p class="pd-cost-drag-value" id="pd-cost-drag-value">—</p>
        <p class="pd-cost-drag-hint" id="pd-cost-drag-hint"></p>
      </div>
    </section>`;
}

function annualReturnsHTML(annual) {
  const years = Object.keys(annual || {}).sort((a, b) => b - a);
  if (!years.length) return "";
  return `
    <div class="pd-annual-returns">
      <p class="pd-subsection-label">Calendar-Year Returns</p>
      <div class="pd-annual-grid">
        ${years.map((y) => {
          const v = annual[y];
          const tone = v > 0 ? "up" : v < 0 ? "down" : "text-muted";
          return `<div class="pd-annual-cell"><span class="pd-annual-year">${y}</span><span class="pd-annual-value ${tone}">${fmtPctPlain(v)}</span></div>`;
        }).join("")}
      </div>
    </div>`;
}

function performanceHTML(p) {
  return `
    <section class="card glass interactive" id="pd-performance-card">
      <div class="card-header">
        <div class="card-header-title"><h2 class="section-title">Performance &amp; Risk</h2></div>
      </div>
      <div class="pd-stat-row">
        <div class="pd-stat"><span class="pd-stat-label">1Y Return</span><span class="pd-stat-value">${fmtPctPlain(p.return_1y_pct)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">3Y Return (ann.)</span><span class="pd-stat-value">${fmtPctPlain(p.return_3y_pct)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">5Y Return (ann.)</span><span class="pd-stat-value">${fmtPctPlain(p.return_5y_pct)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Volatility</span><span class="pd-stat-value">${fmtPctPlain(p.volatility_pct)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Sharpe Ratio</span><span class="pd-stat-value">${fmtNumPlain(p.sharpe_ratio)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Sortino Ratio</span><span class="pd-stat-value">${fmtNumPlain(p.sortino_ratio)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Beta</span><span class="pd-stat-value">${fmtNumPlain(p.beta)}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Max Drawdown</span><span class="pd-stat-value">${fmtPctPlain(p.max_drawdown_pct)}</span></div>
      </div>
      ${lastUpdatedHTML(p.performance_as_of)}
      ${annualReturnsHTML(p.annual_returns)}
    </section>`;
}

/* ---------- Market-price performance (Phase 2 - real daily_prices) ----------
   Deliberately a SEPARATE card from Performance & Risk above, not merged
   into it - that card reads security_details columns (this product's own
   researched/estimated figures, from the legacy dataset), this one reads
   real EODHD daily observations through calculations.js:
   securityMarketAnalytics(). Two different data sources answering a
   similar-sounding question; keeping them visually distinct is the point,
   not an oversight. See js/calculations.js's own header comment for the
   full Security Return vs Position Return rationale. */

function fmtDateShort(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function marketStatHTML(label, docKey, result, valueKey, caption) {
  const value = result ? fmtPctPlain(result[valueKey]) : "—";
  return `
    <div class="pd-stat">
      <span class="pd-stat-label"${docKey ? ` data-info="${docKey}" tabindex="0" role="button" aria-label="About this metric"` : ""}>${label}</span>
      <span class="pd-stat-value">${value}</span>
      <span class="pd-stat-caption">${result ? caption(result) : "Not enough history yet"}</span>
    </div>`;
}

function marketAnnualReturnsHTML(annual) {
  const years = Object.keys(annual || {}).sort((a, b) => b - a);
  if (!years.length) return "";
  return `
    <div class="pd-annual-returns">
      <p class="pd-subsection-label">Calendar-Year Price Returns</p>
      <div class="pd-annual-grid">
        ${years.map((y) => {
          const v = annual[y];
          if (!v.hasObservationInYear) {
            return `<div class="pd-annual-cell"><span class="pd-annual-year">${y}</span><span class="pd-annual-value text-muted">No data</span></div>`;
          }
          const tone = v.returnPct > 0 ? "up" : v.returnPct < 0 ? "down" : "text-muted";
          const caption = v.isYTD ? "YTD" : v.isPartialYear ? "Partial year" : "";
          return `
            <div class="pd-annual-cell">
              <span class="pd-annual-year">${y}</span>
              <span class="pd-annual-value ${tone}">${fmtPctPlain(v.returnPct)}</span>
              ${caption ? `<span class="pd-annual-caption">${caption} · ${fmtDateShort(v.rangeStart)} – ${fmtDateShort(v.rangeEnd)}</span>` : ""}
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

function marketPerformanceHTML(security, ma) {
  if (!ma.available) {
    return `
      <section class="card glass" id="pd-market-performance-card">
        <div class="card-header">
          <div class="card-header-title"><h2 class="section-title">Market-Price Performance</h2></div>
        </div>
        <p class="pd-market-unavailable">Market-price analytics unavailable for this security type - ${security.name} isn't exchange-traded with a verified market-data provider symbol, so no daily price history exists to analyse. Its performance is tracked instead through its own valuation history (see Portfolio Detail).</p>
      </section>`;
  }
  const p = ma.provenance;
  return `
    <section class="card glass interactive" id="pd-market-performance-card">
      <div class="card-header">
        <div class="card-header-title" data-info="security-market-performance" tabindex="0" role="button" aria-label="About this metric">
          <h2 class="section-title">Market-Price Performance</h2>
        </div>
      </div>
      <div class="pd-stat-row">
        ${marketStatHTML("Since Data Available", "security-since-data-available", ma.sinceDataAvailable, "returnPct", (r) => `As of ${fmtDateShort(r.endDate)} · ${p.source || "—"} · ${p.currency || "—"}`)}
        ${marketStatHTML("YTD Return", "security-ytd-return", ma.ytd, "returnPct", (r) => `As of ${fmtDateShort(r.endDate)} · ${p.source || "—"} · ${p.currency || "—"}`)}
        ${marketStatHTML("1Y Return", "security-1y-return", ma.oneYear, "returnPct", (r) => `As of ${fmtDateShort(r.endDate)} · ${p.source || "—"} · ${p.currency || "—"}`)}
        ${marketStatHTML("CAGR", "security-cagr", ma.cagr, "cagrPct", (r) => `Annualised over ${r.daysElapsed} days · ${fmtDateShort(r.startDate)}–${fmtDateShort(r.endDate)}`)}
        ${marketStatHTML("Annualised Volatility", "security-volatility", ma.volatility, "annualisedVolatilityPct", (r) => `Annualised · ${r.observationCount} observations · ${fmtDateShort(r.periodStart)}–${fmtDateShort(r.periodEnd)}`)}
        ${marketStatHTML("Max Drawdown", "security-max-drawdown", ma.maxDrawdown, "maxDrawdownPct", (r) => `Based on ${fmtDateShort(r.periodStart)}–${fmtDateShort(r.periodEnd)}`)}
      </div>
      ${marketAnnualReturnsHTML(ma.annualReturns)}
      <p class="pd-stat-caption" style="margin-top: var(--sp-4);">Price return (close), ${p.currency || "native currency"} · ${p.observationCount} observations, ${fmtDateShort(p.firstObservationDate)} – ${fmtDateShort(p.lastObservationDate)} · Source: ${p.source || "—"} · Imported: ${fmtDateShort(p.importedAt)}</p>
    </section>`;
}

function allocBarHTML(label, weight, tone) {
  if (weight == null) return "";
  return `
    <div class="bar-row">
      <div class="bar-row-label">
        <span class="bar-row-name">${label}</span>
        <span class="bar-row-value">${weight.toFixed(1)}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.max(0, weight)).toFixed(1)}%; background:${familyGradientCSS(tone)}"></div></div>
    </div>`;
}

function allocationHTML(p) {
  return `
    <section class="card glass interactive" id="pd-allocation-card">
      <div class="card-header">
        <div class="card-header-title"><h2 class="section-title">Allocation &amp; Exposure</h2></div>
      </div>
      <p class="pd-subsection-label">Asset Mix</p>
      ${allocBarHTML("Stocks", p.alloc_stocks_pct, "blue")}
      ${allocBarHTML("Bonds", p.alloc_bonds_pct, "green")}
      ${allocBarHTML("Other", p.alloc_other_pct, "purple")}
      <p class="pd-subsection-label pd-subsection-label-spaced">Geographic Exposure</p>
      ${allocBarHTML("United States", p.exposure_us_pct, "amber")}
      ${allocBarHTML("Europe", p.exposure_eu_pct, "orange")}
      ${allocBarHTML("Emerging Markets", p.exposure_em_pct, "coral")}
      <div class="pd-stat-row pd-stat-row-spaced">
        <div class="pd-stat"><span class="pd-stat-label">Holdings</span><span class="pd-stat-value">${p.holdings_count != null ? p.holdings_count.toLocaleString("en-IE") : "—"}</span></div>
        <div class="pd-stat"><span class="pd-stat-label">Top 10 Concentration</span><span class="pd-stat-value">${p.concentration_top10 != null ? fmtPctPlain(p.concentration_top10 * 100, 1) : "—"}</span></div>
      </div>
      ${lastUpdatedHTML(p.allocation_as_of)}
    </section>`;
}

function taxHTML(p) {
  return `
    <section class="card glass interactive" id="pd-tax-card">
      <div class="card-header">
        <div class="card-header-title"><h2 class="section-title">Portuguese Taxation</h2></div>
      </div>
      <p class="section-hint">Capital gains tax rate by holding period, plus any entry-contribution deduction.</p>
      <div class="pd-tax-grid">
        <div class="pd-tax-cell"><span class="pd-tax-period">&lt; 2 years</span><span class="pd-tax-rate">${fmtPctPlain(p.tax_rate_lt2y_pct)}</span></div>
        <div class="pd-tax-cell"><span class="pd-tax-period">2 – 5 years</span><span class="pd-tax-rate">${fmtPctPlain(p.tax_rate_2to5y_pct)}</span></div>
        <div class="pd-tax-cell"><span class="pd-tax-period">5 – 8 years</span><span class="pd-tax-rate">${fmtPctPlain(p.tax_rate_5to8y_pct)}</span></div>
        <div class="pd-tax-cell"><span class="pd-tax-period">&gt; 8 years</span><span class="pd-tax-rate">${fmtPctPlain(p.tax_rate_gt8y_pct)}</span></div>
      </div>
      ${p.tax_deduction_pct ? `<p class="pd-tax-deduction">Entry-contribution deduction: <b>${fmtPctPlain(p.tax_deduction_pct)}</b></p>` : ""}
    </section>`;
}

function provenanceHTML(p) {
  return `
    <section class="card glass" id="pd-provenance-card">
      <div class="card-header">
        <div class="card-header-title"><h2 class="section-title">Philosophy &amp; Data Provenance</h2></div>
      </div>
      ${p.philosophy ? `<p class="pd-philosophy">${p.philosophy}</p>` : ""}
      <p class="pd-provenance">Source: ${p.source || "—"}${p.last_verified ? ` · Last verified ${p.last_verified}` : ""}${p.legacy_product_id ? ` · Legacy ID ${p.legacy_product_id}` : ""}</p>
    </section>`;
}

/* ---------- Cost Drag interactivity ---------- */

const HORIZONS = [5, 10, 20, 30];
let currentHorizon = 20;

function renderCostDrag(p) {
  const drag = costDrag(p.assumed_gross_return_pct, p.ter_pct, currentHorizon);
  $("pd-cost-drag-value").textContent = drag == null ? "—" : `${drag.toFixed(1)}%`;
  $("pd-cost-drag-hint").textContent = drag == null
    ? "Not enough data to estimate this (missing TER or assumed gross return)."
    : `Over ${currentHorizon} years, assuming a ${fmtPctPlain(p.assumed_gross_return_pct, 1)} annual gross return, this product's ${fmtPctPlain(p.ter_pct, 2)} TER erodes roughly ${drag.toFixed(1)}% of what the investment would otherwise be worth.`;
}

function initHorizonPills(p) {
  const pillsEl = $("pd-horizon-pills");
  pillsEl.innerHTML = HORIZONS.map((h) => `<button class="filter-pill${h === currentHorizon ? " active" : ""}" data-horizon="${h}">${h}y</button>`).join("");
  pillsEl.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentHorizon = Number(btn.dataset.horizon);
      pillsEl.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderCostDrag(p);
    });
  });
}

/* ---------- Page init ---------- */

function renderProduct(p, held, marketAnalytics) {
  $("product-detail-body").innerHTML = `
    ${headerHTML(p, held)}
    ${scorecardHTML(p)}
    <div class="pd-two-col">
      <div class="pd-col">
        ${costsHTML(p)}
        ${performanceHTML(p)}
        ${marketPerformanceHTML(p.securities, marketAnalytics)}
      </div>
      <div class="pd-col">
        ${allocationHTML(p)}
        ${taxHTML(p)}
      </div>
    </div>
    ${provenanceHTML(p)}
  `;
  initHorizonPills(p);
  renderCostDrag(p);
}

function renderNotFound(reason) {
  $("product-detail-body").innerHTML = `
    <section class="card glass" id="pd-error-card">
      <p class="costs-error">${reason}</p>
      <p><a href="products.html">&larr; Back to Securities</a></p>
    </section>`;
}

async function loadProductDetailPage() {
  const id = productIdFromURL();
  if (!id) { renderNotFound("No product specified."); return; }

  const user = currentUser();
  if (!window.db) { renderNotFound("Supabase isn't configured yet (js/supabaseConfig.js)."); return; }
  if (!user) {
    $("product-detail-body").innerHTML = `
      <div class="costs-signin-note">
        Sign in to view product detail.
        <br/>
        <button type="button" id="pd-signin-cta">Sign In</button>
      </div>`;
    $("pd-signin-cta").addEventListener("click", () => window.openAuthModal());
    return;
  }

  $("product-detail-body").innerHTML = `<p class="costs-empty">Loading…</p>`;
  try {
    const [product, portfolioId, priceHistory] = await Promise.all([
      loadProductDetail(id),
      ensurePortfolio(),
      getHistoricalPrices(id),
    ]);
    if (!product) { renderNotFound("This product doesn't have research data on file."); return; }
    const held = await isSecurityHeld(portfolioId, id);
    const marketAnalytics = securityMarketAnalytics(product.securities, priceHistory);
    renderProduct(product, held, marketAnalytics);
  } catch (err) {
    renderNotFound(err.message || "Failed to load this product.");
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Security Detail",
    subtitle: "Everything on file for this product.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  onAuthChange(() => loadProductDetailPage());
  initAuth().then(loadProductDetailPage);
}

document.addEventListener("DOMContentLoaded", init);
