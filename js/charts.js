/* ============================================================
   charts.js - merged: every SVG chart primitive (the Portfolio
   Performance line chart, donut, world map). All hand-rolled SVG, no
   charting library. worldMap.js's D3/topojson dependency lives in
   vendor/ and is loaded before this file.
   ============================================================ */

/* ---------- Portfolio Performance line chart ---------- */

/**
 * "Portfolio Performance" area chart - hand-rolled SVG equivalent of the
 * reference's Recharts <AreaChart>. Points are evenly spaced by index
 * (categorical X axis, one point per month), matching how Recharts lays
 * out a categorical dataKey.
 *
 * formatValue/formatAxisValue are optional overrides (default: real
 * euros, adaptive €/€K axis) - this chart has no opinion on Owner
 * Access, it just draws whatever series and number-formatting it's
 * given. Public mode (see app.js/initPerformanceCard) passes an
 * indexed series and a plain-integer formatter instead; the geometry
 * code below is identical either way, so the curve's shape can't drift
 * from what Owner Mode shows.
 */
function renderLineChart(container, points, { formatValue = fmtEUR, formatAxisValue, formatDateLabel = (d) => d } = {}) {
  const width = container.clientWidth || 640;
  const height = 240;
  const padL = 48, padR = 8, padT = 10, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Same headroom as the reference's domain={["dataMin * 0.94", "dataMax * 1.04"]}
  const min = rawMin * 0.94;
  const max = rawMax * 1.04;
  const range = (max - min) || 1;

  const n = points.length;
  const pts = points.map((p, i) => {
    const x = padL + (n === 1 ? 0 : (i / (n - 1)) * innerW);
    const y = padT + innerH - ((p.value - min) / range) * innerH;
    return [x, y];
  });

  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${padT + innerH} L${pts[0][0].toFixed(1)},${padT + innerH} Z`;

  // Interpolated stretches (real:false - see repository.js/analytics.js)
  // draw dashed, not solid, so a filled-in gap between two known values
  // never reads as "observed" - the "future chart pass" the data's own
  // `real` flag was always waiting for. `real` defaults to true when
  // absent, so callers that never set it (every live Supabase series)
  // draw one continuous solid line exactly as before.
  const hasInterpolated = points.some((p) => p.real === false);
  const segmentPaths = pts.slice(1).map((p, i) => {
    const prev = pts[i];
    const interpolated = points[i].real === false || points[i + 1].real === false;
    const d = `M${prev[0].toFixed(1)},${prev[1].toFixed(1)} L${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    return `<path d="${d}" fill="none" stroke="url(#perfStroke)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${interpolated ? ' stroke-dasharray="5 4"' : ""}/>`;
  }).join("");

  // Below €1K, "K" compact notation rounds everything to "€0K" - show
  // plain euros instead so a small, early-stage portfolio stays legible.
  const axisLabel = formatAxisValue || ((val) => (max >= 1000 ? `€${Math.round(val / 1000)}K` : `€${Math.round(val)}`));

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = padT + innerH * t;
    const val = max - range * t;
    return `<line x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}"/>
            <text x="${padL - 8}" y="${y + 4}" text-anchor="end">${axisLabel(val)}</text>`;
  }).join("");

  // Adaptive skip targeting one label roughly every 70px of chart width,
  // not a fixed point count - a 2-point "1M" range and a 112-point "All"
  // range both need to read cleanly at whatever width they're drawn at.
  // Always keeps the last point so the most recent date is never dropped.
  const targetLabels = Math.max(1, Math.floor(innerW / 70));
  const tickStep = Math.max(1, Math.round(n / targetLabels));
  const xLabels = points.map((p, i) => {
    const isLast = i === points.length - 1;
    // Skip a "regular" tick that lands too close to the always-shown
    // last point - otherwise the two labels overlap at the right edge.
    if (!isLast && (i % tickStep !== 0 || n - 1 - i < tickStep / 2)) return "";
    return `<text x="${pts[i][0]}" y="${height - 6}" text-anchor="middle">${formatDateLabel(p.date)}</text>`;
  }).join("");

  const hitTargets = pts.map(([x, y], i) =>
    `<circle cx="${x}" cy="${y}" r="10" fill="transparent" class="chart-hit" data-i="${i}"/>`).join("");

  const brandStops = PRIMARY_GRADIENT_STOPS.map((s) => `<stop offset="${s.at}" stop-color="${s.color}"/>`).join("");
  const dotColor = PRIMARY_GRADIENT_STOPS[PRIMARY_GRADIENT_STOPS.length - 1].color;

  container.style.position = "relative";
  container.innerHTML = `
    <svg id="linechart" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="perfFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${PALETTE.amber.from}" stop-opacity="0.34"/>
          <stop offset="60%" stop-color="${PALETTE.coral.to}" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="${PALETTE.pink.to}" stop-opacity="0.04"/>
        </linearGradient>
        <linearGradient id="perfStroke" x1="0" y1="0" x2="1" y2="0">
          ${brandStops}
        </linearGradient>
      </defs>
      <g class="linechart-grid">${gridLines}</g>
      <path d="${area}" fill="url(#perfFill)" stroke="none"/>
      ${segmentPaths}
      <g class="linechart-axis">${xLabels}</g>
      <g class="chart-hits">${hitTargets}</g>
      <circle id="linechart-hover-dot" r="4" fill="${dotColor}" stroke="#fff" stroke-width="1.5" opacity="0"/>
    </svg>
    <div class="chart-tooltip"></div>
    ${hasInterpolated ? `<p class="chart-legend-note">- - - interpolated between known values</p>` : ""}`;

  const tooltip = container.querySelector(".chart-tooltip");
  const hoverDot = container.querySelector("#linechart-hover-dot");
  container.querySelectorAll(".chart-hit").forEach((el) => {
    const i = Number(el.dataset.i);
    el.addEventListener("mousemove", () => {
      tooltip.textContent = `${points[i].date}${points[i].real === false ? " (interpolated)" : ""} · ${formatValue(points[i].value)}`;
      tooltip.style.left = pts[i][0] + "px";
      tooltip.style.top = pts[i][1] + "px";
      tooltip.classList.add("visible");
      hoverDot.setAttribute("cx", pts[i][0]);
      hoverDot.setAttribute("cy", pts[i][1]);
      hoverDot.setAttribute("opacity", "1");
    });
    el.addEventListener("mouseleave", () => {
      tooltip.classList.remove("visible");
      hoverDot.setAttribute("opacity", "0");
    });
  });
}

