/* ============================================================
   geoClassifier.js - automated Exposure Country / Exposure Region
   classification for every security the importer sees, so the manual
   research pass done once for BPI Dinâmico's 118 real holdings never
   has to be repeated by hand on future monthly imports.

   Cascade, in order (never skipped, never reordered per-call):
     1. Exact match   - SECURITY_DICTIONARY, keyed by the exact real
                         Security Name string. This is the "already
                         seen it, know the answer" tier - it's what
                         makes future imports fast: a security only
                         ever needs tiers 2-4 the FIRST time it shows up.
     2. Pattern match  - keyword rules on the security name (index
                         tracked, thematic mandate, ...).
     3. Issuer detection - corporate bond issuer -> country.
     4. Government bond detection - sovereign/supranational issuer -> country.
     5. Unknown        - never guessed. Flagged for the Unclassified
                         Securities list, same honesty rule as the manual
                         pass this replaces (17 of 118 real holdings were
                         genuinely Unknown - that's a correct outcome,
                         not a classifier failure).

   Deliberately NOT in scope here: writing back to the workbook. Manual
   classifications collected via the Data Hub UI become "pending
   dictionary additions" the user reviews and copies into the real
   Security Classifications sheet themselves - same "nothing writes
   itself" principle as the rest of Data Hub (see data-hub.js).
   ============================================================ */

/**
 * Seeded from the manual classification pass over BPI Dinâmico's real
 * Detailed Portfolio (02_Portfolio Workbook.xlsx, "Security
 * Classifications" sheet - that sheet is the actual source of truth;
 * this object is a transcription of it, same "real but not live"
 * pattern as repository.js). Exact Security Name string -> classification.
 * "Unknown" entries ARE the dictionary remembering a security couldn't
 * be classified with confidence - that's still worth caching, so the
 * next import doesn't re-run the same failed pattern/issuer search.
 */
