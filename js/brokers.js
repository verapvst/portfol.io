/* ============================================================
   brokers.js - Broker Comparison ("where should I hold my
   investments?"). Supabase-only (brokers table, via db.js's
   loadBrokers()) - same authenticated-only simplification as
   Securities, no mock fallback for this domain yet. Real data only:
   every figure here was transcribed verbatim from the old Portfol.io
   app's Excel-derived database (supabase/migrations/
   0006_seed_products_and_brokers.sql).
   ============================================================ */

function $(id) { return document.getElementById(id); }

let brokersCache = [];
let currentSearch = "";

/* ---------- Formatting ---------- */

function fmtPctOrFree(n) {
  if (n == null) return "—";
  return n === 0 ? "Free" : `${Number(n).toFixed(2)}%`;
}
function fmtMoneyOrFree(n) {
  if (n == null) return "—";
  return n === 0 ? "Free" : `€${Number(n).toFixed(2)}`;
}
function fmtScore(n) {
  return n == null ? "—" : `${n}/10`;
}
function scoreTone(n) {
  if (n == null) return "";
  return n >= 8 ? "up" : n >= 5 ? "warn" : "down";
}
function yesNo(b) {
  return b == null ? "—" : (b ? "Yes" : "No");
}
const CURRENCY_SYMBOLS = { EUR: "€", USD: "$", GBP: "£" };
function fmtProtection(amount, currency) {
  if (amount == null) return "—";
  const symbol = CURRENCY_SYMBOLS[currency] || (currency ? `${currency} ` : "€");
  return `${symbol}${Math.round(amount).toLocaleString("en-IE")}`;
}

/* ---------- List table ---------- */

function brokerRowHTML(b) {
  return `
    <tr data-broker-id="${b.id}" tabindex="0" role="button" aria-label="${b.name} details">
      <td>
        <p class="asset-name">${b.name}</p>
        <p class="asset-ticker">${b.country || "—"}${b.regulator ? ` · ${b.regulator}` : ""}</p>
      </td>
      <td>${fmtPctOrFree(b.etf_commission)}</td>
      <td>${fmtPctOrFree(b.fx_fee_pct)}</td>
      <td>${b.interest_on_cash_pct != null ? `${b.interest_on_cash_pct.toFixed(1)}%` : "—"}</td>
      <td><span class="score-badge score-${scoreTone(b.cost_score)}">${fmtScore(b.cost_score)}</span></td>
      <td><span class="score-badge score-${scoreTone(b.safety_score)}">${fmtScore(b.safety_score)}</span></td>
    </tr>`;
}

