/* ============================================================
   shell.js - merged: everything that is the app's persistent chrome
   and interaction plumbing, not dashboard content itself.
   Owner Access (the public/owner access mode), NavigationController
   (LogoButton/Backdrop/Drawer), Topbar, the generic drill-down overlay,
   the info popover, and the click router that ties data-drill-type
   targets to drawer content.
   ============================================================ */

/* ---------- Owner Access -> retired, collapsed into real auth ----------
   This used to be an independent client-side password toggle - its own
   comment used to say plainly it wasn't real access control. Reviewing
   the navigation shell against docs/information-architecture.md §1
   ("one application, not three products stapled together") surfaced a
   real inconsistency: Owner Access and Supabase sign-in were two
   INDEPENDENT flags - you could be signed in with money still masked, or
   signed out with the old password unlocking mock data. The IA doc
   describes exactly one Showcase<->Private continuum. Fixed by deleting
   the password/modal/button entirely and making isOwnerMode() derive
   straight from real auth state - every existing formatMoney()/
   isOwnerMode() call site (KPIs, holdings rows, drill-downs) is
   unchanged; only what backs the answer changed. */

const MONEY_MASK = "······";
const VALUES_VISIBLE_KEY = "portfolio_io_values_visible";

/** Layer 3 (docs/production-architecture.md's three-mode model, extended):
    a real UI privacy toggle *within* an authenticated session, independent
    of sign-in state itself. Signing in already grants real read/write
    access (Layer 2) - this only controls whether money renders on screen
    right now, for the "showing someone Portfol.io in person while signed
    in" case. Defaults to visible (true) the first time you're ever signed
    in, since that's the common case; explicit choices persist across
    reloads via localStorage (there is exactly one real user of this app,
    so a shared browser-level flag is the right scope - it isn't meant to
    survive a sign-out/sign-in as a different person, which this app
    doesn't support anyway). This is NOT a second authentication layer, by
    design - it's a display preference, and every table it protects is
    still fully RLS-gated on the real Supabase session regardless of this
    flag's value. */
function valuesVisible() {
  const stored = localStorage.getItem(VALUES_VISIBLE_KEY);
  return stored === null ? true : stored === "true";
}

/** Reloads on purpose rather than trying to re-render every open page's
    money-showing sections in place - this app has no shared reactivity
    system, and a privacy toggle is an occasional, deliberate action, not
    a hot path worth the per-page wiring a live re-render would need. */
function setValuesVisible(visible) {
  localStorage.setItem(VALUES_VISIBLE_KEY, visible ? "true" : "false");
  window.location.reload();
}

/** Showcase (signed out) always masks money. Signed in, money shows
    UNLESS valuesVisible() has been explicitly toggled off (Layer 3) - the
    real mechanism now, not a separate toggle for the signed-out case, but
    a genuine independent layer on top of it for the signed-in case. No
    separate onOwnerModeChange listener exists - every page already
    re-renders on onAuthChange (auth.js) for its data, and a values-
    visibility change reloads the page outright (see setValuesVisible). */
function isOwnerMode() {
  return !!currentUser() && valuesVisible();
}

/** The one place every absolute money value in the app should be
    formatted through. Showcase masks it; Private is a plain fmtEUR
    passthrough - same signature, so call sites don't change shape
    between the two. The mask is wrapped in its own span so it can be
    styled lighter/smaller than whatever context it's dropped into (a
    KPI's big headline number vs. a small table cell) - see .money-mask
    in components.css. Callers that assign via .textContent (not
    .innerHTML) need to switch to .innerHTML to render this correctly
    instead of the tag as literal text. */
function formatMoney(value, opts) {
  return isOwnerMode() ? fmtEUR(value, opts) : `<span class="money-mask">${MONEY_MASK}</span>`;
}

/** The topbar toggle itself - only rendered when actually signed in
    (a signed-out Showcase visitor already sees masked money via
    isOwnerMode() above; showing them a toggle that does nothing useful
    would be confusing, not helpful). Called again on every auth change
    (initAuthButton wires that up) since sign-in/out changes whether this
    should exist at all - clears the slot first each time so that never
    stacks duplicate buttons. */
function initValuesToggle(container) {
  if (!container) return;
  container.innerHTML = "";
  if (!currentUser()) return;

  const btn = document.createElement("button");
  btn.id = "values-toggle-btn";
  btn.className = "icon-btn glass-quiet";
  const visible = valuesVisible();
  btn.innerHTML = icon(visible ? "eye" : "eyeOff");
  btn.setAttribute("aria-label", visible ? "Hide values" : "Show values");
  btn.title = visible ? "Hide values" : "Show values";
  btn.addEventListener("click", () => setValuesVisible(!valuesVisible()));
  container.appendChild(btn);
}

/** Rebases a value series to the first point = 100, preserving the
    curve's shape while discarding the absolute scale - used for charts
    in Showcase mode, where the number that matters is "how has it
    evolved", not "how much". Never used to decide whether to render
    the chart, only what scale to render it at (see charts.js /
    initPerformanceCard - the chart itself never disappears). */
function indexValueSeries(series) {
  const base = series[0]?.value || 1;
  // Carries `real` through the rebase - Showcase mode needs the same
  // interpolated-vs-observed distinction on the chart as Private mode,
  // not just a rescaled line with the honesty flag silently dropped.
  return series.map((p) => ({ date: p.date, value: (p.value / base) * 100, real: p.real }));
}

/* ---------- Navigation: overlay drawer, every breakpoint ----------
   One DOM structure, one behaviour, at every width: #nav-drawer is
   always position:fixed (css/components.css), floating above a dimmed/
   blurred backdrop, never part of #app's layout - opening it never
   pushes or resizes page content, at 375px or 1440px alike. Only the
   drawer's own size/inset varies per breakpoint (see components.css's
   nav media queries) - never the interaction model itself. The trigger
   button lives inside the sticky topbar's own markup (renderTopbar()
   below), not as an independent floating element.

   Grouped per docs/information-architecture.md §2 (Portfolio.io repo) -
   five groups, not a flat list. Portfolio and Research are Showcase-safe
   (shown to everyone); Investments/Operations/Administration are gated
   on being signed in. That's a deliberate simplification: the doc's real
   target is gating Operations/Administration on Edit Mode specifically
   (a time-boxed elevation, not just "signed in") - edit_sessions doesn't
   exist as working code yet, so for now "signed in" is the closest
   honest approximation, not a forgotten distinction. Tighten this the
   same day edit_sessions ships. */

