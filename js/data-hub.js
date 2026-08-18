/* ============================================================
   data-hub.js - Data Hub page. UI orchestration only: every real
   extraction/parsing decision is made by js/importer/*.js (migrated
   verbatim from the old standalone 07_BPI Fund Importer - see its
   README, now archived at 99_Archive/07_BPI Fund Importer). This file
   does not parse anything itself; it drives the same
   classify -> parse -> consolidate pipeline and renders it as
   Upload -> Preview -> Import instead of the old flat table dump.

   Internally still three layers, per the architecture:
     Extraction (pdfReader/classifier/*Parser) -> Mapping (consolidate)
     -> Workbook Update (not wired yet - see NOT_WIRED below).
   The user-facing workflow only ever shows Upload -> Preview -> Import.
   ============================================================ */

function $(id) { return document.getElementById(id); }

const REPORT_SOURCES = [
  { label: "BPI Monthly Factsheet", supported: true },
  { label: "BPI Detailed Portfolio", supported: true },
  { label: "Trading212 Statements", supported: false },
  { label: "ETF Key Information Documents", supported: false },
  { label: "Broker Statements", supported: false },
  { label: "CSV Imports", supported: false },
];

const PROCESSING_STEPS = [
  { key: "detected", label: "Report detected" },
  { key: "asset", label: "Asset identified" },
  { key: "date", label: "Report date extracted" },
  { key: "parsing", label: "Parsing" },
  { key: "validation", label: "Validation" },
  { key: "ready", label: "Ready" },
];

// key: "<fund-slug>|<period>" -> { fundName, period, fichaMensal, holdingsReport }
// groupGeo: same keys -> { rows, classified, unclassified } from geoClassifier.js
// pendingDictionaryAdditions: manual classifications from this session,
// not yet copied into the real Security Classifications sheet.
// portfolioId/securities/accounts: loaded once signed in, used by the
// "Load to Database" block (see dbLoadBlockHTML) so each fund-group card
// can offer a Security/Account picker without re-querying per card.
const state = {
  groups: new Map(), groupGeo: new Map(), pendingDictionaryAdditions: [],
  portfolioId: null, securities: [], accounts: [],
  // Currently-held securities only (loadDbContext, via
  // getPortfolioDataAuto()) - the set Update Portfolio's every method
  // (Manual, Trading 212, future BPI Screenshot) is restricted to. Kept
  // separate from `securities` (the full Security Master, used by
  // Research Data's own findOrCreateSecurity() path) on purpose - the
  // two lists answer different questions and must never be conflated.
  heldSecurityIds: new Set(), heldSecurities: [],
  // Update Portfolio (Trading 212 CSV) - the currently parsed+matched
  // rows between "Preview & Match" and "Confirm", and the raw text of
  // a file chosen (not yet parsed) so Upload/Paste can share one Parse
  // step. Cleared on every modal open/close (resetT212Modal below).
  t212Rows: [], t212PendingText: null,
  // Update Portfolio (BPI Screenshot) - the OCR-matched candidates
  // between "reading" and "review". Already filtered to rows that
  // matched a real security (see extractBpiCandidates() below) -
  // unlike t212Rows, this never holds a genuinely-unmatched row.
  bpiRows: [],
  // Raw OCR output BEFORE filtering - kept even when nothing matched,
  // specifically so a "found values, none matched" result is
  // diagnosable (what did OCR actually read?) instead of a dead end.
  // See the "Show detected text" toggle in the review step.
  bpiDebug: { lines: [], candidates: [] },
};

function slugify(name) {
  if (!name) return "fundo-desconhecido";
  const normalized = name.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "fundo-desconhecido";
}

function baseFundName(name) {
  if (!name) return name;
  return name.replace(/\s+CLAS[SE]E?\s+[A-Z]\s*$/i, "").trim();
}

function groupKeyFor(docType, result) {
  const name = result.fund.name.value;
  const date = docType === "ficha_mensal" ? result.fund.reference_date.value : result.fund.as_of_date.value;
  const slug = slugify(baseFundName(name || ""));
  const period = date ? date.slice(0, 7) : "periodo-desconhecido";
  return { key: `${slug}|${period}`, fundName: baseFundName(name || "Fundo desconhecido"), period, date };
}

/* ---------- Processing timeline (per file) ---------- */

function processingCardHTML(fileId, fileName) {
  return `
    <div class="card glass processing-card" id="proc-${fileId}">
      <p class="processing-file-name">${fileName}</p>
      <p class="processing-file-meta" data-role="meta">Waiting…</p>
      <div class="processing-steps">
        ${PROCESSING_STEPS.map((s) => `
          <span class="processing-step" data-step="${s.key}">
            <span class="step-icon">${icon("circle")}</span>${s.label}
          </span>`).join("")}
      </div>
    </div>`;
}

function setStep(fileId, key, status) {
  const el = document.querySelector(`#proc-${fileId} [data-step="${key}"]`);
  if (!el) return;
  el.classList.remove("is-done", "is-active", "is-error");
  el.classList.add(`is-${status}`);
  el.querySelector(".step-icon").innerHTML = icon(status === "done" ? "checkCircle" : status === "error" ? "close" : "circle");
}

function setMeta(fileId, text) {
  const el = document.querySelector(`#proc-${fileId} [data-role="meta"]`);
  if (el) el.textContent = text;
}

/* ---------- Upload -> classify -> parse (real pipeline, unchanged) ---------- */

let fileCounter = 0;

async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!files.length) return;

  const processingList = $("processing-list");

  for (const file of files) {
    const fileId = `f${++fileCounter}`;
    processingList.insertAdjacentHTML("beforeend", processingCardHTML(fileId, file.name));
    setStep(fileId, "detected", "done");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await BPIPdfReader.loadPdf(arrayBuffer.slice(0));
      setStep(fileId, "parsing", "active");
      const docType = await BPIClassifier.classifyDocument(pdfDoc);

      if (docType === null) {
        setStep(fileId, "parsing", "error");
        setMeta(fileId, "Document type not recognised.");
        continue;
      }

      const result = docType === "ficha_mensal"
        ? await BPIMonthlyFactsheetParser.parseFichaMensal(file, pdfDoc)
        : await BPIHoldingsReportParser.parseHoldingsReport(file, pdfDoc);

      setStep(fileId, "parsing", "done");
      setStep(fileId, "asset", result.fund.name.value ? "done" : "error");
      const dateField = docType === "ficha_mensal" ? result.fund.reference_date : result.fund.as_of_date;
      setStep(fileId, "date", dateField.value ? "done" : "error");
      setStep(fileId, "validation", "done");
      setStep(fileId, "ready", "done");

      const { key, fundName, period } = groupKeyFor(docType, result);
      if (!state.groups.has(key)) state.groups.set(key, { fundName, period, fichaMensal: null, holdingsReport: null });
      const group = state.groups.get(key);
      if (docType === "ficha_mensal") group.fichaMensal = result;
      else group.holdingsReport = result;

      const warnCount = result.warnings.length;
      setMeta(fileId, `${docType === "ficha_mensal" ? "BPI Monthly Factsheet" : "BPI Detailed Portfolio"} · ${fundName} · ${period}`
        + (warnCount ? ` · ${warnCount} warning(s)` : ""));
    } catch (err) {
      console.error(err);
      setStep(fileId, "parsing", "error");
      setMeta(fileId, `Error: ${err.message}`);
    }
  }

  renderGroups();
}

/* ---------- Preview + Import (new framing over the same real tables) ---------- */