const SECURITY_DICTIONARY = {
  "BANCO COMERC PORTUGUES 1.75% 07.04.28 CALL": { country: "Portugal", region: "Europe" },
  "BANCO COMERC PORTUGUES 4% 17.05.32 CALL": { country: "Portugal", region: "Europe" },
  "BANCO COMERC PORTUGUES 8.75% 05.03.33 CALL": { country: "Portugal", region: "Europe" },
  "CAIXA GERAL DE DEPOSITOS 5.75% 31.10.28 CALL": { country: "Portugal", region: "Europe" },
  "CRL CREDITO AGRICOLA MUT 3.625% 29.01.30 CALL": { country: "Portugal", region: "Europe" },
  "BPI IMPACTO CLIMA - AÇÕES CLASE M": { country: "Unknown", region: "Unknown" },
  "BPI IMPACTO CLIMA - OBRIGAÇÕES CLASE M": { country: "Unknown", region: "Unknown" },
  "BPI OBRIGACOES MUNDIAIS O DE INVESTIMENTO ABERTO-M": { country: "World", region: "World" },
  "BUNDESREPUB. DEUTSCHLAND 2.5% 15.02.35": { country: "Germany", region: "Europe" },
  "DEUTSCHLAND I/L BOND I/L 0.5% 15.04.30": { country: "Germany", region: "Europe" },
  "SPAIN LETRAS DEL TESORO 0% 15.01.27": { country: "Spain", region: "Europe" },
  "EUROPEAN INVESTMENT BANK 3.75% 14.02.33": { country: "Europe", region: "Europe" },
  "EUROPEAN UNION 0.1% 04.10.40": { country: "Europe", region: "Europe" },
  "EUROPEAN UNION 0.4% 04.02.37": { country: "Europe", region: "Europe" },
  "EUROPEAN UNION 1.25% 04.02.43": { country: "Europe", region: "Europe" },
  "EUROPEAN UNION 2.625% 04.02.48": { country: "Europe", region: "Europe" },
  "ABN AMRO BANK NV FRN 15.01.27": { country: "Netherlands", region: "Europe" },
  "AYVENS SA 4.25% 18.01.27": { country: "France", region: "Europe" },
  "BANCA INTESA SPA 0% 17.02.28": { country: "Italy", region: "Europe" },
  "CELLNEX FINANCE CO SA 1.5% 08.06.28 CALL": { country: "Spain", region: "Europe" },
  "EDP SERVICIOS FIN ESP SA 3.5% 16.07.30 CALL": { country: "Portugal", region: "Europe" },
  "ING-DIBA AG 3.25% 15.02.28": { country: "Germany", region: "Europe" },
  "REN FINANCE BV 3.375% 18.02.34 CALL": { country: "Portugal", region: "Europe" },
  "REN FINANCE BV 3.5% 27.02.32 CALL": { country: "Portugal", region: "Europe" },
  "ISHARES PHYSICAL GOLD ETC": { country: "Global", region: "Global" },
  "AB FCP II EMERGMKTS VALUE PTF-S1 EUR ACC": { country: "Emerging Markets", region: "Emerging Markets" },
  "AMUNDI ALTERNATIVE II PLC AMUNDI CHENA-SSI EUR ACC": { country: "Unknown", region: "Unknown" },
  "AMUNDI CORE EURO GOVERNMENT BOND UCITS ETF": { country: "Europe", region: "Europe" },
  "AMUNDI EUR CORPORATE BOND ESG UCITS ETF": { country: "Europe", region: "Europe" },
  "AMUNDI S&P WORLD HEALTH CARE SCREENED UCITS ETF": { country: "World", region: "World" },
  "AMUNDI US BND-I EUR ACC HDGD": { country: "United States", region: "North America" },
  "AQR UCITS IIAQR ADAPTIVE EQ MKTNEUTRAL-RAU USD ACC": { country: "Unknown", region: "Unknown" },
  "BDL REMPART EUROPE-I EUR ACC": { country: "Europe", region: "Europe" },
  "BLACKROCK GLB GLB HY BND-I2 EUR ACC": { country: "World", region: "World" },
  "BLACKROCK GLB WRLD HEALTHSCIENCE-I2 EUR ACC": { country: "World", region: "World" },
  "BLUEBAY BLUEBAY IG EURO AGGREGATE BND-Q EUR ACC": { country: "Europe", region: "Europe" },
  "BNY MELLON GLB PLCBNY MELLON US MUN-W EUR ACC HDGD": { country: "United States", region: "North America" },
  "BPI OPORT.-M": { country: "Unknown", region: "Unknown" },
  "CAIXABANK GLB INVESTMENT BPI ALTERNATIVE IBERIAN-M": { country: "Europe", region: "Europe" },
  "CAIXABANK GLB INVESTMENT BPI EUROPE FINA-M EUR ACC": { country: "Europe", region: "Europe" },
  "CAIXABANK GLB INVESTMENT BPI HIGH INCOME-I EUR ACC": { country: "Unknown", region: "Unknown" },
  "CAIXABANK GLB INVESTMENT BPI IBERIA-M": { country: "Europe", region: "Europe" },
  "CAIXABANK GLB INVESTMENT BPI TECH REVOLU-M EUR ACC": { country: "World", region: "World" },
  "DNCA INVEST ALPHA BNDS-F EUR ACC": { country: "Europe", region: "Europe" },
  "EDMOND DE ROTHSCHILD BIG DATA-P EUR ACC": { country: "World", region: "World" },
  "ELEVA UCITS ELEVA ABS RET EUROPE-R EUR ACC": { country: "Europe", region: "Europe" },
  "GOLDMAN SACHS EMERGMKTS ENHANCED IDX SUS-I EUR ACC": { country: "Emerging Markets", region: "Emerging Markets" },
  "GOLDMAN SACHS GOLDMAN SACHS EUROPE CORE-IS EUR ACC": { country: "Europe", region: "Europe" },
  "GOLDMAN SACHS SICAV GOLDMAN SA-IS EURHDGD SNAP ACC": { country: "Unknown", region: "Unknown" },
  "ISHARES AUTOMATION & ROBOTICS UCITS ETF": { country: "World", region: "World" },
  "ISHARES CORE MSCI EM IMI UCITS ETF": { country: "Emerging Markets", region: "Emerging Markets" },
  "ISHARES CORE MSCI JAPAN IMI UCITS ETF": { country: "Japan", region: "Asia" },
  "ISHARES CORE S&P 500 UCITS ETF": { country: "United States", region: "North America" },
  "ISHARES EDGE MSCI USA VALUE FACTOR UCITS ETF": { country: "United States", region: "North America" },
  "ISHARES EDGE MSCI WORLD QUALITY FACTOR UCITS ETF": { country: "World", region: "World" },
  "ISHARES EDGE MSCI WORLD VALUE FACTOR UCITS ETF": { country: "World", region: "World" },
  "ISHARES EUR CORP BOND ESG SRI UCITS ETF": { country: "Europe", region: "Europe" },
  "ISHARES MSCI WORLD EUR HEDGED UCITS ETF ACC": { country: "World", region: "World" },
  "ISHARES USD TREASURY BOND 7-10YR UCITS ETF": { country: "United States", region: "North America" },
  "ISHARES V PLC - ISHARES S&P 500 EUR HEDGED UCITS E": { country: "United States", region: "North America" },
  "JANUS H ABS RET-G EUR ACC": { country: "Unknown", region: "Unknown" },
  "JPM EU GOVERNMENT BND-I EUR ACC": { country: "Europe", region: "Europe" },
  "JPM EUROPE EQ ABS ALPHA-I2 EUR ACC": { country: "Europe", region: "Europe" },
  "JPM EUROPE STGIC VALUE-I EUR ACC": { country: "Europe", region: "Europe" },
  "JPM GLB FOCUS-I EUR ACC HDGD": { country: "World", region: "World" },
  "JPM JAPAN EQ-I2 EUR ACC": { country: "Japan", region: "Asia" },
  "JPM JPM ASIA PACIFIC EQ-I2 EUR ACC": { country: "Asia", region: "Asia" },
  "JPM JPM US AGGREGATE BND-I EUR ACC HDGD": { country: "United States", region: "North America" },
  "JPM JPM US AGGREGATE BND-I2 EUR ACC HDGD": { country: "United States", region: "North America" },
  "JPM US VALUE-I EUR ACC": { country: "United States", region: "North America" },
  "JUPITER MERIAN GLB EQ ABS RET-I EUR HDGD ACC": { country: "World", region: "World" },
  "LAZARD RATHMORE ALTERNATIVE-S EUR ACC HDGD": { country: "Unknown", region: "Unknown" },
  "LUMYNA-MW TOPS MKTNEUTRAL UCITS-B EUR ACC": { country: "Unknown", region: "Unknown" },
  "LUMYNAMARSHALL WACE UCITS SICAVLUMYNA-MW-G EUR INC": { country: "Unknown", region: "Unknown" },
  "M&G LUX LUX GLB FLOATING RATE HY-JI H EUR ACC": { country: "World", region: "World" },
  "MAN PLCMAN JAPAN COREALPHA EQ-I EUR ACC": { country: "Japan", region: "Asia" },
  "MSTANLEY EURO CORPORATE BND-Z EUR ACC": { country: "Europe", region: "Europe" },
  "MSTANLEY SUST EMERGMKTS EQ-Z EUR ACC": { country: "Emerging Markets", region: "Emerging Markets" },
  "MUZINICH SHORT DUR HY-H EUR ACC": { country: "Unknown", region: "Unknown" },
  "NEUBERGER BERMAN SHORT DUR EURO BND-I EUR ACC": { country: "Europe", region: "Europe" },
  "NOMURA IRELAND PUBLIC LIMITED COMPANY JA-R EUR ACC": { country: "Unknown", region: "Unknown" },
  "NORDEA GLB CLIMATE AND ENVIRONMENT-I EUR ACC": { country: "World", region: "World" },
  "PICTET EUR ST HY-J EUR ACC": { country: "Europe", region: "Europe" },
  "PICTET TR ATLAS-I EUR ACC": { country: "Unknown", region: "Unknown" },
  "PICTET TR MANDARIN-HI EUR ACC": { country: "China", region: "Asia" },
  "PIMCO GIS EURO BND-INST EUR ACC": { country: "Europe", region: "Europe" },
  "ROBECO BP GLB PREMIUM EQ-K EUR ACC": { country: "World", region: "World" },
  "ROBECO BP GLB PREMIUM EQ-KH EUR ACC": { country: "World", region: "World" },
  "ROBECO EURO SDG CREDITS-I EUR ACC": { country: "Europe", region: "Europe" },
  "SCHRODER INT SELECTION EURO HY-IZ EUR ACC": { country: "Europe", region: "Europe" },
  "SCHRODER ISF EMERGMKTS-C EUR ACC": { country: "Emerging Markets", region: "Emerging Markets" },
  "SCHRODER ISF EURO CORPORATE BND-IZ EUR ACC": { country: "Europe", region: "Europe" },
  "SCHRODER ISF EURO EQ-K1 EUR ACC": { country: "Europe", region: "Europe" },
  "SCHRODER ISF GLB GOLD-C EUR ACC": { country: "Global", region: "Global" },
  "SS SPDR MSCI WORLD UCITS ETF": { country: "World", region: "World" },
  "SS SPDR S&P 500 UCITS ETF": { country: "United States", region: "North America" },
  "T ROWE SICAV US SMALL COMP EQ-IN1 EUR ACC": { country: "United States", region: "North America" },
  "TIKEHAU SHORT DUR-SF EUR ACC": { country: "Unknown", region: "Unknown" },
  "UBAM GLB HY SOLUTION-IH EUR ACC": { country: "World", region: "World" },
  "UBS BBG JAPAN GOV 1-3 UCITS ETF": { country: "Japan", region: "Asia" },
  "UBS S&P 500 SCORED & SCREENED UCITS ETF": { country: "United States", region: "North America" },
  "VANGUARD EURO GOVERNMENT BND IDX-EUR ACC": { country: "Europe", region: "Europe" },
  "WISDOMTREE EUROPE DEFENCE UCITS ETF": { country: "Europe", region: "Europe" },
  "XTRACKERS MSCI WORLD UCITS ETF": { country: "World", region: "World" },
  "XTRACKERS S&P 500 EQUAL WEIGHT UCITS ETF": { country: "United States", region: "North America" },
  "XTRACKERS STOXX EUROPE 600 UCITS ETF": { country: "Europe", region: "Europe" },
  "US TREASURY N/B 1.875% 15.02.41": { country: "United States", region: "North America" },
  "US TREASURY N/B 2.75% 15.08.42": { country: "United States", region: "North America" },
  "US TREASURY N/B 3.375% 15.05.33": { country: "United States", region: "North America" },
  "SKANDINAVISKA ENSKILDA 0.75% 09.08.27": { country: "Sweden", region: "Europe" },
  "SKANDINAVISKA ENSKILDA 3.75% 07.02.28": { country: "Sweden", region: "Europe" },
  "CC (EUR) en BANCO BPI": { country: "Portugal", region: "Europe" },
  "CC (EUR) en CECABANK": { country: "Spain", region: "Europe" },
  "CC (JPY) en CECABANK": { country: "Spain", region: "Europe" },
  "CC (USD) en CECABANK": { country: "Spain", region: "Europe" },
  "Valores Ativos": { country: "Unknown", region: "Unknown" },
  "Valores Passivos": { country: "Unknown", region: "Unknown" },
  // Trading212 ETFs (Assets sheet AST-002..005), classified from their
  // own real benchmark index, not from a Detailed Portfolio row.
  "UBS Core MSCI World (Acc)": { country: "World", region: "World" },
  "Avantis Global Small Cap Value (Acc)": { country: "World", region: "World" },
  "Xtrackers MSCI World Quality (Acc)": { country: "World", region: "World" },
  "SPDR MSCI Emerging Markets (Acc)": { country: "Emerging Markets", region: "Emerging Markets" },
};