/**
 * href is the real page for pages that exist; everything else stays a
 * "#" placeholder until it's actually built - a dead link reads honestly
 * as "not built yet", a fake href would silently 404.
 */
const NAV_GROUPS = [
  {
    group: "Portfolio",
    items: [
      { label: "Overview", icon: "home", href: "index.html" },
      { label: "Portfolio Detail", icon: "pieChart", href: "portfolio-detail.html" },
      { label: "Performance", icon: "trendingUp", href: "performance.html" },
      { label: "Allocation", icon: "pieChart", href: "allocation.html" },
      { label: "Risk", icon: "activity", href: "#" },
    ],
  },
  {
    group: "Investments",
    private: true,
    items: [
      { label: "Accounts", icon: "landmark", href: "accounts.html" },
      { label: "Transactions", icon: "receipt", href: "transactions.html" },
      { label: "Valuations", icon: "activity", href: "valuations.html" },
      { label: "Costs", icon: "wallet", href: "costs.html" },
    ],
  },
  {
    group: "Research",
    items: [
      { label: "Securities", icon: "pieChart", href: "products.html" },
      { label: "Broker Comparison", icon: "landmark", href: "brokers.html" },
      { label: "Benchmarks", icon: "barChart3", href: "#" },
      { label: "Market Data", icon: "trendingUp", href: "#" },
      { label: "Simulator", icon: "sparkles", href: "#" },
    ],
  },
  {
    group: "Operations",
    private: true,
    editOnly: true,
    items: [{ label: "Data Hub", icon: "upload", href: "data-hub.html" }],
  },
  {
    group: "Administration",
    private: true,
    editOnly: true,
    items: [{ label: "Settings", icon: "settings", href: "#" }],
  },
];

/** Active state is which page is actually loaded, not a hardcoded flag -
    otherwise every page but Overview would light up the wrong item. */
function currentPageFile() {
  const path = window.location.pathname;
  return path.slice(path.lastIndexOf("/") + 1) || "index.html";
}

function navItemHTML(item) {
  const active = item.href !== "#" && item.href === currentPageFile();
  return `
    <a class="nav-item${active ? " active" : ""}" href="${item.href}">
      <span class="nav-icon">${icon(item.icon)}</span>
      <span>${item.label}</span>
      ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ""}
    </a>`;
}

/** editOnly groups (Operations/Administration) are shown to any signed-in
    user today, not gated on real Edit Mode - edit_sessions doesn't exist
    as working code yet (docs/information-architecture.md §2 specifies
    Edit-only for these two). The "· Edit" tag makes that gap visible in
    the UI itself rather than hiding a known simplification silently -
    remove the tag the same day edit_sessions ships and this becomes the
    real thing it's currently standing in for. */
function navGroupHTML(group) {
  if (group.private && !currentUser()) return "";
  const tag = group.editOnly ? ` <span class="nav-group-tag">· Edit</span>` : "";
  return `
    <div class="nav-group-label">${group.group}${tag}</div>
    ${group.items.map(navItemHTML).join("")}`;
}

function renderNavGroups(navEl) {
  navEl.innerHTML = NAV_GROUPS.map(navGroupHTML).join("");
  navEl.querySelectorAll(".nav-item").forEach((el) => el.addEventListener("click", () => close()));
}

let closeNavDrawer = () => {};
function close() { closeNavDrawer(); }

/** Requires renderTopbar() to already have run - it renders #nav-logo-btn
    as part of its own markup now (see that function). Every page's
    init() calls renderTopbar() before initNavigation() for exactly this
    reason. */
function initNavigation(user) {
  const logoBtn = document.getElementById("nav-logo-btn");

  const backdrop = document.createElement("div");
  backdrop.id = "nav-backdrop";

  const drawer = document.createElement("aside");
  drawer.id = "nav-drawer";
  drawer.className = "glass";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-label", "Navigation");
  drawer.innerHTML = `
    <button class="nav-drawer-logo" type="button" aria-label="Close menu">
      <img src="assets/images/logo-wordmark.png" alt="Portfol.io — Fund your future">
    </button>

    <div class="sb-profile glass-quiet">
      <span class="sb-avatar">${user.initial}</span>
      <div class="min-w-0">
        <p class="sb-name truncate">${user.name}</p>
        <p class="sb-role truncate">${user.role}</p>
      </div>
    </div>

    <nav class="sb-nav" id="sb-nav"></nav>`;

  // Always position:fixed (components.css) - appended to body, not
  // #app, since the drawer never participates in page layout at any
  // breakpoint anymore (see this section's header comment).
  document.body.append(backdrop, drawer);

  renderNavGroups(drawer.querySelector("#sb-nav"));
  onAuthChange(() => renderNavGroups(drawer.querySelector("#sb-nav")));

  const isOpen = () => document.body.classList.contains("nav-open");

  const open = () => {
    document.body.classList.add("nav-open");
    logoBtn.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKey);
  };

  closeNavDrawer = () => {
    document.body.classList.remove("nav-open");
    logoBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKey);
  };

  const toggle = () => (isOpen() ? closeNavDrawer() : open());
  const onKey = (e) => { if (e.key === "Escape") closeNavDrawer(); };

  logoBtn.addEventListener("click", toggle);
  backdrop.addEventListener("click", closeNavDrawer);
  drawer.querySelector(".nav-drawer-logo").addEventListener("click", closeNavDrawer);
}

/* ---------- Topbar ---------- */

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** The menu-trigger button lives here now, not as its own independent
    fixed element (see initNavigation() in this file) - it's part of the
    sticky topbar's permanent chrome, so it belongs in the topbar's own
    markup. initNavigation() finds it by id and wires its click handler;
    it doesn't create it - that's why renderTopbar() has to run before
    initNavigation() in every page's init(), not after (this was the
    other way around before this pass). */
