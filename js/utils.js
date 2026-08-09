/* ============================================================
   utils.js - merged: design tokens, palette, formatting, icons.
   Pure, dependency-free helpers. Nothing here reads app data or
   touches the DOM beyond returning markup strings.
   ============================================================ */

/* ---------- Colour: palette + token mapping ---------- */

/**
 * Single source of truth for every colour used in the product. Nothing
 * outside this file (and its CSS mirror in theme.css) should hardcode
 * a hex value - components look up a family by name and read {from, to}.
 *
 * PRIMARY: the brand gradient (Amber -> Orange -> Coral -> Pink). Reserved
 * for hero/high-emphasis elements: logo, the main performance line, primary
 * buttons, active nav state, the "New" badge.
 *
 * SUPPORTING: the 8 pastel families below. Every chart, badge, progress
 * bar, map and icon in the product picks one of these - never a one-off hex.
 */
const PALETTE = {
  amber: { from: "#FFD06A", to: "#FFB34A" },
  orange: { from: "#FFB35F", to: "#FF9447" },
  coral: { from: "#FF8E73", to: "#FF6D63" },
  pink: { from: "#FF97B5", to: "#F56D9A" },
  blue: { from: "#8BC5FF", to: "#67A7F5" },
  green: { from: "#BFE8B8", to: "#8FD59C" },
  purple: { from: "#C8BBFF", to: "#9F92F6" },
  grey: { from: "#EFEFEF", to: "#DADADA" },
};

// Darker, text-legible variant of each family - the pastel {from,to} stops
// are tuned for fills/large shapes, not 12px labels. Used for trend text,
// "up"/"down" values, small dots next to numbers.
const PALETTE_TEXT = {
  amber: "#B8791E",
  orange: "#C46A1F",
  coral: "#D9503C",
  pink: "#D1447A",
  blue: "#2E76C9",
  green: "#3D9556",
  purple: "#6C5CE0",
  grey: "#8A8A8A",
};

const PRIMARY_GRADIENT_STOPS = [
  { at: "0%", color: PALETTE.amber.from },
  { at: "35%", color: PALETTE.orange.to },
  { at: "70%", color: PALETTE.coral.to },
  { at: "100%", color: PALETTE.pink.to },
];

function familyGradientCSS(name, angle = 135) {
  const f = PALETTE[name];
  return `linear-gradient(${angle}deg, ${f.from}, ${f.to})`;
}

function primaryGradientCSS(angle = 135) {
  const stops = PRIMARY_GRADIENT_STOPS.map((s) => `${s.color} ${s.at}`).join(", ");
  return `linear-gradient(${angle}deg, ${stops})`;
}

/**
 * Resolves a single RGB colour at position t (0-1) along
 * PRIMARY_GRADIENT_STOPS - the discrete-value counterpart to
 * primaryGradientCSS's CSS gradient string. Used wherever a continuous
 * value (map intensity, a gauge, anything scalar) needs to be painted
 * with the brand gradient rather than a plain two-stop family.
 */
function interpolatePrimaryGradient(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = PRIMARY_GRADIENT_STOPS.map((s) => ({ at: parseFloat(s.at) / 100, color: s.color }));
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1].at) i++;
  const a = stops[i], b = stops[i + 1];
  const localT = (t - a.at) / (b.at - a.at || 1);
  const hexToRgb = (hex) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));
  const [r1, g1, b1] = hexToRgb(a.color);
  const [r2, g2, b2] = hexToRgb(b.color);
  const mix = (x, y) => Math.round(x + (y - x) * localT);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

/**
 * Design Token System - the only way components should reach for colour.
 * Every namespace resolves to a palette family above; nothing in a
 * component file should hardcode a hex value or a bare family name like
 * "orange" - go through TOKENS instead so the mapping from a real
 * account/asset/category to a colour lives in exactly one place.
 */
const TOKENS = {
  brand: {
    primary: "brand", // the amber->orange->coral->pink gradient - hero elements only
  },
  category: {
    amber: "amber", orange: "orange", coral: "coral", pink: "pink",
    blue: "blue", green: "green", purple: "purple", grey: "grey",
  },
  semantic: {
    positive: "var(--positive)",
    negative: "var(--negative)",
    warning: "var(--orange-2)",
  },
  // Real accounts. Extend this (not the components) when a new broker is added.
  account: {
    BPI: "coral",
    Trading212: "blue",
  },
  // Real holdings, keyed by ticker (or a slug for non-ticker products).
  asset: {
    BPI_Dinamico: "coral",
    UETW: "blue",
    AVWS: "purple",
    XDEQ: "amber",
    SPYM: "pink",
  },
  assetClass: {
    Equities: "orange",
    Bonds: "pink",
    Cash: "grey",
    Alternatives: "purple",
  },
};

function tokenColor(namespace, key) {
  return (TOKENS[namespace] && TOKENS[namespace][key]) || "grey";
}

/**
 * Single source of truth for "which region is this country in" - used
 * by both the Exposure > Region tab (ui.js) and its drill-down drawer
 * (shell.js). Previously duplicated as two separately-maintained lists
 * that already drifted out of sync once; defined here once instead so
 * that can't happen again. Only needs entries for countries that
 * actually appear in analytics.countries (see repository.js) - not
 * every country in the world.
 */
