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
    return;
  }
  state.portfolioId = await ensurePortfolio();
  state.securities = await loadSecurities();
  state.accounts = await loadAccountsForPortfolio(state.portfolioId);
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
  if (!group.fichaMensal) return "";

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
      <button class="load-db-btn" type="button" data-load-db="${groupKey}">Load Costs to Database</button>
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
    const fm = group.fichaMensal;
    const date = fm.fund.reference_date.value;
    if (!date) throw new Error("This report has no reference date - can't record dated costs without one.");

    let securityId = securitySelect.value;
    if (!securityId) {
      securityId = await findOrCreateSecurity({ name: group.fundName, type: "Fund", currency: "EUR" }, state.securities);
    }

    const rows = costRowsFromFichaMensal(fm, securityId, accountSelect.value, date);
    if (!rows.length) throw new Error("No fee fields were extracted from this report - nothing to load.");

    rows.forEach((r) => { r.portfolio_id = state.portfolioId; });
    const { error } = await window.db.from("costs").insert(rows);
    if (error) throw error;

    statusEl.className = "load-db-status is-success";
    statusEl.textContent = `${rows.length} cost row(s) loaded ✓`;
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

  onAuthChange(() => loadDbContext().then(renderGroups));
  initAuth().then(loadDbContext);
}

document.addEventListener("DOMContentLoaded", init);