function renderTopbar(container, user, { heading = "Portfolio Overview", subtitle = "Track, analyze and grow your wealth." } = {}) {
  container.innerHTML = `
    <div class="topbar-heading-group">
      <button id="nav-logo-btn" class="nav-logo-btn" type="button" aria-label="Open menu" aria-expanded="false">
        <img src="assets/images/logo-icon.png" alt="Portfol.io">
      </button>
      <div class="topbar-heading">
        <p class="greeting">${timeGreeting()}, ${user.greetingName}</p>
        <h1>${heading}</h1>
        <p>${subtitle}</p>
      </div>
    </div>
    <div class="topbar-actions">
      <div class="search-box glass-quiet">${icon("search")}<span>Search anything…</span><kbd>⌘K</kbd></div>
      <div id="values-toggle-slot"></div>
      <div id="auth-slot"></div>
      <button class="icon-btn glass-quiet" aria-label="Notifications">${icon("bell")}</button>
    </div>`;
}

/* ---------- Drill-down drawer ----------
   Generic slide-in drawer shell - the one piece of UI every future detail
   page (Product Profile, Region Breakdown, Performance Page, ...) will
   render into. This only knows how to open/close/populate a panel; it
   has no opinion about what goes inside. See drillDown() below for the
   target -> content mapping. */

