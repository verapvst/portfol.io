/* ============================================================
   products.js - the Securities page ("what could I invest in?").
   Supabase-only (security_details + securities, via db.js's
   loadProductLibrary()) - no mock/Showcase fallback for this domain yet,
   see products.html's own comment and supabase/migrations/
   0005_product_database.sql's RLS note for why. Real data only: every
   number here was transcribed verbatim from the old Portfol.io app's
   Excel-derived database (supabase/migrations/0006_seed_products_and_
   brokers.sql), nothing estimated for display purposes.
   ============================================================ */

function $(id) { return document.getElementById(id); }

let productsCache = [];
let heldSecurityIds = new Set();
let currentTypeFilter = "";
let currentHeldFilter = ""; // "" | "held" | "not-held"
let currentProviderFilter = "";
let currentSearch = "";

const PRODUCT_TYPES = ["Fund", "ETF", "PPR", "Insurance"];

/* ---------- Rendering helpers ---------- */

function starsHTML(stars) {
  if (stars == null) return "—";
  const full = "★".repeat(stars);
  const empty = "☆".repeat(5 - stars);
  return `<span class="product-stars" title="${stars} / 5">${full}${empty}</span>`;
}

function qualityBadgeHTML(quality) {
  if (!quality) return "";
  const tone = quality === "Real" ? "real" : quality === "Partial" ? "partial" : "estimated";
  return `<span class="quality-badge quality-${tone}">${quality}</span>`;
}

function fmtPctOrDash(n, digits = 2) {
  return n == null ? "—" : `${Number(n).toFixed(digits)}%`;
}

function productRowHTML(p) {
  const s = p.securities;
  const held = heldSecurityIds.has(s.id);
  return `
    <tr data-product-id="${s.id}" tabindex="0" role="button" aria-label="${s.name} details">
      <td>
        <p class="asset-name">${s.name}${held ? '<span class="held-badge">Held</span>' : ""}</p>
        <p class="asset-ticker">${s.institutions ? s.institutions.name : "—"} · ${s.type}</p>
      </td>
      <td>${fmtPctOrDash(p.ter_pct)}</td>
      <td>${fmtPctOrDash(p.return_1y_pct)}</td>
      <td>${starsHTML(p.star_rating)}</td>
      <td>${qualityBadgeHTML(p.data_quality)}</td>
    </tr>`;
}

function renderProducts(container) {
  const q = currentSearch.trim().toLowerCase();
  const rows = productsCache.filter((p) => {
    const s = p.securities;
    if (currentTypeFilter && s.type !== currentTypeFilter) return false;
    const held = heldSecurityIds.has(s.id);
    if (currentHeldFilter === "held" && !held) return false;
    if (currentHeldFilter === "not-held" && held) return false;
    if (currentProviderFilter && (!s.institutions || s.institutions.name !== currentProviderFilter)) return false;
    if (q && !s.name.toLowerCase().includes(q) && !(s.institutions && s.institutions.name.toLowerCase().includes(q))) return false;
    return true;
  });

  if (!rows.length) {
    container.innerHTML = `<p class="product-library-empty">No products match this search.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-scroll">
      <table class="holdings-table product-table">
        <thead>
          <tr><th>Product</th><th>TER</th><th>1Y Return</th><th>Rating</th><th>Data</th></tr>
        </thead>
        <tbody>${rows.map(productRowHTML).join("")}</tbody>
      </table>
    </div>`;

  container.querySelectorAll("tr[data-product-id]").forEach((row) => {
    const go = () => { window.location.href = `product-detail.html?id=${row.dataset.productId}`; };
    row.addEventListener("click", go);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

function renderTypeTabs(tabsEl) {
  const types = ["", ...PRODUCT_TYPES];
  const labels = { "": "All" };
  tabsEl.innerHTML = types
    .map((t, i) => `<button class="tab-btn${t === currentTypeFilter ? " active" : ""}" data-type="${t}" role="tab" aria-selected="${t === currentTypeFilter}">${labels[t] || t}</button>`)
    .join("");
  tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTypeFilter = btn.dataset.type;
      tabsEl.querySelectorAll(".tab-btn").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      renderProducts($("product-library-body"));
    });
  });
}

/** "Held / Not Held" - the key requirement this filter pass exists for
    (Vera: "I should immediately be able to see which securities I
    actually hold"). heldSecurityIds comes from a real Transactions
    query, never inferred from the product catalogue itself - a
    researched-but-never-bought product must never read as "held". */
