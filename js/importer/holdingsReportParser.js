/**
 * Parser for BPI "Carteira Detalhada" documents (the fund's own detailed
 * holdings disclosure).
 *
 * Named "Holdings Report", not "Portfolio", on purpose: this file never
 * represents YOUR personal position. The real "Carteira Detalhada" PDF
 * (verified against an actual downloaded document) is every underlying
 * bond/ETF/fund/cash position the FUND holds, plus fund-wide and
 * per-share-class totals (NAV, units in circulation). It does NOT
 * contain an individual investor's personal position (how many units
 * *you* own, what *you* invested, *your* return) anywhere in the
 * document - your personal position belongs in your own Portfolio
 * sheet, updated by hand, never by this parser.
 *
 * This file extracts everything the document genuinely contains and
 * nothing it doesn't - no invented "your units" style fields.
 */

const PARSER_VERSION_PF = "1.0.0";

const KNOWN_CURRENCIES = new Set(["EUR", "USD", "GBP", "JPY", "CHF", "SEK", "NOK", "DKK", "CAD", "AUD"]);
const TOP_LEVEL_GROUPS = ["Instrumentos financeiros", "Liquidez", "Outros valores a regularizar",
  "Responsabilidades extrapatrimoniais"];

const RE_FUND_TOTAL = /Valor\s+l[ií]quido\s+global\s+(?:do\s+fundo)?\s*(.*?):\s*([\d.,]+)/i;
const RE_UNITS_TOTAL = /N[uú]mero\s+de\s+Unidades\s+de\s+Participa[çc][ãa]o\s+em\s+Circula[çc][ãa]o\s*(.*?):\s*([\d.,]+)/i;
const RE_ISSUE_DATE = /Data\s+de\s+Emiss[ãa]o\s+([\d.]+)/i;
const RE_AS_OF_DATE = /Carteira\s+em\s+([\d.]+)/i;

function isDataRow(text) {
  return text.split(/\s+/).some((t) => KNOWN_CURRENCIES.has(t));
}
function isSubtotalRow(text) {
  return text.trim().startsWith("Sub-Total:");
}
function isColumnHeaderRow(text) {
  return (text.includes("Designa") && text.includes("Moeda") && text.includes("Quant"))
    || text.trim().startsWith("Quant./") || text.trim() === "Mont. Nom.";
}

function classifyDataRow(line) {
  const tokens = line.words.map((w) => w.text);
  let currencyIdx = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!KNOWN_CURRENCIES.has(tokens[i])) continue;
    const nxt = i + 1 < tokens.length ? tokens[i + 1] : null;
    if (nxt === null || BPINumbers.looksLikeEuNumber(nxt) || BPINumbers.looksLikeUsNumber(nxt)) {
      currencyIdx = i;
      break;
    }
  }
  if (currencyIdx === null) {
    currencyIdx = tokens.findIndex((t) => KNOWN_CURRENCIES.has(t));
    if (currencyIdx === -1) currencyIdx = null;
  }

  const result = {
    name_raw: null, currency: null, quantity_or_nominal: null, price: null, price_type: null,
    accrued_interest: null, market_value: null, weight_pct: null, confidence: "high", warnings: [],
  };
  if (currencyIdx === null) {
    result.confidence = "low";
    result.warnings.push("no currency token found on a row expected to be a holding");
    return result;
  }

  result.name_raw = tokens.slice(0, currencyIdx).join(" ").trim();
  result.currency = tokens[currencyIdx];
  let trailing = tokens.slice(currencyIdx + 1);

  let weightPct = null;
  if (trailing.length && /^-?[\d,]+\.\d+%$/.test(trailing[trailing.length - 1])) {
    weightPct = BPINumbers.parseUsNumber(trailing[trailing.length - 1]);
    trailing = trailing.slice(0, -1);
  }

  if (!trailing.length) {
    if (weightPct === null) result.confidence = "low";
  } else {
    const valorGlobalTok = trailing[trailing.length - 1];
    const middle = trailing.slice(0, -1);
    result.market_value = BPINumbers.parseUsNumber(valorGlobalTok);
    if (!BPINumbers.looksLikeUsNumber(valorGlobalTok)) {
      result.warnings.push(`Valor Global token '${valorGlobalTok}' did not match expected US number format`);
      result.confidence = "medium";
    }

    const euTokens = middle.filter((t) => BPINumbers.looksLikeEuNumber(t));
    if (euTokens.length >= 1) result.quantity_or_nominal = BPINumbers.parseEuNumber(euTokens[0]);
    if (euTokens.length >= 2) {
      const priceTok = euTokens[1];
      result.price = BPINumbers.parseEuNumber(priceTok);
      result.price_type = priceTok.endsWith("%") ? "percent_of_par" : "unit_price";
    }
    const usMiddle = middle.filter((t) => BPINumbers.looksLikeUsNumber(t) && !BPINumbers.looksLikeEuNumber(t));
    if (usMiddle.length) result.accrued_interest = BPINumbers.parseUsNumber(usMiddle[0]);

    if (euTokens.length > 2 || (middle.length - euTokens.length - usMiddle.length) > 0) {
      result.confidence = "medium";
      result.warnings.push(`unexpected token count/shape in middle columns: [${middle.join(", ")}]`);
    }
  }

  result.weight_pct = weightPct;
  return result;
}