function initDrawer() {
  if (document.getElementById("drawer-root")) return;

  const root = document.createElement("div");
  root.id = "drawer-root";
  root.innerHTML = `
    <div id="drawer-backdrop"></div>
    <aside id="drawer-panel" class="glass" role="dialog" aria-modal="true">
      <button id="drawer-close" class="icon-btn glass-quiet" aria-label="Close">${icon("close")}</button>
      <div id="drawer-body"></div>
    </aside>`;
  document.body.appendChild(root);

  const close = () => {
    root.classList.remove("open");
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  root.querySelector("#drawer-backdrop").addEventListener("click", close);
  root.querySelector("#drawer-close").addEventListener("click", close);
  window.closeDrawer = close;

  window.openDrawer = ({ icon: iconName, title, subtitle, bodyHTML }) => {
    root.querySelector("#drawer-body").innerHTML = `
      <div class="drawer-header">
        <span class="drawer-icon glass-quiet">${icon(iconName || "activity")}</span>
        <div>
          <h2 class="drawer-title">${title}</h2>
          ${subtitle ? `<p class="drawer-subtitle">${subtitle}</p>` : ""}
        </div>
      </div>
      <div class="drawer-content">${bodyHTML}</div>`;
    root.classList.add("open");
    document.addEventListener("keydown", onKey);
  };
}

/* ---------- Info popover ----------
   The (i) icon is gone - the title itself is the trigger. Any element
   carrying data-info (.card-header-title for section cards, .kpi-label
   for the KPI row) opens the same Definition/Calculation/Source popover;
   only the affordance changed, not the content or the drill-down click
   handler it has to coexist with (see initDrillDown below, which
   ignores clicks inside [data-info] for exactly this reason). These
   strings describe this app's actual logic (repository.js) - not
   invented documentation. */

const METRIC_DOCS = {
  "portfolio-value": {
    definition: "Current market value of all holdings across every account.",
    calculation: "Sum of the latest market value of every position (BPI Dinâmico + the Trading212 sleeve).",
    source: "portfolio.holdings, via the repository. Real figures established from BPI NAV data and Trading212 positions.",
  },
  "investment-return": {
    definition: "Time-Weighted Return (TWR) since inception - how the investment performed, isolated from deposit timing/size. The Unrealised Gain shown underneath is a different question (\"what fraction of my money is currently profit\") and is deliberately not the same number.",
    calculation: "Chain-linked return on the money actually invested - not gain ÷ invested (that formula dilutes toward 0% every time fresh capital is added, which is why it's shown separately as Unrealised Gain, never as this headline).",
    source: "analytics.performance.totalReturnPct (TWR, the headline) and .unrealisedGain / .unrealisedGainPct (the sub-line).",
  },
  "investor-return": {
    definition: "XIRR (Money-Weighted Return, annualised) - what you personally earned, given exactly when and how much you deposited. A genuinely different question from Investment Return (TWR): that one measures the investment cash-flow-neutral, this one is sensitive to your own timing on purpose.",
    calculation: "The annual rate that makes every real cash flow (each contribution as a negative flow, current value as a hypothetical payout today) net to zero in present-value terms - the standard XIRR definition. It reads much smaller than Investment Return's +34.40% not because something's wrong, but because that figure is cumulative (total since 2017) while this one is annualised (per year) - they're on different time bases by definition, not disagreeing about the same thing.",
    source: "analytics.performance.investorReturnPct/investorReturnAvailable, computed by repository.js:xirr() over the real dated cash flows plus the current total value as a hypothetical terminal payout. investorReturnAvailable is false with fewer than 2 cash flows, shown as insufficient history rather than a fabricated 0%.",
  },
  "net-invested": {
    definition: "Capital actually contributed, excluding any gain or loss - a capital-flow figure, not a performance one.",
    calculation: "Sum of all contributions since the first subscription, minus any withdrawals (none on record).",
    source: "analytics.performance.investedCapital, dated from the BPI Dinâmico subscription (2017-06-21).",
  },
  "cash-available": {
    definition: "Uninvested cash sitting in an account, ready to deploy.",
    calculation: "Portfolio value minus the market value of all holdings.",
    source: "portfolio.cash. Currently €0 - every euro is invested, nothing idle.",
  },
  "investment-performance": {
    definition: "Time-Weighted Return (TWR) since inception - how the investment strategy performed, isolated from when or how much was deposited. Deliberately not the same question as Portfolio Value (\"what do I have\"), Investor Return / XIRR (\"what did I personally gain, given when I put money in\") - or a security's own market price return: this is computed from every holding's recorded Valuations, which already net out fees and distributions the way a raw price series never would, so the two numbers can legitimately differ even for a single-holding portfolio. A security's own price history (once daily_prices is live) belongs on that security's own page, not here.",
    calculation: "Portfolio-level chain-linked TWR - NOT one holding's own trajectory standing in for the whole portfolio, and NOT each holding's own return separately calculated and blended. Sub-periods are bounded by external cash-flow dates (a deposit or withdrawal); at each boundary, every holding's value is looked up via its nearest real observation on or before that date (never a future one, never interpolated) and summed into a total - that total already reflects each holding's historical weight, so there's no separate weighting step. Sub-period returns are then chained: (1+r1)×(1+r2)×...−1. This is an honest approximation using available valuation snapshots, not daily-continuous institutional-grade TWR - precision in any given stretch is bounded by whichever holding has the sparsest valuation history relevant to it. A holding with no observation yet contributes exactly 0 (it wasn't part of the portfolio), never a guess.",
    source: "history.valueSeries + analytics.performance.totalReturnPct/totalReturnAvailable, computed by js/calculations.js:chainLinkedPortfolioReturn()/valueOfSecurityAsOf() from live Valuations (or transcribed from 02_Portfolio Workbook.xlsx's Portfolio Values sheet, mock). Chart points are all real:true on the live path (every plotted date is a genuine observed total, never a fabricated smoothing point) - the real:false/dashed/interpolated treatment exists for the Showcase mock's deliberately sparse hand-authored series, not live data. totalReturnAvailable is false when there isn't yet at least one external cash flow with a valuation after it, in which case this shows as insufficient history rather than a fabricated 0%. Known limitation: the schema doesn't yet distinguish an external deposit from an internally-funded rebalance (every buy/sell counts as an external cash-flow boundary today) - correct for the current transaction history (no sells on record), not guaranteed correct in general.",
  },
  "portfolio-allocation": {
    definition: "How the portfolio splits by asset class, product, or account.",
    calculation: "Each holding's market value divided by total portfolio value, grouped by the selected dimension. Asset Class blends BPI Dinâmico's own internal split (Liquidez/Obrigações/Ações/Outros Investimentos) with the Trading212 sleeve (100% equity), scaled by each product's share of the total portfolio.",
    source: "portfolio.holdings and portfolio.accounts, plus BPI Dinâmico's real internal split from the workbook's Allocations sheet (source: BPI Ficha Mensal, June 2026).",
  },
  "allocation-asset-class": {
    definition: "How the portfolio splits across broad asset classes (Equities, Bonds, Cash, Alternatives) - the highest-level view of what kind of risk the portfolio is actually taking, independent of which product or account holds it.",
    calculation: "Each holding's market value classified by asset class and summed as a percentage of total portfolio value. A fund-of-funds (e.g. BPI Dinâmico) contributes its own disclosed internal split, scaled by its own share of the total portfolio, rather than being counted as one opaque \"Fund\" bucket - blended with every directly-held security's own class. Recomputed from current positions on every load, never read from a stored percentage.",
    source: "analytics.assetClassAllocation, from portfolio.holdings + BPI Dinâmico's internal split (source: BPI Ficha Mensal, June 2026 - see docs/migration-plan.md §3.3, not yet migrated to a live Supabase Allocations table, Phase 4/5).",
  },
  "allocation-security": {
    definition: "Weight of every individual holding (fund, ETF, stock, cash) as a share of total portfolio value - the most granular allocation view, one step up from Portfolio Detail's own data table.",
    calculation: "Each holding's latest market value ÷ current total portfolio value, ranked descending. Same figures as Portfolio Detail's Weight column - shown here as a ranked allocation view, not a second computation of it.",
    source: "analytics.productAllocation, derived from portfolio.holdings (Transactions + Valuations via js/calculations.js) - never a stored allocation table.",
  },
  "allocation-account": {
    definition: "How the portfolio splits across the accounts/brokers it's actually held in - a custody view, not a risk one (two accounts can hold the exact same underlying asset class or security).",
    calculation: "Sum of each account's holdings' current market value ÷ current total portfolio value.",
    source: "analytics.accountAllocation, derived from portfolio.accounts + portfolio.holdings - recalculated every load, never stored.",
  },
  "allocation-concentration": {
    definition: "How much of the portfolio sits in its largest few positions - a diversification signal (is this portfolio really spread out, or effectively one bet), not a performance one.",
    calculation: "Holdings ranked by current weight, descending; cumulative weight of the top 1, top 3 and top 5 shown alongside the full ranked list. A portfolio with very few holdings (as here) will legitimately show high concentration - that's a real structural fact, not a warning about data quality.",
    source: "analytics.productAllocation, re-ranked and summed on this page - no separate stored \"concentration\" figure exists anywhere.",
  },
  "exposure-country": {
    definition: "Which countries the portfolio's holdings are exposed to - fully real, no illustrative or placeholder entries. Two layers: each security's own Exposure Country (Detailed Portfolio), plus a real look-through decomposition for securities whose mandate is a broad index (World / Emerging Markets) rather than one country. This is look-through exposure, not a security's own stated region/mandate (a separate field, docs/migration-plan.md §2.2's securities.region - not shown here) - the two answer different questions and are deliberately never merged into one number, per docs/migration-plan.md §2.2.",
    calculation: "Every one of the 122 real securities was individually classified by issuer, ETF index or fund mandate - never by regulatory category. Where a security's mandate genuinely tracks (or, for Trading212's actively-managed AVWS, closely matches) a real published index, its real country weights are pulled in from that index's official factsheet (MSCI, Jul 2026) or the fund's own factsheet (Avantis, Jun 2026) - not guessed. Each factsheet only discloses its own top 5 countries plus a lump \"Other\" for the rest; that residual, plus BPI Dinâmico's ~25 actively-managed/thematic World/Europe/Emerging-Markets fund-of-fund positions (each would need its own individually-researched factsheet, not an index's), stay honestly folded into \"Not attributable to a single country\" - a real number, not a placeholder. 17 of BPI Dinâmico's 118 holdings (7.62% of the total portfolio - see the Region tab's \"Unknown\" figure) couldn't be classified at all from the security name and are marked Unknown.",
    source: "analytics.countries + analytics.notCountrySpecificWeight. Base classification from 02_Portfolio Workbook.xlsx's Detailed Portfolio (Exposure Country column); look-through weights from MSCI's official index factsheets and Avantis' fund factsheet, fetched live and cited in js/repository.js.",
  },
  "exposure-region": {
    definition: "The same portfolio, classified by region instead of country - not derived from the Country tab, from the same Detailed Portfolio source at its own (coarser) dimension. This is still look-through Exposure Region (Detailed Portfolio), not each security's own stated region/mandate (securities.region, a separate field per docs/migration-plan.md §2.2, not shown here) - despite the shared word \"region\", these are never merged.",
    calculation: "Aggregated directly from every security's Exposure Region classification. Categories like \"World\" or \"Unknown\" are real region-level facts about holdings that were never country-specific to begin with (a global tracker fund, or a security that couldn't be classified) - not a residual bucket for map-plotting leftovers. Deliberately unaffected by the Country tab's look-through decomposition: a fund classified \"World\" stays counted as World here even though its real US weight now shows up under United States on the Country tab - both are correct answers to different questions.",
    source: "analytics.regions, aggregated from 02_Portfolio Workbook.xlsx's Detailed Portfolio (Exposure Region column).",
  },
  "exposure-currency": {
    definition: "Which settlement currencies the portfolio is exposed to - not the same as the underlying economic currency exposure of what each fund actually holds.",
    calculation: "BPI Dinâmico is EUR-denominated; the Trading212 ETF sleeve is USD. Weighted by each account's share of the portfolio. A world-equity ETF traded in EUR still has real USD/JPY/GBP exposure through its underlying holdings - that finer breakdown isn't in the workbook, so this tab deliberately answers \"what currency would I receive if I sold\", not \"what currencies move this portfolio's value\".",
    source: "analytics.currency, derived from portfolio.accounts.",
  },
  "cost-basis": {
    definition: "What was actually paid for a position, still attributable to the units currently held - not what the position is worth today (see Market Value), and not the total ever paid in (a sold portion's cost leaves with it).",
    calculation: "Average-cost method: total amount spent across every buy transaction for that security, reduced proportionally by the average cost-per-unit for any units later sold. A security with no sell on record needs no per-unit tracking at all - its cost basis is simply everything paid in so far.",
    source: "js/calculations.js:costBasisFromTransactions(), over that security's own Transactions (type='buy'/'sell', amount, units) - the one shared implementation both the mock and live Supabase path call, never recomputed per page.",
  },
  "unrealised-pnl": {
    definition: "The paper gain or loss on a position if it were sold today at its latest known value - \"unrealised\" because nothing has actually been sold yet.",
    calculation: "Market Value minus Cost Basis, and that difference as a percentage of Cost Basis.",
    source: "js/calculations.js:unrealisedPnL(value, costBasis) - value from the latest Valuation, cost basis from costBasisFromTransactions() above. Shown as unavailable (never €0) when cost basis itself can't be determined, e.g. a sell exists but no unit count was ever recorded for it.",
  },
  "annual-returns": {
    definition: "Time-Weighted Return for each calendar year, and the current year to date - a different view of the same headline TWR above, not a separate metric. Average of the yearly figures shown here is NOT the same number as the since-inception TWR itself (arithmetic mean vs. compounded/chain-linked) - the two answer different questions and shouldn't be expected to match.",
    calculation: "The same chain-linked TWR calculation as the headline number (js/calculations.js:chainLinkedPortfolioReturn()), sliced at each Dec-31/Jan-1 boundary (annualReturns()) rather than recomputed - splitting the since-inception chain into years never changes its total. A year shows as \"no growth signal yet\" rather than a flat 0% when there's a real gap in dated observations spanning that whole year (nearest-prior carries the same value across the gap) - that's an honest data-availability limitation, not a claim the portfolio didn't move that year.",
    source: "analytics.performance.yearlyReturns, computed from the same Valuations/cash-flow data as the headline TWR - see that metric's own info popover for the full methodology and its documented limitations.",
  },
  "benchmark-comparison": {
    definition: "How the portfolio's return compares to a relevant market index (e.g. MSCI World) over the same period - not shown yet, honestly, rather than estimated.",
    calculation: "Would compare the portfolio's own Time-Weighted Return against the benchmark's own TWR (chain-linked from the benchmark's dated values, not its raw price - comparing to a raw price series is a common, misleading shortcut this app won't take).",
    source: "Needs a chosen benchmark (a future Settings field) and benchmark_history (docs/migration-plan.md §2.8) - neither exists in Supabase yet. daily_prices exists but its fetch/schedule is explicitly paused (docs/information-architecture.md §7), so no index price history is live either. Shown as an honest unavailable state rather than a placeholder chart.",
  },
  "portfolio-detail": {
    definition: "Every position currently held, across every account - what you actually own, not how it's performing (see Performance) or how it's diversified (see Allocation). Showcase shows structure and weight only; Private adds market value, average cost basis and unrealised P&L.",
    calculation: "Holdings are never edited directly - each row is derived from Transactions (units bought/sold) and Valuations (latest known value) per security, per docs/migration-plan.md §3.1. Avg. Cost Basis and Unrealised P&L use the average-cost method over that security's own buy/sell transactions - a security with no sell on record needs no per-unit tracking at all, its cost basis is simply everything paid in so far.",
    source: "portfolio.holdings, computed by js/calculations.js:costBasisFromTransactions()/unrealisedPnL() from transactions + valuations - the same shared functions Performance/Allocation/Risk read from as they're built, never a page-local recomputation.",
  },
  "top-holdings": {
    definition: "The portfolio's five largest positions by weight.",
    calculation: "All holdings sorted by weight, descending, top 5 kept.",
    source: "portfolio.holdings.",
  },
  "portfolio-health": {
    definition: "Objective structural facts about the portfolio - not a fabricated health score.",
    calculation: "Plain counts (holdings, accounts, transactions, countries, asset classes, currencies) and two ratios (largest position weight, cash ratio).",
    source: "analytics.health, computed from portfolio/analytics - nothing stored.",
  },
  "portfolio-insights": {
    definition: "Rule-based observations about the portfolio - never AI-generated commentary.",
    calculation: "Each sentence is the output of one fixed rule (e.g. \"largest position\", \"concentration if >50%\", \"cash below 5%\") evaluated against the current data.",
    source: "ui.js:buildInsights().",
  },
  "product-library": {
    definition: "Every product with research data on file - funds, ETFs, PPRs and unit-linked insurance products, whether or not you actually hold them. A research tool, distinct from Portfolio Detail (\"what do I have\").",
    calculation: "No calculation - a filtered/sorted view of security_details joined to securities. Products you actually hold (per Transactions) are marked \"Held\"; everything else is research-only.",
    source: "supabase/migrations/0005_product_database.sql / 0006_seed_products_and_brokers.sql - real figures transcribed from the old Portfol.io app's Excel-derived master database (18 products), not estimated. Authenticated-only for now, see that migration's own RLS comment for why.",
  },
  "broker-comparison": {
    definition: "Real costs, investor protection, and platform-quality scores for 10 brokers - a comparison tool, not a recommendation. Which broker fits you best depends on how you invest (small/frequent trades vs. large/infrequent, EUR-only vs. multi-currency, beginner vs. advanced), which this page deliberately doesn't decide for you.",
    calculation: "No calculation on the cost/protection facts - transcribed directly from each broker's own disclosed terms. The six scores (Cost/Safety/Beginner/Advanced/Tax simplicity/UX) are the old Portfol.io app's own curated 1-10 ratings, carried over as-is, not recomputed.",
    source: "supabase/migrations/0006_seed_products_and_brokers.sql - real figures transcribed from the old Portfol.io app's Excel-derived master database (10 brokers), not estimated. Authenticated-only for now, same as Securities.",
  },
  "product-score": {
    definition: "A 0-100 scorecard across nine dimensions - cost, tax efficiency, diversification, liquidity, transparency, scale, risk-adjusted efficiency, risk, and return. A scoring model, not a verdict: a low score on one dimension means \"know this about it\", not \"don't buy this\" - that's why every dimension is shown, not just the overall number.",
    calculation: "Each dimension is 0-100 from the product's own real data (e.g. Cost = 100 - (TER/2.8)×100; Return = 5Y return, or 3Y, or assumed gross return ÷14 ×100). Overall is their weighted average - weights unchanged from the original: cost and return matter most (1.3x each), scale matters least (0.6x).",
    source: "js/calculations.js:productScore(), ported verbatim (weights and thresholds unchanged) from the old Portfol.io engine's productScores() - see docs/legacy-feature-inventory.md's \"Product scoring\" row.",
  },
  "cost-drag": {
    definition: "The cumulative lifetime impact of this product's annual fee, as a percentage of what the investment would be worth with zero fees - a different question from the TER itself, and easy to conflate with it. A small annual fee compounds into a much larger lifetime number the longer money stays invested.",
    calculation: "((1+gross)^years - (1+gross-TER)^years) / (1+gross)^years × 100, using the product's own assumed gross return and TER over the horizon you choose here - never a flat \"~20%\" constant applied to every product.",
    source: "js/calculations.js:costDrag(), fed by this product's assumed_gross_return_pct/ter_pct (security_details).",
  },
};

// th[data-info]: table column headers (Portfolio Detail's Avg. Cost /
// Unrealised P&L today) - same popover mechanism, just a third trigger
// shape, so a table column can explain itself exactly like a card title
// or a KPI label does, never a bespoke tooltip per table.
const INFO_TRIGGER_SELECTOR = ".card-header-title[data-info], .kpi-label[data-info], th[data-info]";

function initInfoPopovers() {
  let openPopover = null;
  const close = () => { if (openPopover) { openPopover.remove(); openPopover = null; } };

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(INFO_TRIGGER_SELECTOR);
    if (!trigger) { close(); return; }
    e.stopPropagation();
    const key = trigger.dataset.info;
    const doc = METRIC_DOCS[key];
    if (!doc) return;

    const already = openPopover && openPopover.dataset.for === key;
    close();
    if (already) return;

    const pop = document.createElement("div");
    pop.className = "info-popover glass";
    pop.dataset.for = key;
    pop.innerHTML = `
      <p class="info-popover-label">Definition</p>
      <p class="info-popover-text">${doc.definition}</p>
      <p class="info-popover-label">Calculation</p>
      <p class="info-popover-text">${doc.calculation}</p>
      <p class="info-popover-label">Source</p>
      <p class="info-popover-text">${doc.source}</p>`;
    document.body.appendChild(pop);

    const rect = trigger.getBoundingClientRect();
    const width = 280;
    let left = rect.left + window.scrollX;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    pop.style.left = `${left}px`;
    pop.style.top = `${rect.bottom + window.scrollY + 8}px`;
    openPopover = pop;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const trigger = e.target.closest(INFO_TRIGGER_SELECTOR);
    if (!trigger) return;
    e.preventDefault();
    trigger.click();
  });

  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
}