function renderInsufficientData(container, message) {
  container.innerHTML = `
    <div class="chart-empty">
      <div class="chart-empty-icon">${icon("activity")}</div>
      <div class="chart-empty-text">${message}</div>
    </div>`;
}

/**
 * Multi-series overlay chart - Portfolio vs. S&P 500 vs. Nasdaq-100,
 * each normalized to a common start (calculations.js:indexValueSeries()/
 * clipToCommonWindow() - never done here, this function only draws
 * whatever series it's handed). Deliberately stateless: which series
 * are visible is decided by the CALLER (checkbox state in app.js/
 * performance.js), which just re-invokes this with a filtered `series`
 * array - this function has no internal toggle/selection state to keep
 * in sync with a checkbox elsewhere.
 *
 * series: [{ key, label, color, points: [{date, value, real?}] }] - each
 * series' own points, any date range/density (a benchmark's real daily
 * closes next to a portfolio's derived daily series is expected and
 * fine - x-position is by shared date INDEX across the union of every
 * date seen, same "evenly spaced by index" convention renderLineChart()
 * uses, not true calendar-proportional spacing).
 *
 * Reuses the real:false dashed-segment convention per series (a
 * derived/interpolated stretch never reads as an observed one, same
 * discipline as renderLineChart()). Falls back to renderInsufficientData()
 * if every series ends up empty (e.g. every checkbox unticked, or no
 * series had enough overlapping history).
 */
