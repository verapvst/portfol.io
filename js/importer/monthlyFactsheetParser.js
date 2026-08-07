/**
 * Parser for BPI "Ficha Mensal" (monthly fact sheet) documents.
 *
 * Works for any BPI fund, any month - never hardcodes a fund name or
 * date. Section text is located by matching the document's own heading
 * text, never by fixed coordinates. See docs/ARCHITECTURE.md for the
 * layout quirks this file exists to handle (two-column text sections
 * sharing one visual row, a decorative vertical watermark, the SRRI
 * shaded cell, etc.) - this is a faithful port of the validated Python
 * reference implementation in 06_BPI Report Parser/.
 */

const PARSER_VERSION_FM = "1.0.0";

function isDecorativeWatermark(w) {
  // BPI renders "Sociedade Gestora" as one rotated letter per line down
  // the left margin; identified by shape (single alpha char) AND
  // position (a narrow, consistent x-band), not by specific text.
  return w.text.length === 1 && /[a-zA-Z]/.test(w.text) && w.x0 >= 455 && w.x0 <= 470;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function rowText(words, topMin, topMax) {
  const subset = words.filter((w) => w.top >= topMin && w.top < topMax - 6.0 && !isDecorativeWatermark(w));
  const rows = BPIPdfReader.clusterRows(subset);
  return rows.filter((r) => r.length).map((r) => [r[0].top, r.map((w) => w.text).join(" ")]);
}

function twoColumnText(words, topMin, topMax, xSplit) {
  const subset = words.filter((w) => w.top >= topMin && w.top < topMax - 6.0 && !isDecorativeWatermark(w));
  const rows = BPIPdfReader.clusterRows(subset);
  const leftLines = [];
  const rightLines = [];
  for (const row of rows) {
    const left = row.filter((w) => w.x0 < xSplit).map((w) => w.text);
    const right = row.filter((w) => w.x0 >= xSplit).map((w) => w.text);
    if (left.length) leftLines.push(left.join(" "));
    if (right.length) rightLines.push(right.join(" "));
  }
  return [leftLines.join(" ").trim(), rightLines.join(" ").trim()];
}

/** Find a ROW whose joined text contains a match for `pattern` (a RegExp
 * source string, case-insensitive) - not necessarily at the row's start,
 * since two headings sometimes share one visual row. Returns the actual
 * matching word (for its x0/top). */
function findHeading(words, patternSrc) {
  const rx = new RegExp(patternSrc, "i");
  for (const row of BPIPdfReader.clusterRows(words)) {
    let offset = 0;
    const spans = [];
    for (const w of row) {
      spans.push([offset, offset + w.text.length, w]);
      offset += w.text.length + 1;
    }
    const rowStr = row.map((w) => w.text).join(" ");
    const m = rx.exec(rowStr);
    if (m) {
      for (const [start, end, w] of spans) {
        if ((start <= m.index && m.index < end) || (start >= m.index && start < m.index + m[0].length)) {
          return w;
        }
      }
      return row[0];
    }
  }
  return null;
}

const CHARACTERISTIC_LABELS = [
  ["management_company", "Sociedade\\s+Gestora"],
  ["launch_date", "Data\\s+de\\s+Lan[çc]amento\\s+do\\s+Fundo"],
  ["minimum_subscription_amount", "Montante\\s+M[íi]nimo\\s+de\\s+Subscri[çc][ãa]o"],
  ["subscription_fee_pct", "Comiss[ãa]o\\s+de\\s+Subscri[çc][ãa]o"],
  ["redemption_fee_pct", "Comiss[ãa]o\\s+de\\s+Resgate"],
  ["management_fee_pct", "Comiss[ãa]o\\s+de\\s+Gest[ãa]o"],
  ["depositary_fee_pct", "Comiss[ãa]o\\s+de\\s+Deposit[áa]rio"],
  ["subscription_settlement_period", "Prazo\\s+de\\s+Liquida[çc][ãa]o\\s+de\\s+Subscri[çc][ãa]o"],
  ["redemption_settlement_period", "Prazo\\s+de\\s+Liquida[çc][ãa]o\\s+de\\s+Resgate"],
  ["assets_under_management", "Ativos\\s+sob\\s+Gest[ãa]o"],
];

function extractCharacteristics(sectionText) {
  const { field } = BPIField;
  const { parseEuNumber, parsePtDate } = BPINumbers;

  const positions = [];
  for (const [key, patternSrc] of CHARACTERISTIC_LABELS) {
    const m = new RegExp(patternSrc, "i").exec(sectionText);
    if (m) positions.push([m.index, m.index + m[0].length, key]);
  }
  positions.sort((a, b) => a[0] - b[0]);

  const raw = {};
  positions.forEach(([start, end, key], i) => {
    const nextStart = i + 1 < positions.length ? positions[i + 1][0] : sectionText.length;
    raw[key] = sectionText.slice(end, nextStart).replace(/^[\s:–\-|]+|[\s:–\-|]+$/g, "");
  });

  const out = {};
  out.management_company = field(raw.management_company || null);

  out.launch_date = field(null);
  if (raw.launch_date) {
    const parsed = parsePtDate(raw.launch_date);
    out.launch_date = field(parsed, parsed === null ? "medium" : "high");
    out.launch_date.raw = raw.launch_date;
  }

  let minSubValue = null;
  if (raw.minimum_subscription_amount) {
    const m = raw.minimum_subscription_amount.match(/([\d.,]+)\s*€/);
    if (m) minSubValue = parseEuNumber(m[1]);
  }
  out.minimum_subscription_amount = field(
    minSubValue, raw.minimum_subscription_amount && minSubValue === null ? "medium" : "high"
  );
  if (raw.minimum_subscription_amount) {
    out.minimum_subscription_amount.raw = raw.minimum_subscription_amount;
    out.minimum_subscription_amount.currency = raw.minimum_subscription_amount.includes("€") ? "EUR" : null;
  }

  for (const key of ["subscription_fee_pct", "redemption_fee_pct", "management_fee_pct"]) {
    const rawVal = raw[key];
    let val = null;
    if (rawVal) {
      const m = rawVal.match(/(-?[\d.,]+)\s*%/);
      if (m) val = parseEuNumber(m[1] + "%");
    }
    out[key] = field(val, rawVal && val === null ? "medium" : "high");
  }

  let depVal = null;
  let depPeriod = null;
  if (raw.depositary_fee_pct) {
    const m = raw.depositary_fee_pct.match(/(-?[\d.,]+)\s*%/);
    if (m) depVal = parseEuNumber(m[1] + "%");
    const pm = raw.depositary_fee_pct.match(/\(([^)]+)\)/);
    if (pm) depPeriod = pm[1].trim();
  }
  out.depositary_fee_pct = field(depVal, raw.depositary_fee_pct && depVal === null ? "medium" : "high");
  if (depPeriod) out.depositary_fee_pct.period = depPeriod;

  out.subscription_settlement_period = field(raw.subscription_settlement_period || null);
  out.redemption_settlement_period = field(raw.redemption_settlement_period || null);

  let aumValue = null;
  let aumUnit = null;
  if (raw.assets_under_management) {
    const m = raw.assets_under_management.match(/([\d.,]+)\s*(M|Mil|B)?\s*Euros?/i);
    if (m) {
      aumValue = parseEuNumber(m[1]);
      aumUnit = `${(m[2] || "").toUpperCase()} EUR`.trim();
    }
  }
  out.assets_under_management = field(aumValue, raw.assets_under_management && aumValue === null ? "medium" : "high");
  if (aumUnit) out.assets_under_management.unit = aumUnit;

  return out;
}