// Extends BPIConsolidate's real Fund Holdings columns with the two
// geographic columns (matching 02_Portfolio Workbook.xlsx's Detailed
// Portfolio schema exactly, so "Copy to Excel" pastes in alignment) -
// computed here, not inside consolidate.js, so the parser/mapping layer
// stays untouched per the original migration's "do not redesign the
// parser" instruction. geoClassifier.js is the actual classification
// logic; this is just where its output gets merged into the row shape.
const FUND_HOLDINGS_WITH_GEO_HEADERS = [...BPIConsolidate.TABLE_HEADERS.fundHoldings, "Exposure Country", "Exposure Region"];

function classifyGroupHoldings(tables) {
  const { classified, unclassified } = BPIGeoClassifier.classifyHoldings(tables.fundHoldings);
  const rows = classified.map((c) => [...c.row, c.country, c.region]);
  return { rows, classified, unclassified };
}

function detectedCategories(tables, group, geo) {
  return [
    { key: "costs", label: "Costs", icon: "landmark", present: !!group.fichaMensal, count: group.fichaMensal ? 1 : 0 },
    { key: "allocations", label: "Allocations", icon: "pieChart", present: tables.fundAssetClassDistribution.length > 0, count: tables.fundAssetClassDistribution.length },
    { key: "detailedPortfolio", label: "Detailed Portfolio", icon: "fileText", present: tables.fundHoldings.length > 0, count: tables.fundHoldings.length },
    {
      key: "geoExposure", label: "Geographic Exposure", icon: "globe",
      present: geo.classified.length > 0,
      count: geo.classified.length,
      note: geo.classified.length ? `${geo.classified.length - geo.unclassified.length}/${geo.classified.length} classified` : null,
    },
  ];
}

const RAW_TABLES = [
  { key: "fundSnapshots", title: "Fund Snapshots" },
  { key: "fundPerformance", title: "Fund Performance" },
  { key: "fundAssetClassDistribution", title: "Fund Asset Class Distribution" },
  { key: "fundTopHoldings", title: "Fund Top Holdings" },
  { key: "fundShareClasses", title: "Fund Share Classes" },
  { key: "fundHoldings", title: "Fund Holdings" },
];

function rawTableBlockHTML(groupKey, tableKey, title, headers, rows) {
  const previewRows = rows.slice(0, 5);
  return `
    <div class="raw-table-block">
      <div class="raw-table-head">
        <span class="raw-table-title">${title} (${rows.length})</span>
        <button class="copy-btn" type="button" data-copy="${groupKey}|${tableKey}" ${rows.length ? "" : "disabled"}>Copy to Excel</button>
      </div>
      ${rows.length === 0 ? `<p class="raw-table-empty">No data yet.</p>` : `
        <div class="raw-table-scroll">
          <table class="raw-table">
            <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
            <tbody>${previewRows.map((r) => `<tr>${r.map((v) => `<td>${v === null || v === undefined || v === "" ? "—" : v}</td>`).join("")}</tr>`).join("")}</tbody>
          </table>
        </div>
        ${rows.length > previewRows.length ? `<p class="raw-table-empty">…and ${rows.length - previewRows.length} more row(s). "Copy to Excel" copies all of them.</p>` : ""}`}
    </div>`;
}

/** Unclassified Securities - the honest "couldn't determine this one"
    list geoClassifier.js produces (never guessed). Each row gets an
    inline Country dropdown; picking one classifies it for the rest of
    this session and queues it as a pending dictionary addition (see
    pendingAdditionsBlockHTML) - the user still has to copy that into
    the real Security Classifications sheet themselves, same
    nothing-writes-itself rule as everywhere else in Data Hub. */
function unclassifiedBlockHTML(groupKey, unclassified) {
  if (!unclassified.length) return "";
  const options = Object.keys(BPIGeoClassifier.ALLOWED_VALUES_TO_REGION)
    .map((c) => `<option value="${c}">${c}</option>`).join("");
  return `
    <div class="unclassified-block">
      <p class="unclassified-title">${icon("activity")} ${unclassified.length} security${unclassified.length === 1 ? "" : "ies"} couldn't be classified automatically</p>
      <div class="unclassified-list">
        ${unclassified.map((c, i) => `
          <div class="unclassified-row" data-group="${groupKey}" data-index="${i}" data-name="${c.name.replace(/"/g, "&quot;")}">
            <span class="unclassified-name">${c.name}</span>
            <select class="unclassified-select" aria-label="Classify ${c.name}">
              <option value="">Classify…</option>
              ${options}
            </select>
          </div>`).join("")}
      </div>
    </div>`;
}

function pendingAdditionsBlockHTML() {
  if (!state.pendingDictionaryAdditions.length) return "";
  const headers = ["Security Name", "Exposure Country", "Exposure Region", "Classification Method", "Date Added", "Notes"];
  const rows = state.pendingDictionaryAdditions.map((p) => [p.name, p.country, p.region, "Manual (Data Hub)", p.date, ""]);
  return `
    <section class="card glass fund-group-card" id="pending-additions">
      <div class="fund-group-header">
        <span class="fund-group-name">Pending Dictionary Additions</span>
        <span class="fund-group-period">${state.pendingDictionaryAdditions.length} new classification${state.pendingDictionaryAdditions.length === 1 ? "" : "s"}</span>
      </div>
      <p class="section-hint">Manually classified this session - copy into the workbook's Security Classifications sheet so future imports recognise these automatically.</p>
      ${rawTableBlockHTML("pending", "additions", "New Classifications", headers, rows)}
    </section>`;
}

/* ---------- Load to Database (real - writes Costs via Supabase) ----------
   Deliberately scoped to Costs only, not the full "Import to Workbook"
   ambition below: Costs is the one category a Ficha Mensal reliably gives
   a real, dated, per-security figure for (TER/Depositary/Subscription/
   Redemption %). Valuations would need cross-referencing the report's
   NAV/unit against how many units this portfolio actually holds - a real
   future feature, not this one. Allocations and Detailed Portfolio don't
   have a Supabase table yet at all (Migration Plan Phase 4/5). */

