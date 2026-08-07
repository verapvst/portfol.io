/* ============================================================
   ui.js - merged: every dashboard section renderer. Each one reads a
   slice of the repository's data shape and renders one card on the
   Overview page. Kept generic (renderBars takes a labelKey/drillType,
   not a hardcoded "currency"), so future sections (Transactions,
   Rebalancing, Goals, ...) are new functions here, not a new file.
   ============================================================ */

/* ---------- Portfolio Snapshot ----------
   The 4 core metrics, grouped into one card instead of four independent
   ones. Per the design brief: every tile is the same component (same
   icon colour, same chrome) - the only colour allowed to vary is the
   positive/negative signal. No sparkline: Performance already shows the
   trend, repeating it here was noise, not information.

   Owner Access: absolute values go through formatMoney() (masked in
   public mode, real euros in owner mode) - except Total Return, whose
   own value slot becomes its percentage in public mode rather than a
   mask, since "+21.01%" already tells the whole story without revealing
   size. Re-rendered whenever ownerMode changes (see app.js), same
   component either way - never a separate public/owner view. */

function buildKpiViewModels(data) {
  const perf = data.analytics.performance;
  const sign = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const owner = isOwnerMode();
  const returnPct = fmtPct(perf.totalReturnPct);

  // Compact 2x2, always exactly these four - Investor Return (XIRR)
  // lives on the Investment Performance card instead (see app.js), so
  // this grid never grows past a clean 2x2 when a new metric is added.
  return [
    {
      key: "value", docKey: "portfolio-value", label: "Portfolio Value", icon: "wallet",
      value: formatMoney(perf.totalValue),
      deltaValue: returnPct,
      note: "since inception",
      trend: sign(perf.totalReturnPct),
    },
    {
      key: "cash", docKey: "cash-available", label: "Cash Available", icon: "wallet",
      value: formatMoney(perf.cash),
      deltaValue: fmtPct(perf.cash / perf.totalValue * 100, { signed: false }),
      note: perf.cash > 0 ? "ready to invest" : "fully invested",
      trend: "",
    },
    {
      // Headline is always the TWR % - safe to show in public mode too
      // (it reveals nothing about size), and it's the one number this
      // card exists to answer ("how did the investment perform").
      // Unrealised Gain is a genuinely different question ("what
      // fraction of my money is currently profit") that legitimately
      // does move when capital is added/withdrawn - shown underneath,
      // labelled as its own thing, never blended into the headline.
      key: "return", docKey: "investment-return", label: "Investment Return", icon: "trendingUp",
      value: returnPct,
      deltaValue: owner ? fmtEUR(perf.unrealisedGain, { signed: true }) : fmtPct(perf.unrealisedGainPct),
      note: "unrealised gain",
      trend: sign(perf.totalReturnPct),
    },
    {
      key: "invested", docKey: "net-invested", label: "Invested Capital", icon: "landmark",
      value: formatMoney(perf.investedCapital),
      deltaValue: null,
      note: `since ${data.history.inceptionDate}`,
      trend: "",
    },
  ];
}

function kpiCardHTML(kpi) {
  const deltaHTML = kpi.deltaValue == null ? "" : `<span class="${kpi.trend || "text-muted"}">${kpi.deltaValue} </span>`;
  return `
    <div class="card glass interactive kpi-card rise" tabindex="0" role="button" aria-label="${kpi.label} details" data-drill-type="kpi" data-drill-id="${kpi.key}">
      <div class="kpi-top">
        <span class="kpi-icon">${icon(kpi.icon)}</span>
        <p class="kpi-label" data-info="${kpi.docKey}" tabindex="0" role="button" aria-label="About this metric">${kpi.label}</p>
      </div>
      <p class="kpi-value">${kpi.value}</p>
      <p class="kpi-sub">${deltaHTML}${kpi.note}</p>
    </div>`;
}

function renderSnapshot(container, kpis) {
  container.innerHTML = kpis.map(kpiCardHTML).join("");
}

/* ---------- Portfolio Allocation summary (Overview card) ----------
   Asset-class donut + a geography highlight - a headline, not the full
   breakdown. Product/Account tabs and the full geography/sector/currency/
   style dimensions all move to the dedicated Allocation page
   (docs/information-architecture.md); duplicating them here would be
   exactly what this redesign pass exists to stop doing. The old
   3-tab renderAllocationTabs is gone; EXPOSURE_GROUPINGS/renderExposure
   below are untouched and still real, working code - just not called
   from Overview anymore, ready for the Allocation page to call instead. */