function renderMultiLineChart(container, series, { formatValue = (v) => v.toFixed(2), formatDateLabel = (d) => d } = {}) {
  const visibleSeries = (series || []).filter((s) => s.points && s.points.length >= 2);
  if (!visibleSeries.length) {
    renderInsufficientData(container, "Insufficient history to compare yet - select at least one series with enough dated observations.");
    return;
  }

  const width = container.clientWidth || 640;
  const height = 260;
  const padL = 48, padR = 8, padT = 10, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const sortedSeries = visibleSeries.map((s) => ({
    ...s, points: [...s.points].sort((a, b) => a.date.localeCompare(b.date)),
  }));

  const allDates = [...new Set(sortedSeries.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const dateIndex = Object.fromEntries(allDates.map((d, i) => [d, i]));
  const totalSpan = Math.max(1, allDates.length - 1);
  const xFor = (date) => padL + (dateIndex[date] / totalSpan) * innerW;

  const allValues = sortedSeries.flatMap((s) => s.points.map((p) => p.value));
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const headroom = (rawMax - rawMin) * 0.06 || Math.abs(rawMax) * 0.06 || 1;
  const min = rawMin - headroom;
  const max = rawMax + headroom;
  const range = (max - min) || 1;
  const yFor = (value) => padT + innerH - ((value - min) / range) * innerH;

  // Nearest-prior lookup, same discipline as valueOfSecurityAsOf() -
  // never a future point, never fabricated, for whichever series
  // doesn't happen to have an observation exactly on the hovered date.
  const valueAsOf = (points, date) => {
    let best = null;
    for (const p of points) {
      if (p.date > date) break;
      best = p;
    }
    return best;
  };

  const seriesSegments = sortedSeries.map((s) => {
    const pts = s.points.map((p) => [xFor(p.date), yFor(p.value)]);
    return pts.slice(1).map((p, i) => {
      const prev = pts[i];
      const interpolated = s.points[i].real === false || s.points[i + 1].real === false;
      const d = `M${prev[0].toFixed(1)},${prev[1].toFixed(1)} L${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${interpolated ? ' stroke-dasharray="5 4"' : ""}/>`;
    }).join("");
  }).join("");

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = padT + innerH * t;
    const val = max - range * t;
    return `<line x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}"/>
            <text x="${padL - 8}" y="${y + 4}" text-anchor="end">${formatValue(val)}</text>`;
  }).join("");

  const targetLabels = Math.max(1, Math.floor(innerW / 70));
  const tickStep = Math.max(1, Math.round(allDates.length / targetLabels));
  const xLabels = allDates.map((d, i) => {
    const isLast = i === allDates.length - 1;
    if (!isLast && (i % tickStep !== 0 || allDates.length - 1 - i < tickStep / 2)) return "";
    return `<text x="${xFor(d)}" y="${height - 6}" text-anchor="middle">${formatDateLabel(d)}</text>`;
  }).join("");

  const hitTargets = allDates.map((d) =>
    `<rect x="${(xFor(d) - 5).toFixed(1)}" y="${padT}" width="10" height="${innerH}" fill="transparent" class="chart-hit-multi" data-date="${d}"/>`
  ).join("");

  const legend = sortedSeries.map((s) =>
    `<span class="multichart-legend-item"><span class="multichart-legend-dot" style="background:${s.color}"></span>${s.label}</span>`
  ).join("");

  const hoverDots = sortedSeries.map((s) =>
    `<circle class="multichart-hover-dot" data-key="${s.key}" r="4" fill="${s.color}" stroke="#fff" stroke-width="1.5" opacity="0"/>`
  ).join("");

  container.style.position = "relative";
  container.innerHTML = `
    <div class="multichart-legend">${legend}</div>
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:${height}px;display:block;overflow:visible;">
      <g class="linechart-grid">${gridLines}</g>
      ${seriesSegments}
      <g class="linechart-axis">${xLabels}</g>
      <g class="chart-hits">${hitTargets}</g>
      ${hoverDots}
    </svg>
    <div class="chart-tooltip"></div>`;

  const tooltip = container.querySelector(".chart-tooltip");
  const dotByKey = Object.fromEntries(sortedSeries.map((s) => [s.key, container.querySelector(`.multichart-hover-dot[data-key="${s.key}"]`)]));

  container.querySelectorAll(".chart-hit-multi").forEach((el) => {
    const date = el.dataset.date;
    el.addEventListener("mousemove", () => {
      const lines = sortedSeries.map((s) => {
        const v = valueAsOf(s.points, date);
        if (!v) { dotByKey[s.key].setAttribute("opacity", "0"); return ""; }
        dotByKey[s.key].setAttribute("cx", xFor(v.date));
        dotByKey[s.key].setAttribute("cy", yFor(v.value));
        dotByKey[s.key].setAttribute("opacity", "1");
        return `${s.label}: ${formatValue(v.value)}${v.real === false ? " (derived)" : ""}`;
      }).filter(Boolean);
      tooltip.innerHTML = `<strong>${date}</strong><br>${lines.join("<br>")}`;
      tooltip.style.left = xFor(date) + "px";
      tooltip.style.top = padT + "px";
      tooltip.classList.add("visible");
    });
    el.addEventListener("mouseleave", () => {
      tooltip.classList.remove("visible");
      Object.values(dotByKey).forEach((dot) => dot.setAttribute("opacity", "0"));
    });
  });
}

/* ---------- Donut (Allocation + Geographic Exposure) ---------- */

/**
 * SVG donut: each segment is its own stroked circle (not a CSS conic-
 * gradient), so each can carry its own two-stop linear gradient, a small
 * gap before the next segment, and rounded caps - the "drawn in Figma"
 * look instead of a flat chart-library donut.
 */