function renderBrokers(container) {
  const q = currentSearch.trim().toLowerCase();
  const rows = brokersCache.filter((b) => {
    if (!q) return true;
    return b.name.toLowerCase().includes(q) || (b.country && b.country.toLowerCase().includes(q));
  });

  if (!rows.length) {
    container.innerHTML = `<p class="product-library-empty">No brokers match this search.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-scroll">
      <table class="holdings-table product-table broker-table">
        <thead>
          <tr><th>Broker</th><th>ETF Commission</th><th>FX Fee</th><th>Interest on Cash</th><th>Cost</th><th>Safety</th></tr>
        </thead>
        <tbody>${rows.map(brokerRowHTML).join("")}</tbody>
      </table>
    </div>`;

  container.querySelectorAll("tr[data-broker-id]").forEach((row) => {
    const open = () => openBrokerDrawer(row.dataset.brokerId);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}

/* ---------- Detail drawer ----------
   Reuses shell.js's generic drawer shell (initDrawer()/window.openDrawer)
   directly with a page-local payload - not routed through drillDown()'s
   type/id switch, since that's built around currentPortfolioData and
   brokers are an entirely separate domain. Proportionate to a 10-row
   dataset: a drawer, not a second page like Securities got. */

function scoreRowsHTML(b) {
  const dims = [
    ["Cost", b.cost_score], ["Safety", b.safety_score], ["Beginner-friendliness", b.beginner_score],
    ["Advanced features", b.advanced_score], ["Tax simplicity", b.tax_simplicity_score], ["UX", b.ux_score],
  ];
  return dims.map(([label, v]) => `
    <div class="bar-row">
      <div class="bar-row-label">
        <span class="bar-row-name">${label}</span>
        <span class="bar-row-value score-${scoreTone(v)}">${fmtScore(v)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill score-fill-${scoreTone(v)}" style="width:${v != null ? v * 10 : 0}%"></div></div>
    </div>`).join("");
}

function listHTML(title, items, cls) {
  if (!items || !items.length) return "";
  return `<p class="broker-list-title">${title}</p><ul class="broker-list ${cls}">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

function openBrokerDrawer(id) {
  const b = brokersCache.find((x) => x.id === id);
  if (!b) return;

  const facts = [
    ["Country", b.country], ["Regulator", b.regulator], ["Founded", b.founded_year],
    ["Publicly listed", yesNo(b.publicly_listed)], ["Custodian", b.custodian],
    ["Investor protection", fmtProtection(b.protection_amount, b.protection_currency)],
    ["ETF commission", fmtPctOrFree(b.etf_commission)], ["Stock commission", fmtPctOrFree(b.stock_commission)],
    ["FX fee", fmtPctOrFree(b.fx_fee_pct)], ["Custody fee", fmtPctOrFree(b.custody_fee_pct)],
    ["Inactivity fee", fmtMoneyOrFree(b.inactivity_fee)], ["Withdrawal fee", fmtMoneyOrFree(b.withdrawal_fee)],
    ["Interest on cash", b.interest_on_cash_pct != null ? `${b.interest_on_cash_pct.toFixed(1)}%` : "—"],
    ["Fractional ETFs", yesNo(b.fractional_etfs)], ["Fractional stocks", yesNo(b.fractional_stocks)],
    ["Automated investing", yesNo(b.auto_investing)], ["Tax report provided", yesNo(b.tax_report_provided)],
  ];

  const bodyHTML = `
    ${b.description ? `<p class="broker-description">${b.description}</p>` : ""}
    <div class="drawer-rows">${facts.map(([label, value]) => rowHTML(label, value ?? "—")).join("")}</div>
    <p class="pd-subsection-label pd-subsection-label-spaced">Scores</p>
    ${scoreRowsHTML(b)}
    ${listHTML("Pros", b.pros, "broker-list-pros")}
    ${listHTML("Cons", b.cons, "broker-list-cons")}
    ${b.website ? `<p class="broker-website"><a href="https://${b.website}" target="_blank" rel="noopener noreferrer">${b.website}</a></p>` : ""}
    ${lastUpdatedHTML(b.updated_at, { label: "updated" })}
  `;

  window.openDrawer({ icon: "landmark", title: b.name, subtitle: b.country || "", bodyHTML });
}

/* ---------- Page init ---------- */

function renderSummary() {
  const n = brokersCache.length;
  $("brokers-summary").textContent = `${n} broker${n === 1 ? "" : "s"} on file - real costs, protection, and scores, not a recommendation.`;
}

function renderSignedOutState() {
  $("brokers-body").innerHTML = `
    <div class="costs-signin-note">
      Sign in to browse Broker Comparison.
      <br/>
      <button type="button" id="brokers-signin-cta">Sign In</button>
    </div>`;
  $("brokers-signin-cta").addEventListener("click", () => window.openAuthModal());
  $("broker-search").disabled = true;
}

async function loadBrokersPage() {
  const body = $("brokers-body");
  const user = currentUser();

  if (!window.db) {
    body.innerHTML = `<p class="costs-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    return;
  }
  if (!user) {
    renderSignedOutState();
    $("brokers-summary").textContent = "Sign in to see broker research.";
    return;
  }

  $("broker-search").disabled = false;
  body.innerHTML = `<p class="costs-empty">Loading…</p>`;

  try {
    brokersCache = await loadBrokers();
    renderSummary();
    renderBrokers(body);
  } catch (err) {
    const missingTable = /relation .*brokers.* does not exist/i.test(err.message || "");
    body.innerHTML = `<p class="costs-error">${
      missingTable
        ? "The brokers table doesn't exist yet — run supabase/migrations/0005_product_database.sql and 0006_seed_products_and_brokers.sql in the Supabase SQL Editor first."
        : (err.message || "Failed to load Broker Comparison.")
    }</p>`;
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Broker Comparison",
    subtitle: "Real costs, protection and platform quality — not a recommendation.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  $("broker-search").addEventListener("input", (e) => {
    currentSearch = e.target.value;
    renderBrokers($("brokers-body"));
  });

  onAuthChange(() => loadBrokersPage());
  initAuth().then(loadBrokersPage);
}

document.addEventListener("DOMContentLoaded", init);