/**
 * Ordered - first match wins, so more specific rules (GOLD) must come
 * before broader ones (WORLD/GLOBAL) that would otherwise shadow them.
 * `test` matches anywhere in the (uppercased) security name.
 */
const PATTERN_RULES = [
  { test: /GOLD/, country: "Global", region: "Global" },
  { test: /S&P\s?500|NASDAQ|US SMALL|US VALUE|US MUN\b/, country: "United States", region: "North America" },
  { test: /EMERGING|\bEM\b/, country: "Emerging Markets", region: "Emerging Markets" },
  { test: /ASIA/, country: "Asia", region: "Asia" },
  { test: /\bJAPAN\b/, country: "Japan", region: "Asia" },
  { test: /\bCHINA\b|MANDARIN/, country: "China", region: "Asia" },
  { test: /\bIBERIA(N)?\b/, country: "Europe", region: "Europe" },
  { test: /\bEUROPE\b|STOXX EUROPE|\bEURO\b|EURO GOVERNMENT/, country: "Europe", region: "Europe" },
  { test: /\bGERMANY\b|DEUTSCHLAND|\bBUND\b/, country: "Germany", region: "Europe" },
  { test: /\bFRANCE\b/, country: "France", region: "Europe" },
  { test: /\bPORTUGAL\b/, country: "Portugal", region: "Europe" },
  { test: /\bSPAIN\b/, country: "Spain", region: "Europe" },
  { test: /\bWORLD\b|\bGLB\b|\bGLOBAL\b/, country: "World", region: "World" },
];