const PERIOD_TOKEN_RE = /ANO\s+\d{4}\s+YTD\*+|\d+\s+MESES|\d+\s+ANOS|\d{4}/gi;

function extractPerformance(words, headerTop, nextTop) {
  const rows = rowText(words, headerTop - 3, nextTop);
  if (!rows.length) return { periods: [], confidence: "none" };

  const periodRow = rows.find(([, t]) => t.toUpperCase().includes("ANO") && t.toUpperCase().includes("MESES"));
  const returnRow = rows.find(([, t]) => t.toUpperCase().startsWith("RENTABILIDADE"));
  if (!periodRow || !returnRow) {
    return { periods: [], confidence: "none", note: "performance table header/row not found" };
  }

  const periods = [...periodRow[1].matchAll(PERIOD_TOKEN_RE)].map((m) => m[0].trim());
  const returns = [...returnRow[1].matchAll(/-?\d+,\d+%/g)].map((m) => BPINumbers.parseEuNumber(m[0]));

  let riskClasses = [];
  for (const [, t] of rows) {
    if (t.toUpperCase().includes("CLASSE DE RISCO")) {
      const m = t.match(/CLASSE\s+DE\s+RISCO\*+\s*(.+)$/i);
      if (m) riskClasses = [...m[1].matchAll(/\d+/g)].map((x) => parseInt(x[0], 10));
      break;
    }
  }

  const n = periods.length;
  const confidence = (returns.length === n && (!riskClasses.length || riskClasses.length === n)) ? "high" : "medium";
  const entries = [];
  for (let i = 0; i < n; i++) {
    entries.push({
      period: periods[i],
      return_pct: i < returns.length ? returns[i] : null,
      risk_class: i < riskClasses.length ? riskClasses[i] : null,
    });
  }
  return { periods: entries, confidence };
}