function renderHeldTabs(tabsEl) {
  const options = [["", "All"], ["held", "Held"], ["not-held", "Not Held"]];
  tabsEl.innerHTML = options
    .map(([v, label]) => `<button class="tab-btn${v === currentHeldFilter ? " active" : ""}" data-held="${v}" role="tab" aria-selected="${v === currentHeldFilter}">${label}</button>`)
    .join("");
  tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentHeldFilter = btn.dataset.held;
      tabsEl.querySelectorAll(".tab-btn").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      renderProducts($("product-library-body"));
    });
  });
}

/** Provider = the security's own issuer/institution (securities.
    institutions - already real, already joined by loadProductLibrary(),
    the same fact already shown in each row's subtitle). Not a new
    category - just exposing an existing field as a filter. Built from
    whichever institutions are actually present in the loaded catalogue,
    not a hardcoded list, so it never drifts from the real data. Exchange
    was considered too (per the brief) but skipped: it isn't its own
    field anywhere in the schema today (data_provider_symbol embeds it as
    a suffix, e.g. "UETW.XETRA", not a clean queryable column) - adding
    an Exchange filter now would mean inventing a category the taxonomy
    doesn't actually have yet. */
function renderProviderFilter(selectEl) {
  const providers = [...new Set(
    productsCache.map((p) => p.securities.institutions && p.securities.institutions.name).filter(Boolean)
  )].sort();
  selectEl.innerHTML = `<option value="">All providers</option>` +
    providers.map((name) => `<option value="${name}"${name === currentProviderFilter ? " selected" : ""}>${name}</option>`).join("");
  selectEl.addEventListener("change", (e) => {
    currentProviderFilter = e.target.value;
    renderProducts($("product-library-body"));
  });
}

function renderSummary() {
  const n = productsCache.length;
  $("product-library-summary").textContent = `${n} product${n === 1 ? "" : "s"} on file - funds, ETFs, PPRs and unit-linked insurance, real and researched.`;
}

/* ---------- Page init ---------- */

function renderSignedOutState() {
  $("product-library-body").innerHTML = `
    <div class="costs-signin-note">
      Sign in to browse the Securities.
      <br/>
      <button type="button" id="product-library-signin-cta">Sign In</button>
    </div>`;
  $("product-library-signin-cta").addEventListener("click", () => window.openAuthModal());
  $("product-search").disabled = true;
  $("product-provider-filter").disabled = true;
}

async function loadProductLibraryPage() {
  const body = $("product-library-body");
  const user = currentUser();

  if (!window.db) {
    body.innerHTML = `<p class="costs-error">Supabase isn't configured yet (js/supabaseConfig.js).</p>`;
    return;
  }

  if (!user) {
    renderSignedOutState();
    $("product-library-summary").textContent = "Sign in to see research on real products.";
    return;
  }

  $("product-search").disabled = false;
  body.innerHTML = `<p class="costs-empty">Loading…</p>`;

  try {
    const portfolioId = await ensurePortfolio();
    const [products, transactions] = await Promise.all([
      loadProductLibrary(),
      window.db.from("transactions").select("security_id").eq("portfolio_id", portfolioId),
    ]);
    productsCache = products;
    heldSecurityIds = new Set((transactions.data || []).map((t) => t.security_id).filter(Boolean));

    renderSummary();
    renderProviderFilter($("product-provider-filter"));
    renderProducts(body);
  } catch (err) {
    const missingTable = /relation .*security_details.* does not exist/i.test(err.message || "");
    body.innerHTML = `<p class="costs-error">${
      missingTable
        ? "The product database doesn't exist yet — run supabase/migrations/0005_product_database.sql and 0006_seed_products_and_brokers.sql in the Supabase SQL Editor first."
        : (err.message || "Failed to load the Securities.")
    }</p>`;
  }
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  renderTopbar($("topbar"), user, {
    heading: "Securities",
    subtitle: "Research every fund, ETF, PPR and insurance product on file — real terms, real numbers.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  renderTypeTabs($("product-type-tabs"));
  renderHeldTabs($("product-held-tabs"));
  $("product-search").addEventListener("input", (e) => {
    currentSearch = e.target.value;
    renderProducts($("product-library-body"));
  });

  onAuthChange(() => loadProductLibraryPage());
  initAuth().then(loadProductLibraryPage);
}

document.addEventListener("DOMContentLoaded", init);