function renderDonut(container, data, centerLabel, centerValue, { drillType } = {}) {
  // innerRadius 72 / outerRadius 98 in the reference (Recharts Pie) ->
  // 196px diameter, 26px ring thickness. paddingAngle 3deg at r~85 -> ~4.5px.
  const size = 196;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const gapPx = 4.5;
  const total = data.reduce((s, d) => s + d.weight, 0);

  let cumulative = 0;
  const defs = [];
  const rings = [];

  data.forEach((d, i) => {
    const seg = PALETTE[d.tone];
    const segLen = (d.weight / total) * circumference;
    const visibleLen = Math.max(0, segLen - gapPx);
    const gradId = `donutGrad${i}`;
    defs.push(`
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${seg.from}"/>
        <stop offset="100%" stop-color="${seg.to}"/>
      </linearGradient>`);
    const segAttrs = drillType ? ` data-drill-type="${drillType}" data-drill-id="${d.id || d.name}" tabindex="0" role="button"` : "";
    rings.push(`
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="url(#${gradId})" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${visibleLen.toFixed(2)} ${(circumference - visibleLen).toFixed(2)}"
        stroke-dashoffset="${(-cumulative).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"
        class="donut-segment${drillType ? " drill-row" : ""}"${segAttrs}/>`);
    cumulative += segLen;
  });

  // No drop-shadow on the ring itself - the reference's <Pie> has none
  // (stroke="none", no filter); the card's own shadow is enough.
  const svg = `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <defs>${defs.join("")}</defs>
      ${rings.join("")}
    </svg>`;

  const legend = data.map((d) => `
    <div class="legend-row${drillType ? " drill-row" : ""}"${drillType ? ` data-drill-type="${drillType}" data-drill-id="${d.id || d.name}"` : ""}>
      <span class="legend-dot" style="background:${familyGradientCSS(d.tone)}"></span>
      <span class="legend-name">${d.name}</span>
      <span class="legend-value">${d.weight.toFixed(2)}%</span>
    </div>`).join("");

  container.innerHTML = `
    <div class="donut-wrap">
      <div class="donut-figure">
        ${svg}
        <div class="donut-hole">
          <div class="amt">${centerValue}</div>
          <div class="lbl">${centerLabel}</div>
        </div>
      </div>
      <div class="legend-list">${legend}</div>
    </div>`;
}

/* ---------- World map (Exposure) ---------- */

// Parsed once, reused across every renderWorldMap call - the Exposure
// card re-renders this on every tab switch (Country/Region), and the
// topojson->GeoJSON conversion has no reason to repeat once loaded.
let _worldCountriesCache = null;
async function loadWorldCountries() {
  if (_worldCountriesCache) return _worldCountriesCache;
  const topo = await fetch("vendor/countries-110m.json").then((r) => r.json());
  _worldCountriesCache = topojson.feature(topo, topo.objects.countries);
  return _worldCountriesCache;
}

/**
 * Renders exposure as a hex grid tiled over real landmass, not a
 * political map - no borders, but the actual shape of each country's
 * territory (approximated by small hexagons) reads clearly instead of
 * collapsing every country to one dot. Every hex is real geography: a
 * canvas raster of the real topojson country polygons is sampled once
 * per hex center to decide which country (if any) that hex belongs to
 * - ocean gets no hex at all, unexposed land gets a faint neutral hex,
 * exposed land gets our own brand-gradient colour by weight. Same
 * component for every Exposure tab - the caller just passes different
 * {code, name, pct} weights (see EXPOSURE_GROUPINGS in ui.js), the map
 * doesn't know or care which grouping it's showing.
 */