/* ---------- Drill-down router ----------
   Target -> drawer-content mapping. This is the "navigation hub"
   architecture: every clickable element on the Overview calls
   drillDown(type, id) with a target descriptor, and this decides what
   to show. Content here is deliberately a *preview* built only from
   data the repository already has - never a fabricated deep page. When
   Phase 2 (Excel parser, fund holdings, fees, documents) lands, each
   case below grows into the real page described in the architecture doc;
   the call sites (donut legends, table rows, health tiles, insights)
   never need to change. */

function rowHTML(label, value) {
  return `<div class="drawer-row"><span>${label}</span><span>${value}</span></div>`;
}

function comingSoon(items) {
  return `<div class="drawer-coming-soon"><p class="drawer-hint">Coming soon, once the Excel parser is wired in:</p><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`;
}

/** The last data getPortfolioDataAuto() actually resolved to (mock or
    live Supabase), kept here so drillDown() reads exactly what's on
    screen. Without this, every drawer independently called
    getPortfolioData() - the MOCK-only entry point, never the live one -
    so a signed-in user looking at their real €501.27 on the KPI grid
    would click into a drawer built from the mock's €495.44 instead, and
    a real holding wouldn't be found there at all (mock ids like
    "bpi-dinamico" vs. real Supabase UUIDs), opening a silently empty
    drawer. Set once per render by app.js/portfolio-detail.js's own
    loadAndRender(), same object reference the cards themselves drew
    from - never a second, independent fetch. */