async function headerRowColumns(byPage) {
  const rows = [];
  for (const [, words] of byPage) {
    const headerWords = words.filter((w) => w.top < 60);
    for (const row of BPIPdfReader.clusterRows(headerWords)) {
      if (row.length < 2) continue;
      let widestGap = -Infinity;
      let splitAt = -1;
      for (let i = 0; i < row.length - 1; i++) {
        const gap = row[i + 1].x0 - row[i].x1;
        if (gap > widestGap) { widestGap = gap; splitAt = i; }
      }
      if (splitAt === -1 || widestGap < 20) continue;
      rows.push([row.slice(0, splitAt + 1), row.slice(splitAt + 1)]);
    }
  }
  return rows;
}

function mostCommon(arr) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null; let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

async function parseHoldingsReport(file, preloadedPdfDoc) {
  const { field } = BPIField;
  const { parseUsNumber, parseDottedDate } = BPINumbers;

  const pdfDoc = preloadedPdfDoc || (await BPIPdfReader.loadPdf(await file.arrayBuffer()));
  // No column-gap splitting for this document: every row is one logical
  // table row, and a short fund name can leave a wide natural gap before
  // the fixed-position Moeda column - splitting would fragment it.
  const { byPage, flat: allWords } = await BPIPdfReader.getAllWords(pdfDoc);
  const lines = BPIPdfReader.extractLines(byPage, 2.5, 10000);
  const warnings = [];

  let asOfDate = null;
  let issueDate = null;
  for (const line of lines) {
    if (asOfDate === null) {
      const m = RE_AS_OF_DATE.exec(line.text);
      if (m) asOfDate = parseDottedDate(m[1]);
    }
    if (issueDate === null) {
      const m = RE_ISSUE_DATE.exec(line.text);
      if (m) issueDate = parseDottedDate(m[1]);
    }
  }

  const headerCols = await headerRowColumns(byPage);
  const fundNameCandidates = headerCols
    .map(([, right]) => right.map((w) => w.text).join(" ").trim())
    .filter((t) => t && !t.toUpperCase().includes("CARTEIRA"));
  const companyCandidates = headerCols
    .map(([left]) => left.map((w) => w.text).join(" ").trim())
    .filter((t) => t && t.toUpperCase().includes("BPI") && !t.toUpperCase().includes("CARTEIRA"));
  const fundName = mostCommon(fundNameCandidates);
  const mgmtCompany = mostCommon(companyCandidates);

  const holdings = [];
  const subtotals = [];
  const cashPositions = [];
  const otherAdjustments = [];
  const offBalanceSheet = [];
  const fundTotalRows = [];
  const unitsTotalRows = [];

  let stack = [];
  let inOffBalance = false;

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    if (isColumnHeaderRow(text)) continue;
    if (/^Carteira em/.test(text) || /^Data de Emiss/.test(text) || /^Pag\.?\s*\d/.test(text)
        || text.toUpperCase() === "CARTEIRA DETALHADA") continue;
    if (line.top < 60) continue;

    if (TOP_LEVEL_GROUPS.includes(text) || text.startsWith("Responsabilidades extrapatrimoniais")) {
      inOffBalance = text.startsWith("Responsabilidades");
      stack = [{ label: text, x0: line.x0 }];
      continue;
    }

    if (text.includes("Valor líquido global")) {
      const m = RE_FUND_TOTAL.exec(text);
      if (m) {
        fundTotalRows.push([m[1].trim().replace(/[\s:]+$/, "") || null, parseUsNumber(m[2])]);
        continue;
      }
    }
    {
      const m = RE_UNITS_TOTAL.exec(text);
      if (m) {
        unitsTotalRows.push([m[1].trim().replace(/[\s:]+$/, "") || null, parseUsNumber(m[2])]);
        continue;
      }
    }

    if (isSubtotalRow(text)) {
      const m2 = text.match(/Sub-Total:\s*(-?[\d.,]+)%/);
      const pct = m2 ? parseUsNumber(`${m2[1]}%`) : null;
      subtotals.push({
        classification: stack.map((s) => s.label),
        category_path: stack.map((s) => s.label).join(" > "),
        weight_pct: pct,
      });
      continue;
    }

    if (isDataRow(text)) {
      const parsed = classifyDataRow(line);
      const entry = {
        classification: stack.map((s) => s.label),
        category_path: stack.map((s) => s.label).join(" > "),
        name: parsed.name_raw,
        currency: parsed.currency,
        quantity_or_nominal: parsed.quantity_or_nominal,
        price: parsed.price,
        price_type: parsed.price_type,
        accrued_interest: parsed.accrued_interest,
        market_value: parsed.market_value,
        weight_pct: parsed.weight_pct,
        confidence: parsed.confidence,
      };
      if (parsed.warnings.length) {
        warnings.push(...parsed.warnings.map((w) => `'${parsed.name_raw}': ${w}`));
      }
      if (inOffBalance) offBalanceSheet.push(entry);
      else if (stack[0] && stack[0].label === "Liquidez") cashPositions.push(entry);
      else if (stack[0] && stack[0].label === "Outros valores a regularizar") otherAdjustments.push(entry);
      else holdings.push(entry);
      continue;
    }

    while (stack.length && line.x0 <= stack[stack.length - 1].x0) stack.pop();
    stack.push({ label: text, x0: line.x0 });
  }

  const result = {
    document_type: "carteira_detalhada",
    parser_version: PARSER_VERSION_PF,
    source_file: file.name,
    parsed_at: new Date().toISOString(),
    fund: {
      name: field(fundName, fundName ? "high" : "none"),
      management_company: field(mgmtCompany, mgmtCompany ? "high" : "none"),
      as_of_date: field(asOfDate, asOfDate ? "high" : "none"),
      issue_date: field(issueDate, issueDate ? "high" : "none"),
    },
    holdings, subtotals, cash_positions: cashPositions, other_adjustments: otherAdjustments,
    off_balance_sheet: offBalanceSheet,
    fund_totals: { total_net_assets: null, share_classes: [] },
    units_outstanding: { total: null, share_classes: [] },
    warnings,
  };

  for (const [label, value] of fundTotalRows) {
    if (label) result.fund_totals.share_classes.push({ class_label: label, net_assets: field(value) });
    else result.fund_totals.total_net_assets = field(value);
  }
  for (const [label, value] of unitsTotalRows) {
    if (label) result.units_outstanding.share_classes.push({ class_label: label, units: field(value) });
    else result.units_outstanding.total = field(value);
  }

  return result;
}

window.BPIHoldingsReportParser = { parseHoldingsReport, PARSER_VERSION: PARSER_VERSION_PF };