/** Corporate bond issuer -> country. Substring match on the issuer
    portion of the security name (before the coupon/maturity). Kept
    deliberately short and specific - a generic "BPI -> Portugal" rule
    is NOT here on purpose: BPI Gestão de Ativos issues funds with
    genuinely global mandates too, so being BPI-branded is not real
    evidence of Portuguese geographic exposure (see BPI Oport./BPI
    Impacto Clima in the dictionary above, both Unknown for exactly
    this reason). Only add an issuer here when the issuer's country
    IS the primary geographic exposure, not just its listing/domicile. */
const ISSUER_RULES = [
  { test: /BANCO COMERC PORTUGUES|CAIXA GERAL DE DEPOSITOS|CREDITO AGRICOLA|\bREN FINANCE\b|\bEDP\b/, country: "Portugal", region: "Europe" },
  { test: /CELLNEX/, country: "Spain", region: "Europe" },
  { test: /ABN AMRO/, country: "Netherlands", region: "Europe" },
  { test: /SKANDINAVISKA ENSKILDA/, country: "Sweden", region: "Europe" },
  { test: /CECABANK/, country: "Spain", region: "Europe" },
];

/** Government / supranational bond issuer -> country. Checked after
    corporate issuers so a corporate name containing a country word
    isn't mistaken for a sovereign issuer. */