async function loadDbContext() {
  const user = currentUser();
  if (!window.db || !user) {
    state.portfolioId = null;
    state.securities = [];
    state.accounts = [];
    state.heldSecurityIds = new Set();
    state.heldSecurities = [];
    return;
  }
  state.portfolioId = await ensurePortfolio();
  state.securities = await loadSecurities();
  state.accounts = await loadAccountsForPortfolio(state.portfolioId);

  // Update Portfolio only ever operates on INVESTMENT SECURITIES the
  // user CURRENTLY holds (per Vera's own explicit ruling: an update
  // means "I already own this, what's it worth today", never a way to
  // add a new holding - that's Transactions -> Buy; and never Cash EUR,
  // which isn't an investment product at all). getPortfolioDataAuto()
  // is the one canonical "what do I currently hold" definition already
  // used by Overview/Portfolio Detail/Performance - reused here rather
  // than re-deriving "held" from transactions/valuations a second way
  // that could quietly drift from what those pages show. type ===
  // "Cash" is the same check analytics.js itself uses to find the cash
  // pseudo-security, not a new definition invented here.
  const portfolioData = await getPortfolioDataAuto();
  state.heldSecurities = portfolioData.portfolio.holdings
    .filter((h) => h.type !== "Cash")
    .map((h) => ({ id: h.id, name: h.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  state.heldSecurityIds = new Set(state.heldSecurities.map((h) => h.id));
}

/** Case- AND diacritic-insensitive (normalizeName(), utils.js) - fixed
    after a real live import created a duplicate "BPI DINAMICO" security
    instead of matching the existing "BPI Dinâmico", because BPI's own
    PDF prints the fund name without the accent and the old plain
    .toLowerCase() comparison treated that as a different security. */
function guessSecurityId(fundName) {
  const match = state.securities.find((s) => normalizeName(s.name) === normalizeName(fundName || ""));
  return match ? match.id : "";
}

/** Only the four fee fields a Ficha Mensal reliably states. Frequency/
    category follow the same convention already used for every real cost
    in the workbook (Management+Annual for TER/Depositary, Trading+One-off
    for Subscription/Redemption) - see 02_Portfolio Workbook.xlsx's real
    Costs sheet. Fields the parser couldn't find are skipped, never
    inserted as a guessed 0. */
function costRowsFromFichaMensal(fm, securityId, accountId, date) {
  const c = fm.commercial_characteristics;
  const rows = [];
  const push = (name, category, frequency, field) => {
    const v = field && field.value;
    if (v === null || v === undefined) return;
    rows.push({
      security_id: securityId, account_id: accountId || null, date,
      cost_category: category, cost_name: name, frequency, unit: "%", value: v,
      source: "BPI Ficha Mensal (Data Hub import)", report_date: date,
    });
  };
  push("TER", "Management", "Annual", c.management_fee_pct);
  push("Depositary Fee", "Management", "Annual", c.depositary_fee_pct);
  push("Subscription Fee", "Trading", "One-off", c.subscription_fee_pct);
  push("Redemption Fee", "Trading", "One-off", c.redemption_fee_pct);
  return rows;
}

function securityOptionsHTML(selectedId) {
  const options = state.securities
    .map((s) => `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${s.name}</option>`)
    .join("");
  return `<option value="">— Create new —</option>${options}`;
}

function accountOptionsHTML() {
  return `<option value="">None</option>` + state.accounts.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
}

function dbLoadBlockHTML(groupKey, group) {
  // Was `if (!group.fichaMensal) return ""` - hid the entire Load to
  // Database section, button included, whenever a Ficha Mensal wasn't
  // ALSO present, even if a Carteira Detalhada was sitting there ready
  // to load on its own. loadCostsToDatabase() below already handles fm
  // and hr (Carteira Detalhada) independently - this gate just never
  // let you reach the button for an hr-only group. Fixed to only hide
  // when NEITHER document exists.
  if (!group.fichaMensal && !group.holdingsReport) return "";

  if (!window.db) {
    return `<div class="db-load-block"><p class="db-load-signedout">Supabase isn't configured yet.</p></div>`;
  }
  if (!currentUser()) {
    return `
      <div class="db-load-block">
        <p class="db-load-signedout">Sign in to load these costs straight into the database.
          <button type="button" data-signin-cta>Sign In</button>
        </p>
      </div>`;
  }

  const guessedId = guessSecurityId(group.fundName);
  return `
    <div class="db-load-block">
      <p class="db-load-title">Load to Database</p>
      <div class="db-load-row">
        <div class="db-load-field">
          <label for="db-security-${cssId(groupKey)}">Security</label>
          <select class="db-load-select" id="db-security-${cssId(groupKey)}" data-security-select="${groupKey}">
            ${securityOptionsHTML(guessedId)}
          </select>
          ${guessedId
            ? `<p class="db-load-match-note db-load-match-found">Matched to an existing security by name.</p>`
            : `<p class="db-load-match-note db-load-match-none">No existing security matches "${group.fundName}" - this will create a new one. If this fund is already in Securities under a different name, pick it above instead.</p>`}
        </div>
        <div class="db-load-field">
          <label for="db-account-${cssId(groupKey)}">Account (optional)</label>
          <select class="db-load-select" id="db-account-${cssId(groupKey)}" data-account-select="${groupKey}">
            ${accountOptionsHTML()}
          </select>
        </div>
      </div>
      <button class="load-db-btn" type="button" data-load-db="${groupKey}">Load to Database</button>
      <p class="load-db-status" id="db-status-${cssId(groupKey)}"></p>
    </div>`;
}

function fundGroupCardHTML(groupKey, group, tables, geo) {
  const categories = detectedCategories(tables, group, geo);
  const missingDoc = !group.fichaMensal ? "BPI Monthly Factsheet" : !group.holdingsReport ? "BPI Detailed Portfolio" : null;

  return `
    <section class="card glass fund-group-card" id="group-${cssId(groupKey)}">
      <div class="fund-group-header">
        <span class="fund-group-name">${group.fundName}</span>
        <span class="fund-group-period">Report date: ${tables.reportDate || group.period}</span>
      </div>
      <div class="fund-group-meta">
        <span>Source: <b>${[group.fichaMensal ? "Ficha Mensal" : null, group.holdingsReport ? "Carteira Detalhada" : null].filter(Boolean).join(" + ")}</b></span>
      </div>

      ${missingDoc ? `<div class="fund-group-notice">Only one document loaded so far - ${missingDoc} for this period is still missing. Some categories below will stay empty until it's added.</div>` : ""}
      ${tables.issues.length ? `<div class="fund-group-notice"><b>Validation:</b> ${tables.issues.join("<br>")}</div>` : ""}

      <div class="detected-data-list">
        ${categories.map((c) => `
          <label class="detected-data-row${c.present ? "" : " is-missing"}">
            <input type="checkbox" ${c.present ? "checked" : "disabled"}>
            <span class="dd-icon">${icon(c.present ? "checkCircle" : "circle")}</span>
            <span class="detected-data-label">${c.label}</span>
            <span class="detected-data-count">${c.present ? (c.note || `${c.count} row${c.count === 1 ? "" : "s"}`) : "not detected"}</span>
          </label>`).join("")}
      </div>

      ${unclassifiedBlockHTML(groupKey, geo.unclassified)}

      ${dbLoadBlockHTML(groupKey, group)}

      <div class="fund-group-actions">
        <button class="import-btn" type="button" data-import="${groupKey}">Import Allocations / Detailed Portfolio</button>
        <span class="import-not-wired-note" data-role="import-note" hidden>These two don't have a database table yet - use "Copy to Excel" below for now, and paste into the real workbook.</span>
      </div>

      <button class="raw-tables-toggle" type="button" data-toggle-raw="${groupKey}">${icon("chevronDown")} Show raw parsed tables</button>
      <div class="raw-tables" id="raw-${cssId(groupKey)}">
        ${RAW_TABLES.map((t) => t.key === "fundHoldings"
          ? rawTableBlockHTML(groupKey, t.key, "Fund Holdings (+ Geographic Exposure)", FUND_HOLDINGS_WITH_GEO_HEADERS, geo.rows)
          : rawTableBlockHTML(groupKey, t.key, t.title, BPIConsolidate.TABLE_HEADERS[t.key], tables[t.key])
        ).join("")}
      </div>
    </section>`;
}

function cssId(key) { return key.replace(/[^a-zA-Z0-9]/g, "-"); }

function renderGroups() {
  const container = $("groups-list");
  container.innerHTML = "";
  state.groupGeo.clear();

  for (const [key, group] of state.groups) {
    const tables = BPIConsolidate.buildFundTables(group);
    tables.reportDate = (group.fichaMensal && group.fichaMensal.fund.reference_date.value)
      || (group.holdingsReport && group.holdingsReport.fund.as_of_date.value) || null;
    const geo = classifyGroupHoldings(tables);
    state.groupGeo.set(key, geo);
    container.insertAdjacentHTML("beforeend", fundGroupCardHTML(key, group, tables, geo));
  }

  container.insertAdjacentHTML("beforeend", pendingAdditionsBlockHTML());

  container.querySelectorAll("[data-toggle-raw]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = document.getElementById(`raw-${cssId(btn.dataset.toggleRaw)}`);
      panel.classList.toggle("open");
      btn.classList.toggle("open");
    });
  });

  container.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Real pre-existing bug, found while testing this: group keys are
      // themselves "<slug>|<period>" (see groupKeyFor), so a naive
      // split("|") + 2-way destructure silently truncated the group key
      // whenever this ran - split on the LAST "|" instead (tableKey
      // never contains one).
      const sepIndex = btn.dataset.copy.lastIndexOf("|");
      const groupKey = btn.dataset.copy.slice(0, sepIndex);
      const tableKey = btn.dataset.copy.slice(sepIndex + 1);
      if (groupKey === "pending") {
        const headers = ["Security Name", "Exposure Country", "Exposure Region", "Classification Method", "Date Added", "Notes"];
        const rows = state.pendingDictionaryAdditions.map((p) => [p.name, p.country, p.region, "Manual (Data Hub)", p.date, ""]);
        copyTsv(headers, rows, btn);
        return;
      }
      const group = state.groups.get(groupKey);
      const tables = BPIConsolidate.buildFundTables(group);
      if (tableKey === "fundHoldings") {
        copyTsv(FUND_HOLDINGS_WITH_GEO_HEADERS, state.groupGeo.get(groupKey).rows, btn);
      } else {
        copyTsv(BPIConsolidate.TABLE_HEADERS[tableKey], tables[tableKey], btn);
      }
    });
  });

  // Manual classification - never writes to the workbook itself, just
  // records the choice in-session (so it's remembered for the rest of
  // this batch) and queues it as a pending dictionary addition for the
  // user to copy into the real Security Classifications sheet.
  container.querySelectorAll(".unclassified-select").forEach((select) => {
    select.addEventListener("change", () => {
      const country = select.value;
      if (!country) return;
      const row = select.closest(".unclassified-row");
      const name = row.dataset.name;
      const region = BPIGeoClassifier.ALLOWED_VALUES_TO_REGION[country] || country;
      const entry = BPIGeoClassifier.recordManualClassification(name, country, region);
      state.pendingDictionaryAdditions.push(entry);
      renderGroups();
    });
  });

  // Not connected to the workbook yet, by design (this iteration migrates
  // the UI only) - clicking Import surfaces that honestly instead of
  // silently doing nothing.
  container.querySelectorAll("[data-import]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = btn.parentElement.querySelector("[data-role='import-note']");
      note.hidden = false;
    });
  });

  container.querySelectorAll("[data-signin-cta]").forEach((btn) => {
    btn.addEventListener("click", () => window.openAuthModal());
  });

  // Keep the match note honest as she changes the selection herself -
  // the initial guess is just a starting point, not the only signal.
  container.querySelectorAll("[data-security-select]").forEach((select) => {
    select.addEventListener("change", () => {
      const note = select.parentElement.querySelector(".db-load-match-note");
      if (!note) return;
      if (select.value) {
        note.className = "db-load-match-note db-load-match-found";
        note.textContent = "Costs will be added to the selected existing security.";
      } else {
        const groupKey = select.dataset.securitySelect;
        const group = state.groups.get(groupKey);
        note.className = "db-load-match-note db-load-match-none";
        note.textContent = `No existing security matches "${group.fundName}" - this will create a new one. If this fund is already in Securities under a different name, pick it above instead.`;
      }
    });
  });

  container.querySelectorAll("[data-load-db]").forEach((btn) => {
    btn.addEventListener("click", () => loadCostsToDatabase(btn.dataset.loadDb));
  });
}

async function loadCostsToDatabase(groupKey) {
  const group = state.groups.get(groupKey);
  const statusEl = document.getElementById(`db-status-${cssId(groupKey)}`);
  const btn = document.querySelector(`[data-load-db="${groupKey}"]`);
  const securitySelect = document.querySelector(`[data-security-select="${groupKey}"]`);
  const accountSelect = document.querySelector(`[data-account-select="${groupKey}"]`);

  statusEl.className = "load-db-status";
  statusEl.textContent = "";
  btn.disabled = true;

  try {
    // fm (Ficha Mensal) and hr (Carteira Detalhada/Detailed Portfolio)
    // are genuinely different documents - a group can have either, both,
    // or (impossible to reach this button, but defensively) neither.
    // Nothing below assumes fm exists unconditionally anymore - it used
    // to, which meant a holdings-report-only group would crash here.
    const fm = group.fichaMensal;
    const hr = group.holdingsReport;
    const date = fm ? fm.fund.reference_date.value : (hr ? hr.fund.as_of_date.value : null);
    if (!date) throw new Error("This report has no reference date - can't record dated data without one.");

    let securityId = securitySelect.value;
    if (!securityId) {
      securityId = await findOrCreateSecurity({ name: group.fundName, type: "Fund", currency: "EUR" }, state.securities);
    }

    // Reflects exactly what's actually being loaded in THIS click, not
    // a generic constant - so if both documents are loaded together,
    // neither upsert below silently overwrites the other's provenance
    // with a partial description (source is one shared column, same
    // established pattern as costs/performance/allocation already
    // sharing it - see 0007's own reasoning).
    const sourceParts = [];
    if (fm) sourceParts.push("BPI Ficha Mensal");
    if (hr) sourceParts.push("BPI Carteira Detalhada");
    const sourceLabel = `${sourceParts.join(" + ")} (Data Hub import)`;

    const loaded = [];

    if (fm) {
      const costRows = costRowsFromFichaMensal(fm, securityId, accountSelect.value, date);
      if (costRows.length) {
        costRows.forEach((r) => { r.portfolio_id = state.portfolioId; });
        const { error } = await window.db.from("costs").insert(costRows);
        if (error) throw error;
        loaded.push(`${costRows.length} cost row(s)`);
      }

      // Current-state composition (0011_security_current_composition.sql) -
      // replaced wholesale on every import, never appended, per Vera's own
      // "don't accumulate historical composition rows forever" decision.
      // Upsert (not update) because a brand-new security has no
      // security_details row yet to update - security_id is that table's
      // real primary key, so this is a genuine 1:1 upsert, never a
      // duplicate. "none" confidence means the section wasn't found in
      // this PDF at all (see field()/confidence throughout
      // monthlyFactsheetParser.js) - skipped, not saved as an empty list,
      // so a parsing miss can never look identical to "this fund
      // genuinely has zero holdings".
      if (fm.top_holdings.holdings.length && fm.top_holdings.confidence !== "none") {
        const { error } = await window.db.from("security_details").upsert(
          { security_id: securityId, top_holdings: fm.top_holdings.holdings, composition_as_of: date, source: sourceLabel },
          { onConflict: "security_id" }
        );
        if (error) throw error;
        loaded.push(`${fm.top_holdings.holdings.length} top holding(s)`);
      }
    }

    // Full current holdings list (0012_security_full_holdings.sql) - the
    // ~118-row real list, from the Carteira Detalhada specifically
    // (js/importer/holdingsReportParser.js already parses it in full;
    // nothing had ever persisted that output before this). Kept
    // independent of the Ficha Mensal branch above - a security can get
    // this without ever having a Ficha Mensal loaded at all.
    if (hr && hr.holdings.length) {
      const hrDate = (hr.fund.as_of_date && hr.fund.as_of_date.value) || date;
      const { error } = await window.db.from("security_details").upsert(
        { security_id: securityId, all_holdings: hr.holdings, all_holdings_as_of: hrDate, source: sourceLabel },
        { onConflict: "security_id" }
      );
      if (error) throw error;
      loaded.push(`${hr.holdings.length} full holding(s)`);
    }

    if (!loaded.length) throw new Error("No fee fields, top holdings, or detailed holdings were extracted from this report - nothing to load.");

    statusEl.className = "load-db-status is-success";
    statusEl.textContent = `${loaded.join(" + ")} loaded ✓`;
    btn.textContent = "Loaded ✓";
  } catch (err) {
    statusEl.className = "load-db-status is-error";
    statusEl.textContent = err.message || "Failed to load.";
    btn.disabled = false;
  }
}

function copyTsv(headers, rows, btn) {
  const lines = [headers, ...rows].map((r) => r.map((v) => (v === null || v === undefined ? "" : v)).join("\t"));
  navigator.clipboard.writeText(lines.join("\n")).then(() => {
    const original = btn.textContent;
    btn.textContent = "Copied ✓";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

/* ---------- Init ---------- */

function initDropZone() {
  const dropZone = $("drop-zone");
  const fileInput = $("file-input");
  $("drop-zone-icon").innerHTML = icon("upload");

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

  ["dragenter", "dragover"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add("drag-active"); });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove("drag-active"); });
  });
  dropZone.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
}

function renderSourceChips() {
  $("source-chip-list").innerHTML = REPORT_SOURCES.map((s) => `
    <span class="source-chip ${s.supported ? "is-supported" : "is-future"}">
      ${icon(s.supported ? "checkCircle" : "circle")}
      ${s.label}
      ${s.supported ? "" : `<span class="chip-tag">Soon</span>`}
    </span>`).join("");
}

/* ============================================================
   Update Portfolio - Portfolio Data, not Research Data (see this
   file's own header + data-hub.html's section comments for the
   distinction). Every method below ends by calling recordValuations()
   (db.js) - the exact same insert-only write path Portfolio Detail's
   own per-holding Update already uses (js/portfolio.js) - so
   there is only ever one real definition of "what does updating my
   portfolio mean", regardless of which method supplied the data.
   ============================================================ */

const UPDATE_METHODS = [
  { key: "manual", icon: "edit3", title: "Manual Update", sub: "Update one holding by hand", enabled: true },
  { key: "t212", icon: "upload", title: "Trading 212 CSV", sub: "Upload or paste your Trading 212 export", enabled: true },
  // Enabled after this session's own architecture review confirmed the
  // pipeline is genuinely complete: same exact-then-fuzzy matching /
  // held-only eligibility / review-before-write discipline as Trading
  // 212's own CSV import above, Tesseract.js runs entirely client-side
  // (no third party ever sees the screenshot), and the final write goes
  // through the same recordValuations() path as every other method
  // here. Was sitting behind this flag, not behind a real gap.
  { key: "bpi-screenshot", icon: "fileText", title: "BPI Screenshot", sub: "Update from a screenshot of the BPI app or BPINet", enabled: true },
];

function updateMethodsHTML() {
  return UPDATE_METHODS.map((m) => `
    <button type="button" class="update-method-btn" data-update-method="${m.key}"${m.enabled ? "" : " disabled"}>
      <span class="update-method-icon">${icon(m.icon)}</span>
      <span class="update-method-body">
        <span class="update-method-title">${m.title}${m.enabled ? "" : ` <span class="update-method-badge">Coming Soon</span>`}</span>
        <span class="update-method-sub">${m.sub}</span>
      </span>
    </button>`).join("");
}

function initUpdatePortfolioMethods() {
  $("update-portfolio-methods").innerHTML = updateMethodsHTML();
  $("update-portfolio-methods").querySelectorAll("[data-update-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.updateMethod;
      if (key === "manual") openManualUpdateModal();
      if (key === "t212") openT212Modal();
      if (key === "bpi-screenshot") openBpiScreenshotModal();
    });
  });
}

/* ---------- Manual Update modal ----------
   The security is picked from a <select> of CURRENTLY HELD securities
   only (state.heldSecurities, not the full Security Master) - an
   update means "I already own this, what's it worth today", never a
   way to start holding something new (that's Transactions -> Buy, per
   Vera's own explicit ruling). Free text was never involved anyway (no
   findOrCreateSecurity() call here), so this was already safe against
   creating a duplicate security - the held-only restriction is a
   separate rule, about what Update Portfolio MEANS, not just about
   duplicate-safety. Deliberately no Source field (unlike Portfolio
   Detail's own Update modal) - this entry point is meant to be fast on
   a phone, so the source is fixed to "Manual (Data Hub)" rather than
   one more field to fill in.

   Named distinctly from the OTHER securityOptionsHTML() above (Research
   Data's Load-to-Database picker, full Security Master + "Create new")
   - same function name in the same scope would have silently shadowed
   one of them; they answer genuinely different questions and must stay
   two separate functions. */
function heldSecurityOptionsHTML() {
  if (!state.heldSecurities.length) return `<option value="">No holdings on record</option>`;
  return state.heldSecurities
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join("");
}

function muKeyHandler(e) { if (e.key === "Escape") window.closeManualUpdateModal(); }

function initManualUpdateModal() {
  const root = $("manual-update-modal-root");
  const close = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", muKeyHandler);
  };
  $("manual-update-modal-backdrop").addEventListener("click", close);
  $("mu-form-cancel").addEventListener("click", close);
  window.closeManualUpdateModal = close;

  $("mu-form-submit").addEventListener("click", async () => {
    const errorEl = $("mu-form-error");
    const submitBtn = $("mu-form-submit");
    errorEl.textContent = "";

    // Signed-out visitors can still open this modal and see what it
    // does (same "make the limitation visible, not hidden" principle
    // as the rest of Data Hub) - only the actual write gates on
    // sign-in, and does so with a real prompt, not a silent RLS error.
    if (!currentUser()) { errorEl.textContent = "Sign in to save updates."; window.openAuthModal(); return; }

    const securityId = $("mu-security").value;
    const date = $("mu-date").value;
    const value = $("mu-value").value;
    if (!securityId) { errorEl.textContent = "Choose a security."; return; }
    if (!date) { errorEl.textContent = "Date is required."; return; }
    if (value === "") { errorEl.textContent = "Value is required."; return; }

    submitBtn.disabled = true;
    try {
      await recordValuations([{
        portfolio_id: state.portfolioId,
        security_id: securityId,
        date,
        value_eur: Number(value),
        units: $("mu-units").value === "" ? null : Number($("mu-units").value),
        source: "Manual (Data Hub)",
      }]);
      close();
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  });
}

function openManualUpdateModal() {
  $("mu-security").innerHTML = heldSecurityOptionsHTML();
  $("mu-date").value = new Date().toISOString().slice(0, 10);
  $("mu-value").value = "";
  $("mu-units").value = "";
  $("mu-form-error").textContent = "";
  $("manual-update-modal-root").classList.add("open");
  document.addEventListener("keydown", muKeyHandler);
}

/* ---------- Trading 212 CSV import ---------- */

/** Minimal RFC4180-ish CSV line splitter - handles quoted fields
    (embedded commas, "" escaped quotes), which a plain .split(",")
    breaks on the moment any field contains a comma. No external
    dependency - a portfolio export doesn't need more than this. */
function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function parseCsvRows(text) {
  return text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").map(parseCsvLine);
}

/** Trading 212's own portfolio/pie export. "Slice" is the pie
    component's own ticker; "Total" in Slice always marks the pie-level
    summary row, whose OWN "Name" cell holds the pie's name (e.g.
    "Global Factor Tilt") - never a security, never treated as one, on
    purpose (see the confirmed real export's own row: "Total","Global
    Factor Tilt",160,...).

    Columns are looked up by HEADER NAME, not position, and a row with
    an unparseable Value is skipped rather than aborting the whole
    import - confirmed against Vera's real export that values differ
    slightly run to run; this shouldn't break on that kind of normal
    variation, only on a genuinely different file shape (missing
    Slice/Name/Value entirely). */
function parseTrading212Csv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("This CSV has no data rows.");

  const header = rows[0].map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const iSlice = col("Slice"), iName = col("Name"), iValue = col("Value"),
    iInvested = col("Invested value"), iResult = col("Result"), iQty = col("Owned quantity");

  if (iSlice === -1 || iName === -1 || iValue === -1) {
    throw new Error("This doesn't look like a Trading 212 portfolio export - missing Slice/Name/Value columns.");
  }

  const parsed = [];
  for (const r of rows.slice(1)) {
    const slice = (r[iSlice] || "").trim();
    const name = (r[iName] || "").trim();
    if (!slice || slice.toLowerCase() === "total") continue; // pie-level summary row, not a security

    const value = parseFloat(r[iValue]);
    if (Number.isNaN(value)) continue;

    const invested = iInvested !== -1 ? parseFloat(r[iInvested]) : NaN;
    const result = iResult !== -1 ? parseFloat(r[iResult]) : NaN;
    const qtyRaw = iQty !== -1 ? (r[iQty] || "").trim() : "";
    const units = qtyRaw && qtyRaw !== "-" ? parseFloat(qtyRaw) : NaN;

    parsed.push({
      slice, name, value,
      invested: Number.isNaN(invested) ? null : invested,
      result: Number.isNaN(result) ? null : result,
      units: Number.isNaN(units) ? null : units,
    });
  }
  return parsed;
}

/** Matching order, exactly as specified: ticker/Slice first (exact,
    case-insensitive - the strongest signal this CSV actually has),
    then ISIN (not present in this CSV format yet, but kept as a real,
    reachable step so a future enrichment source can slot in without
    restructuring this function), then normalizeName() fallback - the
    same fuzzy-name function every other import path in this app
    already uses (utils.js), not a second definition of "same name".

    An AMBIGUOUS match (more than one security matches the same key) is
    treated as NO match, not a guess - and no match of any kind ever
    creates a security here. This is the whole point of this function:
    a free-text/auto-create path is exactly what produced the "BPI
    Smart Ações PPR" vs "BPI SMART Ações PPR" duplicate; this one only
    ever resolves to an EXISTING row's id, or null.

    Recognising the security is NOT enough to update it, though -
    Vera's own explicit safeguard: "security must exist AND security
    must currently be held" before it's eligible for a valuation
    update. A real security that isn't currently held gets its own
    third state below (t212StatusHTML/renderT212ReviewTable) - "you
    don't hold this yet, add it through Transactions first" - never
    silently folded into either "Matched" or "Needs review". */
function matchTrading212Row(row, securities) {
  const bySlice = securities.filter((s) => s.ticker && s.ticker.toUpperCase() === row.slice.toUpperCase());
  if (bySlice.length === 1) return finalizeTrading212Match(bySlice[0], "ticker");

  if (row.isin) {
    const byIsin = securities.filter((s) => s.isin && s.isin === row.isin);
    if (byIsin.length === 1) return finalizeTrading212Match(byIsin[0], "isin");
  }

  const norm = normalizeName(row.name);
  const byName = securities.filter((s) => normalizeName(s.name) === norm);
  if (byName.length === 1) return finalizeTrading212Match(byName[0], "name");

  return { security: null, matchedBy: null, held: false, eligible: false };
}

function finalizeTrading212Match(security, matchedBy) {
  const held = state.heldSecurityIds.has(security.id);
  return { security, matchedBy, held, eligible: held };
}

function t212StatusHTML(row) {
  if (row.eligible) return `<span class="t212-status-matched">${icon("checkCircle")} Matched</span>`;
  if (row.security) return `<span class="t212-status-notheld">${icon("lock")} Not held</span>`;
  return `<span class="t212-status-review">${icon("activity")} Needs review</span>`;
}

/** Invested/Result shown as small context under Value, per Vera's own
    distinction - Value is the actual valuation being recorded,
    Invested/Result are shown for context only and are never written
    anywhere (see the confirm handler below - only ELIGIBLE rows'
    .value ever reaches recordValuations()). */
function renderT212ReviewTable(rows) {
  const head = "<thead><tr><th>Trading 212</th><th>Matched Security</th><th>Value</th><th>Quantity</th><th>Status</th></tr></thead>";
  const body = rows.map((r) => {
    const context = [];
    if (r.invested != null) context.push(`invested ${fmtEUR(r.invested)}`);
    if (r.result != null) context.push(fmtEUR(r.result, { signed: true }));
    if (r.security && !r.held) context.push("add it through Transactions first");
    return `
      <tr>
        <td>${r.slice}</td>
        <td><span class="t212-review-security${r.security ? "" : " is-unmatched"}">${r.security ? r.security.name : r.name}</span></td>
        <td class="amount-cell">${fmtEUR(r.value)}${context.length ? `<div class="t212-review-context">${context.join(" · ")}</div>` : ""}</td>
        <td class="amount-cell">${r.units != null ? r.units.toFixed(4) : "—"}</td>
        <td>${t212StatusHTML(r)}</td>
      </tr>`;
  }).join("");
  $("t212-review-table").innerHTML = head + `<tbody>${body}</tbody>`;
}

function t212KeyHandler(e) { if (e.key === "Escape") window.closeT212Modal(); }

function resetT212Modal() {
  $("t212-step-review").hidden = true;
  $("t212-step-input").hidden = false;
  $("t212-file-input").value = "";
  $("t212-file-label").textContent = "Tap to choose your Trading 212 CSV export";
  $("t212-paste-textarea").value = "";
  $("t212-input-error").textContent = "";
  $("t212-review-error").textContent = "";
  state.t212PendingText = null;
  state.t212Rows = [];
}

function initT212Modal() {
  const root = $("t212-modal-root");
  const closeAll = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", t212KeyHandler);
    resetT212Modal();
  };
  $("t212-modal-backdrop").addEventListener("click", closeAll);
  $("t212-input-cancel").addEventListener("click", closeAll);
  window.closeT212Modal = closeAll;

  root.querySelectorAll("[data-t212-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-t212-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.t212Mode;
      $("t212-upload-panel").hidden = mode !== "upload";
      $("t212-paste-panel").hidden = mode !== "paste";
    });
  });

  $("t212-drop-zone").addEventListener("click", () => $("t212-file-input").click());
  $("t212-drop-zone").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("t212-file-input").click(); }
  });
  const takeFile = async (file) => {
    if (!file) return;
    $("t212-file-label").textContent = file.name;
    state.t212PendingText = await file.text();
  };
  $("t212-file-input").addEventListener("change", (e) => takeFile(e.target.files[0]));
  ["dragenter", "dragover"].forEach((evt) => $("t212-drop-zone").addEventListener(evt, (e) => { e.preventDefault(); $("t212-drop-zone").classList.add("drag-active"); }));
  ["dragleave", "drop"].forEach((evt) => $("t212-drop-zone").addEventListener(evt, (e) => { e.preventDefault(); $("t212-drop-zone").classList.remove("drag-active"); }));
  $("t212-drop-zone").addEventListener("drop", (e) => takeFile(e.dataTransfer.files[0]));

  $("t212-parse-btn").addEventListener("click", () => {
    const errorEl = $("t212-input-error");
    errorEl.textContent = "";
    const pasteMode = !$("t212-paste-panel").hidden;
    const text = pasteMode ? $("t212-paste-textarea").value : state.t212PendingText;
    if (!text || !text.trim()) {
      errorEl.textContent = pasteMode ? "Paste your CSV first." : "Choose a CSV file first.";
      return;
    }

    let parsedRows;
    try {
      parsedRows = parseTrading212Csv(text);
    } catch (err) {
      errorEl.textContent = err.message;
      return;
    }
    if (!parsedRows.length) { errorEl.textContent = "No holdings found in this CSV."; return; }

    state.t212Rows = parsedRows.map((row) => ({ ...row, ...matchTrading212Row(row, state.securities) }));

    $("t212-step-input").hidden = true;
    $("t212-step-review").hidden = false;
    $("t212-date").value = new Date().toISOString().slice(0, 10);
    renderT212ReviewTable(state.t212Rows);

    const eligibleCount = state.t212Rows.filter((r) => r.eligible).length;
    const notHeldCount = state.t212Rows.filter((r) => r.security && !r.held).length;
    const reviewCount = state.t212Rows.length - eligibleCount - notHeldCount;
    const parts = [`${eligibleCount} matched`];
    if (notHeldCount) parts.push(`${notHeldCount} recognised but not held`);
    if (reviewCount) parts.push(`${reviewCount} need${reviewCount === 1 ? "s" : ""} review`);
    $("t212-review-summary").textContent = notHeldCount || reviewCount
      ? `${parts.join(", ")} - only matched rows will be updated. Not-held products need Transactions -> Buy first.`
      : `${eligibleCount} matched.`;
  });

  $("t212-back-btn").addEventListener("click", () => {
    $("t212-step-review").hidden = true;
    $("t212-step-input").hidden = false;
  });

  $("t212-confirm-btn").addEventListener("click", async () => {
    const errorEl = $("t212-review-error");
    const submitBtn = $("t212-confirm-btn");
    errorEl.textContent = "";

    if (!currentUser()) { errorEl.textContent = "Sign in to save updates."; window.openAuthModal(); return; }

    const date = $("t212-date").value;
    if (!date) { errorEl.textContent = "Choose a valuation date."; return; }

    const matchedRows = state.t212Rows.filter((r) => r.eligible);
    if (!matchedRows.length) { errorEl.textContent = "No eligible rows to update - each must be an existing, currently-held security."; return; }

    submitBtn.disabled = true;
    try {
      await recordValuations(matchedRows.map((r) => ({
        portfolio_id: state.portfolioId,
        security_id: r.security.id,
        date,
        value_eur: r.value,
        units: r.units,
        source: "Trading 212 CSV",
      })));
      closeAll();
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  });
}

function openT212Modal() {
  resetT212Modal();
  $("t212-modal-root").classList.add("open");
  document.addEventListener("keydown", t212KeyHandler);
}

/* ---------- BPI Screenshot import (OCR) ----------
   Tesseract.js (loaded in data-hub.html) runs entirely client-side -
   WASM + a Web Worker, no server, no third party ever sees the
   screenshot. Matching reuses the same "existing security only, exact
   before fuzzy, ambiguous = no match" discipline as Trading 212's own
   matchTrading212Row() - deliberately a SEPARATE function rather than
   a shared one, since OCR text has no ticker/ISIN to key off at all
   (only a name, extracted from pixels, with real error potential) -
   merging the two would mean Trading 212's already-verified matcher
   inherits OCR-specific fuzziness it doesn't need and shouldn't have. */

const BPI_AMOUNT_RE = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:EUR|€)?/i;

/** A line that's ENTIRELY digits/%/>/whitespace/separators - a bare
    percentage, a lone chevron, nothing with an actual product name in
    it. Used below to skip past exactly this kind of line when walking
    backwards for a name, never mistaken for a real (if short) name. */
function isBpiJunkLine(text) {
  return !text || text.length < 3 || /^[\d%>\s.,]*$/.test(text);
}

/** BPINet's own table renders a product's name and value on the SAME
    line - "BPI DINAMICO ... 341,39 EUR" - so the straightforward same-
    line read works there. The BPI APP's card layout does NOT: a real
    screenshot (tested directly) OCR'd as "16% 341,39 EUR" (the
    category's own weight+value summary, no product name at all), then
    "BPI DINAMICO" on its own line, then ">" (a misread chevron), then
    "341,39 EUR" AGAIN on its own line for the individual product. The
    name and its value can be separated by junk lines in between, not
    guaranteed adjacent either.

    So: for a line whose amount has no usable name text before it (or
    only a bare "16%"-style prefix, itself stripped first), walk
    backwards up to 3 lines looking for the nearest real name line -
    skipping bare/junk lines (isBpiJunkLine above), stopping early if
    another amount line is hit first (that would mean pairing across
    two different products' values, never done). Relies on Tesseract's
    own line segmentation throughout, same "lean on the underlying
    engine's own layout analysis" approach js/importer/pdfReader.js
    already takes with pdf.js's word positions - just now walking a
    short window of lines instead of assuming same-line always holds. */
function extractBpiCandidates(lines) {
  const texts = lines.map((l) => (l.text || "").trim());
  const candidates = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const m = text.match(BPI_AMOUNT_RE);
    if (!m) continue;

    let name = text.slice(0, m.index).replace(/^\d{1,3}%\s*/, "").replace(/\s+/g, " ").trim();

    if (name.length < 3) {
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        if (BPI_AMOUNT_RE.test(texts[j])) break;
        if (!isBpiJunkLine(texts[j])) { name = texts[j]; break; }
      }
    }
    if (name.length < 3) continue;

    const value = parseEuNumber(m[1]);
    if (value == null) continue;
    candidates.push({ name, value });
  }
  return candidates;
}

/** Exact normalizeName() first (utils.js - the same fuzzy-name
    function every other import path in this app uses), then a
    CONTAINS fallback in either direction - OCR-specific tolerance a
    clean CSV export never needed, since a screenshot crops tighter
    and can pick up a stray leading/trailing character (an icon glyph
    misread, a chevron) a strict exact match would reject outright.
    Still requires exactly ONE candidate at each tier - an ambiguous
    contains-match (e.g. a short fragment matching several securities)
    is treated as no match, the same safety rule as everywhere else -
    never a guess, never an auto-created security. */
function matchBpiScreenshotCandidate(name, securities) {
  const norm = normalizeName(name);
  if (!norm) return { security: null, matchedBy: null, held: false, eligible: false };

  const byExactName = securities.filter((s) => normalizeName(s.name) === norm);
  if (byExactName.length === 1) return finalizeBpiMatch(byExactName[0], "name");

  const byContains = securities.filter((s) => {
    const sNorm = normalizeName(s.name);
    return sNorm.length >= 4 && (norm.includes(sNorm) || sNorm.includes(norm));
  });
  if (byContains.length === 1) return finalizeBpiMatch(byContains[0], "name-fuzzy");

  return { security: null, matchedBy: null, held: false, eligible: false };
}

function finalizeBpiMatch(security, matchedBy) {
  const held = state.heldSecurityIds.has(security.id);
  return { security, matchedBy, held, eligible: held };
}

const BPI_OCR_STATUS_LABELS = {
  "loading tesseract core": "Loading OCR engine…",
  "initializing tesseract": "Starting…",
  "loading language traineddata": "Loading Portuguese language data…",
  "initializing api": "Preparing…",
  "recognizing text": "Reading screenshot…",
};

/** The one place Tesseract's global is actually called. `lang: "por"`
    matches the real screenshots this was built against (Portuguese
    BPI app/BPINet UI). Returns line objects only (.text) - callers
    never touch word-level boxes/confidence, extractBpiCandidates()
    above works purely off Tesseract's own line text. */
async function runBpiScreenshotOcr(file) {
  const result = await Tesseract.recognize(file, "por", {
    logger: (m) => {
      if (typeof m.progress === "number") {
        $("bpi-progress-bar").style.width = `${Math.round(m.progress * 100)}%`;
      }
      $("bpi-progress-status").textContent = BPI_OCR_STATUS_LABELS[m.status] || m.status || "Working…";
    },
  });
  return result.data.lines || [];
}

/** Same review-table shape/status states as Trading 212
    (t212StatusHTML, .t212-review-* CSS) reused as-is - Value is the
    only figure this method has (no Quantity/Invested/Result, unlike a
    CSV export), so the table is a column narrower, nothing else
    differs. */
function renderBpiReviewTable(rows) {
  const head = "<thead><tr><th>Detected</th><th>Matched Security</th><th>Value</th><th>Status</th></tr></thead>";
  const body = rows.map((r) => `
      <tr>
        <td>${r.name}</td>
        <td><span class="t212-review-security">${r.security.name}</span></td>
        <td class="amount-cell">${fmtEUR(r.value)}${!r.held ? `<div class="t212-review-context">add it through Transactions first</div>` : ""}</td>
        <td>${t212StatusHTML(r)}</td>
      </tr>`).join("");
  $("bpi-review-table").innerHTML = head + `<tbody>${body}</tbody>`;
}

/** Shows exactly what OCR read before any name-matching - every line
    Tesseract produced, and which of those lines extractBpiCandidates()
    thought contained a euro amount. The toggle only appears when
    there's something worth showing (skipped entirely on a totally
    clean run where everything matched, so it doesn't clutter the
    common case). */
function renderBpiDebugPanel(debug) {
  const toggle = $("bpi-debug-toggle");
  const panel = $("bpi-debug-panel");
  if (!debug.lines.length) { toggle.hidden = true; panel.hidden = true; return; }

  toggle.hidden = false;
  panel.hidden = true;
  toggle.textContent = "Show detected text";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const candidateNames = new Set(debug.candidates.map((c) => c.name));
  panel.innerHTML = debug.lines.map((line) => {
    const trimmed = line.trim();
    const matchesCandidate = [...candidateNames].some((n) => trimmed.includes(n));
    return matchesCandidate ? `<div><b>${esc(trimmed)}</b></div>` : `<div>${esc(trimmed)}</div>`;
  }).join("") || "<div>(no text detected)</div>";
}

function bpiKeyHandler(e) { if (e.key === "Escape") window.closeBpiScreenshotModal(); }

function resetBpiScreenshotModal() {
  $("bpi-step-reading").hidden = true;
  $("bpi-step-review").hidden = true;
  $("bpi-step-input").hidden = false;
  $("bpi-file-input").value = "";
  $("bpi-input-error").textContent = "";
  $("bpi-review-error").textContent = "";
  $("bpi-progress-bar").style.width = "0%";
  $("bpi-progress-status").textContent = "Starting…";
  $("bpi-debug-toggle").hidden = true;
  $("bpi-debug-panel").hidden = true;
  state.bpiRows = [];
  state.bpiDebug = { lines: [], candidates: [] };
}

function initBpiScreenshotModal() {
  const root = $("bpi-modal-root");
  const closeAll = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", bpiKeyHandler);
    resetBpiScreenshotModal();
  };
  $("bpi-modal-backdrop").addEventListener("click", closeAll);
  $("bpi-input-cancel").addEventListener("click", closeAll);
  window.closeBpiScreenshotModal = closeAll;

  $("bpi-drop-zone").addEventListener("click", () => $("bpi-file-input").click());
  $("bpi-drop-zone").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("bpi-file-input").click(); }
  });

  const takeImage = async (file) => {
    if (!file) return;
    const errorEl = $("bpi-input-error");
    errorEl.textContent = "";
    if (!file.type.startsWith("image/")) {
      errorEl.textContent = "Choose an image file (screenshot), not a document.";
      return;
    }

    $("bpi-step-input").hidden = true;
    $("bpi-step-reading").hidden = false;
    $("bpi-progress-bar").style.width = "0%";
    $("bpi-progress-status").textContent = "Starting…";

    try {
      const lines = await runBpiScreenshotOcr(file);
      const candidates = extractBpiCandidates(lines);
      // Kept regardless of match outcome - a "found values, none
      // matched" result needs to be diagnosable (see the "Show
      // detected text" toggle below), not a dead end with no way to
      // tell whether OCR misread the name or the screenshot was the
      // wrong page entirely.
      state.bpiDebug = { lines: lines.map((l) => l.text), candidates };
      console.log("[BPI Screenshot OCR] raw lines:", state.bpiDebug.lines);
      console.log("[BPI Screenshot OCR] candidates:", candidates);

      // Silently drop anything that doesn't match a real security -
      // per Vera's own explicit rule for this method specifically
      // (Total Património, the deposit/current-account balance, and
      // any other non-investment line are never shown as "needs
      // review" clutter here, unlike Trading 212's CSV, which has no
      // such noise to filter in the first place).
      state.bpiRows = candidates
        .map((c) => ({ ...c, ...matchBpiScreenshotCandidate(c.name, state.securities) }))
        .filter((r) => r.security);

      $("bpi-step-reading").hidden = true;
      $("bpi-step-review").hidden = false;
      $("bpi-date").value = new Date().toISOString().slice(0, 10);
      renderBpiReviewTable(state.bpiRows);
      renderBpiDebugPanel(state.bpiDebug);

      const eligibleCount = state.bpiRows.filter((r) => r.eligible).length;
      const notHeldCount = state.bpiRows.length - eligibleCount;
      if (!candidates.length) {
        $("bpi-review-summary").textContent = "Couldn't find any euro amounts in this screenshot - make sure it's the Património screen.";
      } else if (!state.bpiRows.length) {
        $("bpi-review-summary").textContent = "Found values, but none matched a security in your portfolio.";
      } else if (notHeldCount) {
        $("bpi-review-summary").textContent = `${eligibleCount} matched, ${notHeldCount} recognised but not held - only matched rows will be updated. Not-held products need Transactions -> Buy first.`;
      } else {
        $("bpi-review-summary").textContent = `${eligibleCount} matched.`;
      }
    } catch (err) {
      $("bpi-step-reading").hidden = true;
      $("bpi-step-input").hidden = false;
      errorEl.textContent = `Couldn't read this screenshot: ${err.message || "unknown error"}.`;
    }
  };
  $("bpi-file-input").addEventListener("change", (e) => takeImage(e.target.files[0]));
  ["dragenter", "dragover"].forEach((evt) => $("bpi-drop-zone").addEventListener(evt, (e) => { e.preventDefault(); $("bpi-drop-zone").classList.add("drag-active"); }));
  ["dragleave", "drop"].forEach((evt) => $("bpi-drop-zone").addEventListener(evt, (e) => { e.preventDefault(); $("bpi-drop-zone").classList.remove("drag-active"); }));
  $("bpi-drop-zone").addEventListener("drop", (e) => takeImage(e.dataTransfer.files[0]));

  $("bpi-back-btn").addEventListener("click", () => {
    $("bpi-step-review").hidden = true;
    $("bpi-step-input").hidden = false;
  });

  $("bpi-debug-toggle").addEventListener("click", () => {
    const panel = $("bpi-debug-panel");
    const nowHidden = !panel.hidden;
    panel.hidden = nowHidden;
    $("bpi-debug-toggle").textContent = nowHidden ? "Show detected text" : "Hide detected text";
  });

  $("bpi-confirm-btn").addEventListener("click", async () => {
    const errorEl = $("bpi-review-error");
    const submitBtn = $("bpi-confirm-btn");
    errorEl.textContent = "";

    if (!currentUser()) { errorEl.textContent = "Sign in to save updates."; window.openAuthModal(); return; }

    const date = $("bpi-date").value;
    if (!date) { errorEl.textContent = "Choose a valuation date."; return; }

    const eligibleRows = state.bpiRows.filter((r) => r.eligible);
    if (!eligibleRows.length) { errorEl.textContent = "No eligible rows to update."; return; }

    submitBtn.disabled = true;
    try {
      await recordValuations(eligibleRows.map((r) => ({
        portfolio_id: state.portfolioId,
        security_id: r.security.id,
        date,
        value_eur: r.value,
        units: null,
        source: "BPI Screenshot",
      })));
      closeAll();
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  });
}

function openBpiScreenshotModal() {
  resetBpiScreenshotModal();
  $("bpi-modal-root").classList.add("open");
  document.addEventListener("keydown", bpiKeyHandler);
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Data Hub",
    subtitle: "Every piece of data enters Portfol.io through here.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  renderSourceChips();
  initDropZone();

  initUpdatePortfolioMethods();
  initManualUpdateModal();
  initT212Modal();
  initBpiScreenshotModal();

  onAuthChange(() => loadDbContext().then(renderGroups));
  initAuth().then(loadDbContext);
}

document.addEventListener("DOMContentLoaded", init);