let currentPortfolioData = null;
function setCurrentPortfolioData(data) { currentPortfolioData = data; }

function drillDown(type, id) {
  const data = currentPortfolioData || getPortfolioData();
  let payload;

  switch (type) {
    case "kpi": payload = kpiDrill(id, data); break;
    case "performance": payload = performanceDrill(data); break;
    case "holding": payload = holdingDrill(id, data); break;
    case "assetClass": payload = assetClassDrill(id, data); break;
    case "account": payload = accountDrill(id, data); break;
    case "region": payload = regionDrill(id, data); break;
    case "country": payload = countryDrill(id, data); break;
    case "currency": payload = currencyDrill(id, data); break;
    case "health": payload = healthDrill(id, data); break;
    default: payload = { icon: "activity", title: id, bodyHTML: comingSoon(["This view"]) };
  }

  openDrawer(payload);
}

function kpiDrill(key, data) {
  const perf = data.analytics.performance;
  const returnPct = fmtPct(perf.totalReturnPct);
  const map = {
    value: { icon: "wallet", title: "Portfolio Value", value: formatMoney(perf.totalValue) },
    // Investment Return's own value IS the TWR percentage in both modes -
    // it's safe to show in public mode (reveals nothing about size), and
    // it's the number this card exists to answer. Unrealised Gain is a
    // different question, shown separately on the Snapshot tile itself.
    return: { icon: "trendingUp", title: "Investment Return", value: returnPct },
    invested: { icon: "landmark", title: "Invested Capital", value: formatMoney(perf.investedCapital) },
    cash: { icon: "wallet", title: "Cash Available", value: formatMoney(perf.cash) },
    investorReturn: { icon: "barChart3", title: "Investor Return", value: fmtPct(perf.investorReturnPct) },
  };
  const m = map[key];
  return {
    icon: m.icon, title: m.title, subtitle: m.value,
    bodyHTML: comingSoon(["Full history", "Contributions vs. withdrawals", "Benchmark comparison"]),
  };
}