function renderAllocationSummary(container, data) {
  const items = data.analytics.assetClassAllocation;
  const total = items.reduce((s, it) => s + it.weight, 0);

  const regions = data.analytics.regions.filter((r) => r.name !== "Unknown");
  const topRegion = [...regions].sort((a, b) => b.weight - a.weight)[0];
  const topCountry = [...data.analytics.countries].sort((a, b) => b.weight - a.weight)[0];

  container.innerHTML = `
    <div id="allocation-donut"></div>
    ${topCountry || topRegion ? `
      <div class="allocation-geo-highlight">
        ${topRegion ? `<span>${topRegion.name} <b>${topRegion.weight.toFixed(1)}%</b></span>` : ""}
        ${topCountry ? `<span>${topCountry.name} <b>${topCountry.weight.toFixed(1)}%</b></span>` : ""}
      </div>` : ""}
    <a class="link-more" href="#">View Allocation ${icon("arrowRight")}</a>`;

  renderDonut(container.querySelector("#allocation-donut"), items, "Asset Class", `${total.toFixed(1)}%`, { drillType: "assetClass" });
}

/* ---------- Top Holdings table ---------- */

function holdingsRowHTML(h) {
  const trend = h.returnPct > 0 ? "up" : h.returnPct < 0 ? "down" : "text-muted";
  return `
    <tr data-drill-type="holding" data-drill-id="${h.id}" tabindex="0" role="button" aria-label="${h.name} details">
      <td>
        <p class="asset-name">${h.name}</p>
        <p class="asset-ticker">${h.ticker} · ${h.type}</p>
      </td>
      <td>${h.weight.toFixed(1)}%</td>
      <td>${formatMoney(h.value)}</td>
      <td class="${trend}">${h.returnPct > 0 ? "+" : ""}${h.returnPct.toFixed(2)}%</td>
    </tr>`;
}

function renderHoldingsTable(container, holdings) {
  const top5 = [...holdings].sort((a, b) => b.weight - a.weight).slice(0, 5);
  container.innerHTML = `
    <div class="table-scroll">
      <table class="holdings-table">
        <thead>
          <tr><th>Asset</th><th>Weight</th><th>Market Value</th><th>Total Return</th></tr>
        </thead>
        <tbody>${top5.map(holdingsRowHTML).join("")}</tbody>
      </table>
    </div>
    <a class="link-more" href="portfolio-detail.html">View Portfolio Detail ${icon("arrowRight")}</a>`;
}

/* ---------- Exposure ----------
   Replaces the old separate Geographic Exposure + Currency Exposure
   cards with one component: the SAME world map for every tab, just a
   different real grouping of the same underlying data - switching tabs
   must never restructure the UI, only what the map/legend are grouped
   by. Currency does NOT get a fabricated country-by-country split: the
   repository has currency at the account level only (EUR<->BPI,
   USD<->Trading212), with no country link, so inventing one just to
   paint the map differently would be exactly the kind of fabricated
   number this app refuses to show elsewhere. Currency instead shows the
   same real country map as the Country tab and swaps in the real
   EUR/USD account-level legend - consistent visualization, honest data.

   EXPOSURE_GROUPINGS is a registry, not a switch statement: adding a
   real, distinct future grouping (e.g. a finer "Continent" split once
   the repository has one) is one new entry with its own mapData/legend,
   never a change to renderExposure itself. */

// regionForCountry lives in utils.js (COUNTRY_TO_REGION) - shared with
// shell.js's regionDrill() so the two can't drift out of sync again.

/** Every country tinted by its own real weight - the base grouping every
    other tab starts from. */
function exposureCountryData(data) {
  return data.analytics.countries.map((c) => ({ code: String(c.iso).padStart(3, "0"), name: c.name, pct: c.weight }));
}

/** Every country tinted by its region's aggregate real weight - so every
    country in "Europe" reads the same intensity. Still real data, just
    a coarser grouping of it. Region-level facts that were never
    country-specific to begin with (World/Global/Unknown/unspecified
    Europe or Emerging Markets - see repository.js) have no country to
    tint, so they only ever appear in the legend, never on the map. */
function exposureRegionData(data) {
  const regionWeight = Object.fromEntries(data.analytics.regions.map((r) => [r.name, r.weight]));
  return data.analytics.countries.map((c) => {
    const region = regionForCountry(c.name);
    return { code: String(c.iso).padStart(3, "0"), name: c.name, pct: regionWeight[region] || 0, region };
  });
}

/** Real countries with their own map dot, plus one honest aggregate row
    for the real weight that genuinely isn't attributable to a single
    country (a "European Union" bond, an MSCI World tracker, ...) - not
    a placeholder, a real number with no country to paint it on. */