function extractTopHoldings(words, headerTop, nextTop) {
  const rows = rowText(words, headerTop, nextTop);
  const holdings = [];
  for (const [, text] of rows) {
    const t = text.trim();
    if (["ATIVO PESO", "ATIVO", "PESO"].includes(t.toUpperCase())) continue;
    const m = t.match(/^(.*\S)\s+(-?\d+,\d+%)$/);
    if (m) holdings.push({ asset: m[1].trim(), weight_pct: BPINumbers.parseEuNumber(m[2]) });
  }
  return { holdings, confidence: holdings.length ? "high" : "none" };
}

function extractCurrentDistribution(words, headerTop, nextTop) {
  const rows = rowText(words, headerTop, nextTop);
  const categories = [];
  const rx = /(-?\d+,\d+%)\s+([A-Za-zÀ-ÿ ]+)/g;
  for (const [, text] of rows) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      categories.push({ category: m[2].trim(), weight_pct: BPINumbers.parseEuNumber(m[1]) });
    }
  }
  return { categories, confidence: categories.length ? "high" : "none" };
}

const CATEGORY_NAME_RE = /^(Liquidez|Obriga[çc][õo]es|A[çc][õo]es|Outros|Investimentos)$/i;

function extractHistoricalDistribution(words, headerTop, nextTop) {
  const subset = words.filter((w) => w.top >= headerTop && w.top < nextTop - 6.0);

  const dateWords = subset.filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.text));
  const dates = [...new Set(dateWords.map((w) => w.text))].sort();

  const legendWords = subset.filter((w) => CATEGORY_NAME_RE.test(w.text) && w.top > 400);
  const categories = [];
  for (const row of BPIPdfReader.clusterRows(legendWords)) {
    let i = 0;
    while (i < row.length) {
      if (row[i].text.toLowerCase() === "outros" && i + 1 < row.length && row[i + 1].text.toLowerCase() === "investimentos") {
        categories.push(["Outros Investimentos", row[i].x0]);
        i += 2;
      } else {
        categories.push([row[i].text, row[i].x0]);
        i += 1;
      }
    }
  }

  const pctWords = subset.filter((w) => /^-?\d+%$/.test(w.text) && w.x0 > 30).sort((a, b) => a.x0 - b.x0);
  const groups = [];
  for (const w of pctWords) {
    if (groups.length && (w.x0 - groups[groups.length - 1][groups[groups.length - 1].length - 1].x0) < 40) {
      groups[groups.length - 1].push(w);
    } else {
      groups.push([w]);
    }
  }

  if (!dates.length || !categories.length || !groups.length) {
    return { snapshots: [], confidence: "none", note: "could not confidently locate bar-chart labels" };
  }

  const warningsLocal = [];
  const perCategory = {};
  for (const group of groups) {
    const gx = group.reduce((s, w) => s + w.x0, 0) / group.length;
    let best = null;
    let bestDist = Infinity;
    for (const [name, x] of categories) {
      const d = Math.abs(x - gx);
      if (d < bestDist) { bestDist = d; best = name; }
    }
    const values = [...group].sort((a, b) => a.x0 - b.x0).map((w) => BPINumbers.parseUsNumber(w.text));
    if (best === null) {
      warningsLocal.push(`percentage group at x~${group[0].x0.toFixed(0)} could not be matched to a category`);
      continue;
    }
    if (values.length !== dates.length) {
      warningsLocal.push(`category '${best}' has ${values.length} bar values but ${dates.length} date labels were found`);
    }
    perCategory[best] = values;
  }

  const snapshots = dates.map((d, dateIdx) => ({
    as_of: d,
    categories: Object.entries(perCategory)
      .filter(([, values]) => dateIdx < values.length)
      .map(([cat, values]) => ({ category: cat, weight_pct: values[dateIdx] })),
  }));

  return {
    snapshots,
    confidence: warningsLocal.length ? "low" : "medium",
    note: "Values are rounded to the nearest integer percent, as printed on the source chart. "
        + "Category assignment is by horizontal alignment with the chart's legend, not document text structure.",
    warnings: warningsLocal,
  };
}