function performanceDrill(data) {
  const perf = data.analytics.performance;
  return {
    icon: "trendingUp", title: "Investment Performance",
    subtitle: `${fmtPct(perf.totalReturnPct)} (TWR) since ${data.history.inceptionDate}`,
    bodyHTML: comingSoon(["Drawdown", "Benchmark comparison", "Rolling returns", "Calendar returns"]),
  };
}

function holdingDrill(id, data) {
  const h = data.portfolio.holdings.find((x) => x.id === id);
  if (!h) return { icon: "pieChart", title: "Holding", bodyHTML: "" };
  const account = data.portfolio.accounts.find((a) => a.id === h.accountId);
  // Avg. Cost Basis / Unrealised P&L: Private-only, per
  // docs/information-architecture.md's Portfolio Detail row ("Showcase =
  // structure + %, no €/cost-basis") - and read straight off h.costBasis/
  // h.pnl, never recomputed here, since the holdings table on Portfolio
  // Detail already computed them via the same calculations.js functions.
  const costRows = (isOwnerMode() && h.costBasis != null) ? `
        ${rowHTML("Avg. Cost Basis", formatMoney(h.costBasis))}
        ${rowHTML("Unrealised P&L", `${formatMoney(h.pnl, { signed: true })}${h.pnlPct != null ? ` (${fmtPct(h.pnlPct)})` : ""}`)}` : "";
  return {
    icon: "pieChart", title: h.name, subtitle: `${h.ticker !== "—" ? h.ticker + " · " : ""}${h.type}`,
    bodyHTML: `
      <div class="drawer-rows">
        ${rowHTML("Weight", `${h.weight.toFixed(2)}%`)}
        ${rowHTML("Market Value", formatMoney(h.value))}
        ${costRows}
        ${rowHTML("Total Return", `${h.returnPct > 0 ? "+" : ""}${h.returnPct.toFixed(2)}%`)}
        ${rowHTML("Account", account ? account.name : "—")}
      </div>
      ${comingSoon(["Fees (TER)", "Historical holdings", "Fund/ETF top holdings", "Asset & geographic allocation", "Documents"])}`,
  };
}

function assetClassDrill(name, data) {
  const item = data.analytics.assetClassAllocation.find((a) => a.name === name);
  const t212Holdings = data.portfolio.holdings.filter((h) => h.accountId !== "bpi");
  // Every class except Equities comes entirely from BPI Dinâmico's own
  // internal split (Trading212 is 100% equity ETFs, a real fact) - so
  // BPI shows as one "portion" row, not a fabricated per-holding split
  // the workbook doesn't have. Equities blends that portion with every
  // real T212 holding, which the workbook does have individually.
  const t212Total = t212Holdings.reduce((s, h) => s + h.weight, 0);
  const bpiPortion = item ? Math.round((item.weight - (name === "Equities" ? t212Total : 0)) * 100) / 100 : 0;
  const rows = name === "Equities"
    ? [rowHTML("BPI Dinâmico (equity portion)", `${bpiPortion.toFixed(2)}%`), ...t212Holdings.map((h) => rowHTML(h.name, `${h.weight.toFixed(1)}%`))]
    : [rowHTML("BPI Dinâmico (this class only)", `${bpiPortion.toFixed(2)}%`)];
  return {
    icon: "pieChart", title: name, subtitle: item ? `${item.weight.toFixed(2)}% of portfolio` : "",
    bodyHTML: `
      <div class="drawer-rows">${rows.join("")}</div>
      ${comingSoon(["Historical evolution of this class"])}`,
  };
}

function accountDrill(name, data) {
  const acc = data.analytics.accountAllocation.find((a) => a.name === name);
  // Looked up by name -> real account id, not hardcoded to the mock's
  // two accounts (a leftover from before this was reachable from any
  // live page - Allocation's Account card is what first wires this up
  // for real, so the bug now actually matters: a real Supabase account
  // id is a UUID, never "bpi"/"t212").
  const accountRecord = data.portfolio.accounts.find((a) => a.name === name);
  const holdings = data.portfolio.holdings.filter((h) => h.accountId === accountRecord?.id);
  const subtitle = !acc ? "" : isOwnerMode()
    ? `${fmtEUR(acc.value)} · ${acc.weight.toFixed(2)}% of portfolio`
    : `${acc.weight.toFixed(2)}% of portfolio`;
  return {
    icon: "landmark", title: name, subtitle,
    bodyHTML: `<div class="drawer-rows">${holdings.map((h) => rowHTML(h.name, formatMoney(h.value))).join("")}</div>`,
  };
}