function renderCountryLegend(container, mapEl, data) {
  const maxWeight = Math.max(...data.analytics.countries.map((c) => c.weight));
  const countryRows = data.analytics.countries.map((c) => `
    <div class="legend-row drill-row" data-drill-type="country" data-drill-id="${c.iso}" data-code="${String(c.iso).padStart(3, "0")}" tabindex="0" role="button">
      <span class="legend-dot" style="background:${interpolatePrimaryGradient(c.weight / maxWeight)}"></span>
      <span class="legend-name">${c.name}</span>
      <span class="legend-value">${c.weight.toFixed(2)}%</span>
    </div>`).join("");
  const restRow = `
    <div class="legend-row">
      <span class="legend-dot" style="background:${familyGradientCSS("grey")}"></span>
      <span class="legend-name">Not attributable to a single country</span>
      <span class="legend-value">${data.analytics.notCountrySpecificWeight.toFixed(2)}%</span>
    </div>`;
  container.innerHTML = countryRows + restRow;

  container.querySelectorAll(".legend-row[data-code]").forEach((row) => {
    const shape = mapEl.querySelector(`.country-shape[data-code="${row.dataset.code}"]`);
    if (!shape) return;
    row.addEventListener("mouseenter", () => shape.classList.add("is-highlighted"));
    row.addEventListener("mouseleave", () => shape.classList.remove("is-highlighted"));
  });
}

function renderRegionLegend(container, mapEl, data) {
  const countryRegions = exposureRegionData(data);
  container.innerHTML = data.analytics.regions.map((r) => {
    const codes = countryRegions.filter((c) => c.region === r.name).map((c) => c.code);
    return `
      <div class="legend-row drill-row" data-drill-type="region" data-drill-id="${r.name}" data-codes="${codes.join(",")}" tabindex="0" role="button">
        <span class="legend-dot" style="background:${familyGradientCSS(r.tone)}"></span>
        <span class="legend-name">${r.name}</span>
        <span class="legend-value">${r.weight.toFixed(2)}%</span>
      </div>`;
  }).join("");

  container.querySelectorAll(".legend-row").forEach((row) => {
    const codes = row.dataset.codes.split(",").filter(Boolean);
    const shapesFor = () => codes.map((code) => mapEl.querySelector(`.country-shape[data-code="${code}"]`)).filter(Boolean);
    row.addEventListener("mouseenter", () => shapesFor().forEach((el) => el.classList.add("is-highlighted")));
    row.addEventListener("mouseleave", () => shapesFor().forEach((el) => el.classList.remove("is-highlighted")));
  });
}

function renderCurrencyLegend(container, data) {
  container.innerHTML = data.analytics.currency.map((c) => `
    <div class="legend-row drill-row" data-drill-type="currency" data-drill-id="${c.code}" tabindex="0" role="button">
      <span class="legend-dot" style="background:${familyGradientCSS(c.tone)}"></span>
      <span class="legend-name">${c.code}</span>
      <span class="legend-value">${c.weight.toFixed(2)}%</span>
    </div>`).join("");
}

const EXPOSURE_GROUPINGS = {
  country: {
    label: "Country", info: "exposure-country",
    hint: "Where the portfolio is invested, by country",
    mapData: exposureCountryData,
    legend: (container, mapEl, data) => renderCountryLegend(container, mapEl, data),
  },
  region: {
    label: "Region", info: "exposure-region",
    hint: "The same exposure, grouped by region",
    mapData: exposureRegionData,
    legend: (container, mapEl, data) => renderRegionLegend(container, mapEl, data),
  },
  currency: {
    label: "Currency", info: "exposure-currency",
    hint: "The same exposure, by settlement currency",
    mapData: exposureCountryData,
    legend: (container, _mapEl, data) => renderCurrencyLegend(container, data),
  },
};

function renderExposure(elements, data) {
  const { tabsEl, vizEl, hintEl, titleEl } = elements;
  const keys = Object.keys(EXPOSURE_GROUPINGS);

  tabsEl.innerHTML = keys.map((key, i) =>
    `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${key}" role="tab" aria-selected="${i === 0}">${EXPOSURE_GROUPINGS[key].label}</button>`
  ).join("");

  const draw = (key) => {
    const grouping = EXPOSURE_GROUPINGS[key];
    hintEl.textContent = grouping.hint;
    titleEl.dataset.info = grouping.info;

    vizEl.innerHTML = `
      <div class="geo-layout">
        <div id="exposure-legend" class="legend-list"></div>
        <div class="map-wrap" id="exposure-map"></div>
      </div>`;
    const mapEl = vizEl.querySelector("#exposure-map");
    const legendEl = vizEl.querySelector("#exposure-legend");

    renderWorldMap(mapEl, grouping.mapData(data)).then(() => grouping.legend(legendEl, mapEl, data));
  };

  draw(keys[0]);

  tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabsEl.querySelectorAll(".tab-btn").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      draw(btn.dataset.tab);
    });
  });
}