/**
 * The SRRI risk class (1-7) is shown as a row of digits with one cell
 * shaded to mark the fund's class - a visual signal plain text can't
 * see (the digit "3" reads the same whether or not its cell is shaded).
 * We render the page to a canvas and sample pixel colour just outside
 * each digit's glyph (staying inside that digit's own cell background,
 * short of the neighbouring cell) - whichever of the 7 samples is most
 * different from the others is the highlighted one. Relative comparison
 * on purpose: it adapts to whatever exact shade BPI uses without a
 * hardcoded colour value.
 */
async function extractSrriClass(pdfDoc, words, pageNumber = 1) {
  const scaleRow = BPIPdfReader.clusterRows(words.filter((w) => /^[1-7]$/.test(w.text)))
    .find((row) => row.map((w) => w.text).join("") === "1234567");
  if (!scaleRow) return { value: null, confidence: "none" };

  const page = await pdfDoc.getPage(pageNumber);
  const scale = 3;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: ctx, viewport }).promise;

  const samples = scaleRow.map((digitWord) => {
    const midY = (digitWord.top + digitWord.bottom) / 2 * scale;
    const leftX = (digitWord.x0 - 5) * scale;
    const rightX = (digitWord.x1 + 5) * scale;
    const p1 = ctx.getImageData(Math.max(0, leftX), midY, 1, 1).data;
    const p2 = ctx.getImageData(Math.min(canvas.width - 1, rightX), midY, 1, 1).data;
    const gray1 = (p1[0] + p1[1] + p1[2]) / 3;
    const gray2 = (p2[0] + p2[1] + p2[2]) / 3;
    return { digit: digitWord.text, gray: Math.min(gray1, gray2) };
  });

  const meanGray = samples.reduce((s, x) => s + x.gray, 0) / samples.length;
  let best = null;
  let bestDeviation = 0;
  for (const s of samples) {
    const deviation = meanGray - s.gray; // shaded cell is darker than the average (mostly-white) cell
    if (deviation > bestDeviation) { bestDeviation = deviation; best = s; }
  }
  if (best && bestDeviation > 8) {
    return { value: parseInt(best.digit, 10), confidence: "high" };
  }
  return { value: null, confidence: "low" };
}

