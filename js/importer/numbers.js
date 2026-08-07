/**
 * Number and date parsing helpers.
 *
 * BPI's report generator mixes TWO different number formats within the
 * same table (confirmed against real BPI PDFs - see docs/ARCHITECTURE.md):
 *
 * - "Quant./Mont. Nom." and "Cotacao" columns use European formatting:
 *   "." as thousands separator, "," as decimal separator (e.g. "400.000,000").
 * - "Juros Corridos", "Valor Global" and the "%" weight column use
 *   US/international formatting: "," as thousands separator, "." as
 *   decimal separator (e.g. "1,610.96").
 *
 * Callers must know which convention applies to the field they're
 * parsing - there are two explicit functions instead of one "smart"
 * guesser, because guessing silently is exactly how a number ends up
 * wrong by a factor of 1000 with no error raised.
 */

const EU_NUMBER_RE = /^-?(\d{1,3}(\.\d{3})*|\d+)(,\d+)?%?$/;
const US_NUMBER_RE = /^-?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?%?$/;

const PT_MONTHS = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4,
  maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9,
  outubro: 10, novembro: 11, dezembro: 12,
};

function looksLikeEuNumber(token) {
  return EU_NUMBER_RE.test((token || "").trim());
}

function looksLikeUsNumber(token) {
  return US_NUMBER_RE.test((token || "").trim());
}

/** Parse '400.000,000' or '99,02%' -> 400000.0 / 99.02 (percent sign dropped). */
function parseEuNumber(token) {
  if (token == null) return null;
  let t = token.trim().replace("%", "");
  if (t === "") return null;
  t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

/** Parse '1,610.96' or '0.28%' -> 1610.96 / 0.28 (percent sign dropped). */
function parseUsNumber(token) {
  if (token == null) return null;
  let t = token.trim().replace("%", "");
  if (t === "") return null;
  t = t.replace(/,/g, "");
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

/** Parse Portuguese long-form dates like '13 de Julho de 2015' or
 * '30 Junho 2026' into ISO 'YYYY-MM-DD'. Returns null if unparseable. */
function parsePtDate(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const m = t.match(/(\d{1,2})\s*(?:de\s+)?([a-zçã]+)\s*(?:de\s+)?(\d{4})/);
  if (!m) return null;
  const [, day, monthName, year] = m;
  const month = PT_MONTHS[monthName.trim()];
  if (!month) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse '2026.06.30' or '2026.7.6' -> '2026-06-30'. */
function parseDottedDate(text) {
  if (!text) return null;
  const m = text.trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Exposed as a global namespace (classic scripts, no bundler) so the app
// works by opening index.html directly - no build step, no server.
window.BPINumbers = {
  looksLikeEuNumber, looksLikeUsNumber, parseEuNumber, parseUsNumber,
  parsePtDate, parseDottedDate,
};