function regionDrill(name, data) {
  const region = data.analytics.regions.find((r) => r.name === name);
  // regionForCountry lives in utils.js - shared with ui.js so the two
  // can't drift out of sync again (they already did once).
  const countries = data.analytics.countries.filter((c) => regionForCountry(c.name) === name);
  return {
    icon: "globe", title: name, subtitle: region ? `${region.weight.toFixed(2)}% of the portfolio` : "",
    bodyHTML: countries.length
      ? `<div class="drawer-rows">${countries.map((c) => rowHTML(c.name, `${c.weight.toFixed(1)}%`)).join("")}</div>${comingSoon(["Which products contribute here"])}`
      : comingSoon(["This region's real weight comes from holdings that were never country-specific (e.g. a global tracker) - see the Detailed Portfolio sheet"]),
  };
}

function countryDrill(isoCode, data) {
  // Compare numerically, not by string - the map's codes are the real
  // topojson feature ids (zero-padded, e.g. "076" for Brazil), which
  // won't string-match a plain iso number for any country under 100.
  const country = data.analytics.countries.find((c) => c.iso === Number(isoCode));
  return {
    icon: "globe", title: country ? country.name : "Country", subtitle: country ? `${country.weight.toFixed(1)}% exposure` : "Not yet mapped",
    bodyHTML: comingSoon(["Which products hold this country", "Historical evolution"]),
  };
}

function currencyDrill(code, data) {
  const cur = data.analytics.currency.find((c) => c.code === code);
  // Same fix as accountDrill above: matched by each account's own real
  // currency field, not hardcoded to "EUR means BPI, anything else
  // means Trading212" - that only ever happened to work for the mock's
  // exact two accounts.
  const accountIds = new Set(data.portfolio.accounts.filter((a) => (a.currency || "EUR") === code).map((a) => a.id));
  const holdings = data.portfolio.holdings.filter((h) => accountIds.has(h.accountId));
  return {
    icon: "wallet", title: `${code} Exposure`, subtitle: cur ? `${cur.weight.toFixed(2)}% of portfolio` : "",
    bodyHTML: `
      <div class="drawer-rows">${holdings.map((h) => rowHTML(h.name, `${h.weight.toFixed(1)}%`)).join("")}</div>
      ${comingSoon(["Historical currency evolution", "Hedge information"])}`,
  };
}

function healthDrill(metric, data) {
  const h = data.analytics.health;
  if (metric === "largest") return holdingDrill(data.portfolio.holdings.find((x) => x.weight === h.largestPosition.weight)?.id, data);
  if (metric === "cash") return kpiDrill("cash", data);

  if (metric === "holdings") {
    return {
      icon: "pieChart", title: "Holdings", subtitle: `${h.holdingsCount} positions`,
      bodyHTML: `<div class="drawer-rows">${data.portfolio.holdings.map((x) => rowHTML(x.name, `${x.weight.toFixed(1)}%`)).join("")}</div>`,
    };
  }
  if (metric === "accounts") {
    return {
      icon: "landmark", title: "Accounts", subtitle: `${h.accountsCount} accounts`,
      bodyHTML: `<div class="drawer-rows">${data.analytics.accountAllocation.map((a) => rowHTML(a.name, formatMoney(a.value))).join("")}</div>`,
    };
  }
  if (metric === "transactions") {
    return {
      icon: "receipt", title: "Transactions", subtitle: `${h.transactionsCount} recorded`,
      bodyHTML: `<div class="drawer-rows">${data.portfolio.transactions.map((t) => rowHTML(t.label, t.date)).join("")}</div>`,
    };
  }
  if (metric === "countries") {
    return {
      icon: "globe", title: "Countries", subtitle: `${h.countriesCount} mapped`,
      bodyHTML: `<div class="drawer-rows">${data.analytics.countries.map((c) => rowHTML(c.name, `${c.weight.toFixed(1)}%`)).join("")}</div>`,
    };
  }
  if (metric === "assetClasses") {
    return {
      icon: "pieChart", title: "Asset Classes", subtitle: `${h.assetClassesCount} classes`,
      bodyHTML: `<div class="drawer-rows">${data.analytics.assetClassAllocation.map((a) => rowHTML(a.name, `${a.weight.toFixed(1)}%`)).join("")}</div>`,
    };
  }
  if (metric === "currencies") {
    return {
      icon: "wallet", title: "Currencies", subtitle: `${h.currenciesCount} currencies`,
      bodyHTML: `<div class="drawer-rows">${data.analytics.currency.map((c) => rowHTML(c.code, `${c.weight.toFixed(1)}%`)).join("")}</div>`,
    };
  }

  return { icon: "activity", title: metric, bodyHTML: comingSoon(["Detailed breakdown"]) };
}

/**
 * Single delegated click handler for the whole "navigation hub" -
 * anything with data-drill-type/data-drill-id opens the matching drawer.
 * Ignores clicks on interactive controls nested inside a drillable card
 * (filter pills, tab buttons, the info-triggering title) so they keep
 * their own behaviour instead of also opening a drawer.
 */
function initDrillDown() {
  document.addEventListener("click", (e) => {
    if (e.target.closest(".filter-pill, .tab-btn, .link-more, [data-info]")) return;
    const el = e.target.closest("[data-drill-type]");
    if (!el) return;
    drillDown(el.dataset.drillType, el.dataset.drillId);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("[data-info]")) return;
    const el = e.target.closest("[data-drill-type]");
    if (!el) return;
    e.preventDefault();
    drillDown(el.dataset.drillType, el.dataset.drillId);
  });
}

window.isOwnerMode = isOwnerMode;
window.formatMoney = formatMoney;
window.indexValueSeries = indexValueSeries;
window.initNavigation = initNavigation;
window.renderTopbar = renderTopbar;
window.initDrawer = initDrawer;
window.initInfoPopovers = initInfoPopovers;
window.drillDown = drillDown;
window.initDrillDown = initDrillDown;
window.setCurrentPortfolioData = setCurrentPortfolioData;