const COUNTRY_TO_REGION = {
  "United States": "North America",
  "Canada": "North America",
  "Spain": "Europe",
  "Germany": "Europe",
  "Portugal": "Europe",
  "Sweden": "Europe",
  "Netherlands": "Europe",
  "France": "Europe",
  "United Kingdom": "Europe",
  "Switzerland": "Europe",
  "Japan": "Asia",
  // Real MSCI Emerging Markets Index constituents (see repository.js) -
  // grouped under Emerging Markets, not Asia/South America, since that
  // economic classification (not geography) is why their weight shows
  // up here at all - it's look-through from EM-mandate funds.
  "China": "Emerging Markets",
  "Taiwan": "Emerging Markets",
  "South Korea": "Emerging Markets",
  "India": "Emerging Markets",
  "Brazil": "Emerging Markets",
  // No dedicated region bucket for a single small (0.21%) developed
  // country - "World" is the nearest honest fit (this weight comes from
  // AVWS's own real global small-cap holdings, not an Oceania mandate).
  "Australia": "World",
};

function regionForCountry(name) {
  return COUNTRY_TO_REGION[name] || "Other / not yet mapped";
}

/** Case- AND diacritic-insensitive name comparison key - "BPI Dinâmico"
    and "BPI DINAMICO" (a real name a BPI PDF actually printed, no accent,
    all-caps) must match, or a find-or-create lookup silently creates a
    duplicate security instead of updating the real one. Added after
    exactly that happened via a live Data Hub import: db.js's
    findOrCreateSecurity()/findOrCreateInstitution() and data-hub.js's
    guessSecurityId() all compared with plain .toLowerCase(), which is
    diacritic-sensitive and doesn't catch this. */
function normalizeName(name) {
  return (name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/* ---------- Formatting ---------- */

function fmtEUR(v, opts = {}) {
  const { signed = false, decimals = 2 } = opts;
  const sign = signed && v > 0 ? "+" : "";
  return sign + new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}

function fmtPct(v, opts = {}) {
  const { signed = true, decimals = 2 } = opts;
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}

function fmtCompact(v) {
  return new Intl.NumberFormat("en-IE", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/** "Last updated" / "Data as of" - one shared renderer for the
    freshness caption described in docs/data-freshness.md, so this
    doesn't become dozens of hand-written date strings across pages.
    `date` is any value `new Date()` accepts (an ISO date string from
    Supabase, a JS Date) or null/undefined - null renders nothing at
    all (an honestly-missing date is not the same as "today", and this
    function never manufactures one). `label` chooses the wording:
    "updated" -> "Last updated" (the row was touched then); "as-of"
    (default) -> "Data as of" (the underlying figures were true then) -
    see that doc for when to use which. */
function lastUpdatedHTML(date, { label = "as-of" } = {}) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const formatted = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const prefix = label === "updated" ? "Last updated" : "Data as of";
  return `<span class="last-updated">${prefix}: ${formatted}</span>`;
}

/* ---------- Icons ----------
   Minimal stroke-line icon set (24x24, currentColor, stroke-width 1.5) -
   hand-drawn equivalents of the exact lucide-react icons the Lovable
   reference uses, so no icon library dependency is needed. Only entries
   actually referenced by a component or NAV_ITEMS are kept here. */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a21.3 21.3 0 0 1-3.94 5.29M6.1 6.1A21.6 21.6 0 0 0 1 12s4 8 11 8a10.4 10.4 0 0 0 5.1-1.36"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  pieChart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>',
  trendingUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/></svg>',
  barChart3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-5"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h16v20l-3-2-2 2-3-2-3 2-2-2-3 2z"/><path d="M8 8h8M8 12h5"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 4.7L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/><path d="M5 15l.6 1.6L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.4z"/></svg>',
  fileText: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2h7l5 5v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v5h5M9 13h6M9 17h6M9 9h1"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.45.71.76 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
  landmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22h18M4 22V11M20 22V11M2 11l10-7 10 7M8 22v-7M12 22v-7M16 22v-7"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
  circle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>',
  fileCheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2h7l5 5v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v5h5"/><path d="M9 15l2 2 4-4.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  edit3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 13h4"/></svg>',
  xCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg>',
};

function icon(name) {
  return ICONS[name] || "";
}

window.PALETTE = PALETTE;
window.PALETTE_TEXT = PALETTE_TEXT;
window.PRIMARY_GRADIENT_STOPS = PRIMARY_GRADIENT_STOPS;
window.familyGradientCSS = familyGradientCSS;
window.primaryGradientCSS = primaryGradientCSS;
window.interpolatePrimaryGradient = interpolatePrimaryGradient;
window.TOKENS = TOKENS;
window.tokenColor = tokenColor;
window.COUNTRY_TO_REGION = COUNTRY_TO_REGION;
window.regionForCountry = regionForCountry;
window.fmtEUR = fmtEUR;
window.fmtPct = fmtPct;
window.fmtCompact = fmtCompact;
window.lastUpdatedHTML = lastUpdatedHTML;
window.normalizeName = normalizeName;
window.icon = icon;