const GOVERNMENT_BOND_RULES = [
  { test: /BUNDESREPUB|DEUTSCHLAND/, country: "Germany", region: "Europe" },
  { test: /US TREASURY|TREASURY N\/B/, country: "United States", region: "North America" },
  { test: /SPAIN LETRAS|LETRAS DEL TESORO/, country: "Spain", region: "Europe" },
  { test: /EUROPEAN UNION|EUROPEAN INVESTMENT BANK/, country: "Europe", region: "Europe" },
];

/**
 * Classifies one security. Returns { country, region, method } where
 * method is one of "exact" | "pattern" | "issuer" | "government" |
 * "unknown" - surfaced in the UI so a user reviewing results can tell
 * a confident exact-match apart from a fresh pattern guess.
 */
function classifySecurity(name) {
  if (!name) return { country: "Unknown", region: "Unknown", method: "unknown" };

  if (SECURITY_DICTIONARY[name]) {
    return { ...SECURITY_DICTIONARY[name], method: "exact" };
  }

  const upper = name.toUpperCase();

  for (const rule of PATTERN_RULES) {
    if (rule.test.test(upper)) return { country: rule.country, region: rule.region, method: "pattern" };
  }
  for (const rule of ISSUER_RULES) {
    if (rule.test.test(upper)) return { country: rule.country, region: rule.region, method: "issuer" };
  }
  for (const rule of GOVERNMENT_BOND_RULES) {
    if (rule.test.test(upper)) return { country: rule.country, region: rule.region, method: "government" };
  }

  return { country: "Unknown", region: "Unknown", method: "unknown" };
}

/**
 * Classifies every holding in a fundHoldings-shaped array (see
 * consolidate.js: [fundName, period, categoryPath, name, currency,
 * qty, price, priceType, marketValue, weightPct]). Returns the same
 * rows with country/region/method appended, plus a separate list of
 * just the ones that came back Unknown (method === "unknown") for the
 * Unclassified Securities view.
 */
function classifyHoldings(fundHoldings) {
  const classified = fundHoldings.map((row) => {
    const name = row[3];
    const result = classifySecurity(name);
    return { row, name, ...result };
  });
  const unclassified = classified.filter((c) => c.method === "unknown");
  return { classified, unclassified };
}

/** Records a manual correction in the in-memory dictionary for the
    rest of this session (so the same security classified twice in one
    import batch stays consistent), and returns the entry that should
    be queued as a "pending dictionary addition" for the user to copy
    into the real Security Classifications sheet - this module never
    writes to the workbook itself. */
function recordManualClassification(name, country, region) {
  SECURITY_DICTIONARY[name] = { country, region };
  return { name, country, region, method: "manual", date: new Date().toISOString().slice(0, 10) };
}

/** The full allowed-value enum for manual classification, each mapped
    to its region - lets the Data Hub UI offer a single Country dropdown
    and derive Region automatically, rather than asking for both. */
const ALLOWED_VALUES_TO_REGION = {
  Portugal: "Europe", Spain: "Europe", Germany: "Europe", France: "Europe", Italy: "Europe",
  Netherlands: "Europe", Belgium: "Europe", Switzerland: "Europe", Sweden: "Europe", Norway: "Europe",
  Denmark: "Europe", Finland: "Europe", Ireland: "Europe", "United Kingdom": "Europe", Europe: "Europe",
  "United States": "North America", Canada: "North America",
  Japan: "Asia", China: "Asia", India: "Asia", Asia: "Asia",
  Brazil: "South America", Australia: "Oceania",
  "Emerging Markets": "Emerging Markets", Global: "Global", World: "World",
};

window.BPIGeoClassifier = {
  classifySecurity,
  classifyHoldings,
  recordManualClassification,
  SECURITY_DICTIONARY,
  ALLOWED_VALUES_TO_REGION,
};