async function parseFichaMensal(file, preloadedPdfDoc) {
  const { field } = BPIField;
  const { parsePtDate } = BPINumbers;

  const pdfDoc = preloadedPdfDoc || (await BPIPdfReader.loadPdf(await file.arrayBuffer()));
  const { byPage } = await BPIPdfReader.getAllWords(pdfDoc);
  const p1Words = byPage.get(1) || [];
  const p2Words = byPage.get(2) || [];
  const flatWords = [...byPage.values()].flat();
  const lines = BPIPdfReader.extractLines(byPage);
  const warnings = [];

  let fundName = null;
  let referenceDate = null;
  for (const line of lines) {
    if (line.page === 1 && line.top < 60 && line.x0 < 30 && line.text.trim()
        && !line.text.toUpperCase().includes("FUNDO DE INVESTIMENTO")) {
      fundName = line.text.trim();
    }
    if (line.page === 1 && /^\d{1,2}\s+[A-Za-zç]+\s+\d{4}$/.test(line.text.trim())) {
      referenceDate = parsePtDate(line.text.trim());
    }
  }

  let legalForm = null;
  for (const line of lines) {
    if (line.page === 1 && line.text.toUpperCase().includes("FUNDO DE INVESTIMENTO")) {
      legalForm = line.text.trim();
      break;
    }
  }

  const objHead = findHeading(p1Words, "OBJETIVO");
  const procHead = findHeading(p1Words, "PROCESSO");
  const caracHead = findHeading(p1Words, "CARACTER[ÍI]STICAS");
  const comentHead = findHeading(p1Words, "COMENT[ÁA]RIO");
  const evolHead = findHeading(p1Words, "EVOLU[ÇC][ÃA]O");
  const riscoHeadPresent = p1Words.some((w) => w.text === "RISCO");

  let objectiveText = null;
  let processText = null;
  if (objHead && procHead && caracHead) {
    const xSplit = procHead.x0 - 5;
    [objectiveText, processText] = twoColumnText(p1Words, objHead.top, caracHead.top, xSplit);
  }

  let characteristics = {};
  if (caracHead) {
    const endTop = comentHead ? comentHead.top : caracHead.top + 200;
    const rows = rowText(p1Words, caracHead.top, endTop);
    const sectionText = rows.slice(1).map(([, t]) => t).join(" | ");
    characteristics = extractCharacteristics(sectionText);
  }

  let commentaryText = null;
  if (comentHead) {
    const endTop = evolHead ? evolHead.top : comentHead.top + 300;
    const [left, right] = twoColumnText(p1Words, comentHead.top, endTop, 280);
    commentaryText = `${left} ${right}`.trim();
  }

  let performance = { periods: [], confidence: "none" };
  let topHoldings = { holdings: [], confidence: "none" };
  let currentDist = { categories: [], confidence: "none" };
  let histDist = { snapshots: [], confidence: "none" };

  if (p2Words.length) {
    const perfHead = findHeading(p2Words, "DETALHES\\s+DA\\s+CARTEIRA");
    const topAssetsHead = findHeading(p2Words, "PRINCIPAIS\\s+ATIVOS");
    const distHead = findHeading(p2Words, "DISTRIBUI[ÇC][ÃA]O\\s+POR\\s+CLASSE\\s+DE\\s+ATIVOS");
    const histHead = findHeading(p2Words, "DISTRIBUI[ÇC][ÃA]O\\s+POR\\s+CLASSES.*HIST[ÓO]RICO");

    if (perfHead && topAssetsHead) performance = extractPerformance(p2Words, perfHead.top, topAssetsHead.top);
    if (topAssetsHead && histHead) topHoldings = extractTopHoldings(p2Words, topAssetsHead.top, histHead.top);
    if (distHead && histHead) currentDist = extractCurrentDistribution(p2Words, distHead.top, histHead.top);
    if (histHead) {
      const end = histHead.top + 250;
      histDist = extractHistoricalDistribution(p2Words, histHead.top, end);
    }
  }

  let srriResult = { value: null, confidence: "none" };
  try {
    srriResult = await withTimeout(extractSrriClass(pdfDoc, p1Words, 1), 6000);
  } catch (e) {
    // Canvas rendering can hang on some browsers/GPUs - this is an
    // optional enhancement (everything else in the document still
    // parses from text alone), so a slow render degrades to "unknown"
    // instead of blocking the whole import.
    warnings.push(e.message === "timeout"
      ? "SRRI extraction timed out (rendering the page to canvas took too long) - left null."
      : `SRRI extraction failed: ${e.message}`);
  }
  if (srriResult.value === null && riscoHeadPresent) {
    warnings.push(
      "SRRI risk class (1-7 scale) is shown on a shaded cell in the source PDF; "
      + "could not confidently locate the highlighted cell, so srri_class is left null rather than guessed."
    );
  }

  return {
    document_type: "ficha_mensal",
    parser_version: PARSER_VERSION_FM,
    source_file: file.name,
    parsed_at: new Date().toISOString(),
    fund: {
      name: field(fundName, fundName ? "high" : "none"),
      legal_form: field(legalForm, legalForm ? "high" : "none"),
      reference_date: field(referenceDate, referenceDate ? "high" : "none"),
    },
    commercial_characteristics: characteristics,
    risk: { srri_class: field(srriResult.value, srriResult.confidence), srri_scale: "1-7" },
    performance,
    top_holdings: topHoldings,
    asset_class_distribution: currentDist,
    asset_class_distribution_history: histDist,
    investment_objective: field(objectiveText || null, objectiveText ? "medium" : "none"),
    investment_process: field(processText || null, processText ? "medium" : "none"),
    manager_commentary: field(commentaryText || null, commentaryText ? "medium" : "none"),
    unit_value_chart: {
      extracted: false,
      reason: "Line chart has no per-point text labels in the source PDF; only axis ranges are extractable, not the plotted values.",
      confidence: "none",
    },
    warnings,
  };
}

window.BPIMonthlyFactsheetParser = { parseFichaMensal, PARSER_VERSION: PARSER_VERSION_FM };