/* ---------- Portfolio Health ----------
   Objective, computed-not-invented portfolio facts - no fabricated
   "health score". Every tile is a plain count or ratio derived from the
   portfolio/analytics domains, and every tile is clickable (per the
   navigation-hub philosophy: each metric explains itself on click). */

function renderPortfolioHealth(container, data) {
  const h = data.analytics.health;
  const tiles = [
    { label: "Holdings", value: h.holdingsCount, drillId: "holdings" },
    { label: "Accounts", value: h.accountsCount, drillId: "accounts" },
    { label: "Transactions", value: h.transactionsCount, drillId: "transactions" },
    { label: "Countries", value: h.countriesCount, drillId: "countries" },
    { label: "Asset Classes", value: h.assetClassesCount, drillId: "assetClasses" },
    { label: "Currencies", value: h.currenciesCount, drillId: "currencies" },
    { label: "Largest Position", value: `${h.largestPosition.weight.toFixed(1)}%`, drillId: "largest" },
    { label: "Cash Ratio", value: `${h.cashRatio.toFixed(1)}%`, drillId: "cash" },
  ];

  container.innerHTML = `
    <div class="health-grid">
      ${tiles.map((t) => `
        <div class="health-tile glass-quiet drill-row" data-drill-type="health" data-drill-id="${t.drillId}" tabindex="0" role="button" aria-label="${t.label} details">
          <div class="health-value">${t.value}</div>
          <div class="health-label">${t.label}</div>
        </div>`).join("")}
    </div>`;
}

/* ---------- Portfolio Insights ----------
   Rule-based insight sentences - computed from portfolio/analytics data,
   never a stored or AI-generated paragraph. Each rule is a plain
   function of the data; add a rule by adding a function, not a string.
   Each also carries a `drill` target, since every insight is itself an
   entry point into the topic it's about. */

function buildInsights(data) {
  const h = data.analytics.health;
  const largestHolding = data.portfolio.holdings.find((x) => x.weight === h.largestPosition.weight);
  const regions = data.analytics.regions.filter((r) => r.name !== "Unknown");
  const topRegion = [...regions].sort((a, b) => b.weight - a.weight)[0];
  const currency = data.analytics.currency;
  const topCurrency = [...currency].sort((a, b) => b.weight - a.weight)[0];

  const rules = [];

  rules.push({
    tone: "grey",
    html: `<b>${h.largestPosition.name}</b> represents <b>${h.largestPosition.weight.toFixed(1)}%</b> of the portfolio.`,
    drill: { type: "holding", id: largestHolding?.id },
  });

  if (h.largestPosition.weight > 50) {
    rules.push({ tone: "orange", html: `Top holding exceeds <b>50%</b> - concentration risk.`, drill: { type: "health", id: "largest" } });
  }

  if (topRegion) {
    rules.push({ tone: "grey", html: `<b>${topRegion.name}</b> represents <b>${topRegion.weight.toFixed(1)}%</b> of known geographic exposure.`, drill: { type: "region", id: topRegion.name } });
  }

  if (h.cashRatio < 5) {
    rules.push({ tone: "grey", html: `Cash allocation is <b>${h.cashRatio.toFixed(1)}%</b> - no cash buffer currently held.`, drill: { type: "kpi", id: "cash" } });
  }

  rules.push({ tone: "grey", html: `Portfolio spans <b>${h.countriesCount} countries</b> and <b>${h.assetClassesCount} asset classes</b>.`, drill: { type: "health", id: "countries" } });

  if (topCurrency && topCurrency.weight < 100) {
    rules.push({ tone: "blue", html: `<b>${topCurrency.weight.toFixed(1)}%</b> of the portfolio is <b>${topCurrency.code}</b>-denominated.`, drill: { type: "currency", id: topCurrency.code } });
  }

  return rules;
}

function renderInsights(container, data) {
  const rules = buildInsights(data);
  container.innerHTML = `
    <div class="insight-list">
      ${rules.map((r) => `
        <div class="insight-row drill-row" data-drill-type="${r.drill.type}" data-drill-id="${r.drill.id}" tabindex="0" role="button">
          <span class="insight-dot" style="background:${familyGradientCSS(r.tone)}"></span>
          <span class="insight-text">${r.html}</span>
        </div>`).join("")}
    </div>`;
}

window.buildKpiViewModels = buildKpiViewModels;
window.renderSnapshot = renderSnapshot;
window.renderAllocationSummary = renderAllocationSummary;
window.renderHoldingsTable = renderHoldingsTable;
window.renderExposure = renderExposure;
window.renderPortfolioHealth = renderPortfolioHealth;
window.buildInsights = buildInsights;
window.renderInsights = renderInsights;