async function renderWorldMap(container, exposureData) {
  const width = container.clientWidth || 640;
  const height = Math.round(width * 0.52);

  const countries = await loadWorldCountries();

  const byCode = new Map(exposureData.map((d) => [d.code, d]));
  const maxPct = Math.max(...exposureData.map((d) => d.pct));

  const projection = d3.geoNaturalEarth1().fitSize([width, height], countries);
  const path = d3.geoPath(projection);

  // sqrt curve so mid values still read, not just the single largest one.
  const intensityOf = (pct) => Math.sqrt(pct / maxPct);

  // ---- 1. Raster every country's real shape onto an offscreen canvas,
  // each filled with a unique colour that encodes its array index. One
  // canvas.getImageData() read of the whole buffer afterwards turns
  // "which country is under this hex" into an O(1) array lookup instead
  // of thousands of individual d3.geoContains point-in-polygon tests. ----
  const raster = document.createElement("canvas");
  raster.width = width;
  raster.height = height;
  const rctx = raster.getContext("2d", { willReadFrequently: true });
  const canvasPath = d3.geoPath(projection, rctx);
  countries.features.forEach((f, i) => {
    const idx = i + 1; // 0 stays reserved for "no country" (ocean)
    rctx.fillStyle = `rgb(${(idx >> 16) & 255},${(idx >> 8) & 255},${idx & 255})`;
    rctx.beginPath();
    canvasPath(f);
    rctx.fill();
  });
  const pixels = rctx.getImageData(0, 0, width, height).data;
  // Canvas antialiases every fill(), so pixels right at a country's
  // coastline/border blend two encoded colours together and decode to
  // an index that matches no real feature - out-of-range results are
  // just treated as "no country" (a handful of edge hexes go missing
  // right at coastlines, not a real data problem).
  const countryAt = (x, y) => {
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return -1;
    const o = (py * width + px) * 4;
    const idx = (pixels[o] << 16) | (pixels[o + 1] << 8) | pixels[o + 2];
    const featureIdx = idx - 1;
    return featureIdx >= 0 && featureIdx < countries.features.length ? featureIdx : -1;
  };

  // ---- 2. Pointy-top hex grid over the whole canvas, small enough to
  // read as a texture rather than individual cells (~120 hexes across
  // the width, matching a "small hexagon" density). ----
  const hexR = Math.max(3.2, width / 120);
  const hexDrawR = hexR * 0.8; // slightly smaller than the tiling pitch, for a visible gap between hexes
  const colSpacing = Math.sqrt(3) * hexR;
  const rowSpacing = 1.5 * hexR;
  const hexPoints = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(hexDrawR * Math.cos(a)).toFixed(2)},${(hexDrawR * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

  const hexesByCountry = new Map(); // country feature index -> [[x,y], ...]
  let row = 0;
  for (let cy = hexR; cy < height + hexR; cy += rowSpacing) {
    const xOffset = row % 2 === 1 ? colSpacing / 2 : 0;
    for (let cx = xOffset + colSpacing / 2; cx < width + colSpacing; cx += colSpacing) {
      const countryIdx = countryAt(cx, cy);
      if (countryIdx === -1) continue; // ocean - no hex drawn
      if (!hexesByCountry.has(countryIdx)) hexesByCountry.set(countryIdx, []);
      hexesByCountry.get(countryIdx).push([cx, cy]);
    }
    row++;
  }

  const tooltip = document.createElement("div");
  tooltip.className = "map-tooltip";
  container.style.position = "relative";

  const hexGroups = [];
  hexesByCountry.forEach((points, countryIdx) => {
    const f = countries.features[countryIdx];
    const d = byCode.get(f.id);
    const label = d ? `${f.properties.name} · ${d.pct.toFixed(1)}%` : f.properties.name;
    const safeLabel = label.replace(/"/g, "&quot;");
    const fill = d ? interpolatePrimaryGradient(intensityOf(d.pct)) : "var(--grey-2)";
    const opacity = d ? 0.55 + intensityOf(d.pct) * 0.45 : 0.35;
    const cls = d ? "country-shape drill-row" : "country-shape";
    const dataAttrs = d ? ` data-drill-type="country" data-drill-id="${f.id}" tabindex="0" role="button"` : "";
    const hexes = points.map(([x, y]) =>
      `<polygon points="${hexPoints}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"/>`
    ).join("");
    hexGroups.push(
      `<g class="${cls}" data-code="${f.id}" data-label="${safeLabel}" fill="${fill}" fill-opacity="${opacity.toFixed(2)}"${dataAttrs}>${hexes}</g>`
    );
  });

  container.innerHTML = `<svg id="worldmap" viewBox="0 0 ${width} ${height}">${hexGroups.join("")}</svg>`;
  container.appendChild(tooltip);

  // Event delegation on the container - hundreds of hex groups share
  // one pair of listeners instead of each carrying its own.
  container.addEventListener("mousemove", (e) => {
    const group = e.target.closest(".country-shape");
    if (!group) { tooltip.classList.remove("visible"); return; }
    const rect = container.getBoundingClientRect();
    tooltip.textContent = group.dataset.label;
    tooltip.style.left = e.clientX - rect.left + "px";
    tooltip.style.top = e.clientY - rect.top + "px";
    tooltip.classList.add("visible");
  });
  container.addEventListener("mouseleave", () => tooltip.classList.remove("visible"));
}

window.renderLineChart = renderLineChart;
window.renderMultiLineChart = renderMultiLineChart;
window.renderInsufficientData = renderInsufficientData;
window.renderDonut = renderDonut;
window.renderWorldMap = renderWorldMap;
