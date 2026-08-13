/* ============================================================
   coming-soon.js - the reusable "not built yet" destination for any
   nav item that doesn't have a real page behind it. Reads ?feature=<key>
   and looks it up in FEATURES below - adding the next future feature
   (a new Simulator sub-tool, a new Research page, whatever) is a new
   entry in this map plus pointing a nav href at
   coming-soon.html?feature=<key>, never a new HTML file.

   Deliberately not a redirect to Overview and not a dead "#" link -
   clicking a not-yet-built feature should feel like landing somewhere
   intentional, not like the click did nothing.
   ============================================================ */

function $(id) { return document.getElementById(id); }

/** icon keys match the same icon already assigned to each item in
    NAV_CATEGORIES (shell.js) - not a new icon choice made here, just
    reused so the nav item and its own landing page visually agree. */
const FEATURES = {
  risk: {
    icon: "activity",
    title: "Risk",
    description: "Understand how much your portfolio's value could realistically swing - volatility, drawdown and other risk measures computed from your actual holdings' real price history, not a generic risk score. This feature is currently under development.",
  },
  benchmarks: {
    icon: "barChart3",
    title: "Benchmarks",
    description: "Compare your portfolio's real performance against a chosen index - replaying your own contribution dates and amounts against the benchmark, not a naive since-inception comparison against its raw price. This feature is currently under development.",
  },
  "market-data": {
    icon: "trendingUp",
    title: "Market Data",
    description: "Browse real daily prices, coverage and returns for every security you hold or research, sourced directly from market-data providers. This feature is currently under development.",
  },
  simulator: {
    icon: "sparkles",
    title: "Simulator",
    description: "Model different contribution, withdrawal and market scenarios - including Monte Carlo simulations - to understand a range of possible future outcomes for your portfolio, not a single predicted number. This feature is currently under development.",
  },
  settings: {
    icon: "settings",
    title: "Settings",
    description: "Manage your account, currency and timezone preferences, and how your data is imported and stored. Once this is a real page, it'll follow the same gated-preview pattern as Transactions - visible while signed out, private data hidden until you log in. This feature is currently under development.",
  },
};

/** An unrecognised or missing ?feature= still renders a real page, not
    a blank one - the generic fallback below, never an error. */
const FALLBACK_FEATURE = {
  icon: "sparkles",
  title: "Coming Soon",
  description: "This feature is currently under development.",
};

function featureFromURL() {
  const key = new URLSearchParams(window.location.search).get("feature");
  return FEATURES[key] || FALLBACK_FEATURE;
}

/** Settings is the one feature here with a real signed-out/signed-in
    distinction today (see FEATURES.settings' own description) - a
    gated preview, same idea as Transactions' own renderSignedOutState()
    (js/transactions.js), not a full page hide: a visitor should still
    discover the page exists and understand why they can't use it yet,
    never learn anything private in the process (there's nothing
    private to learn here - Settings has no real data yet either way).
    Re-run on auth change (see init() below), not just once at load, so
    signing in while already sitting on this page updates it live. */
function renderFeature() {
  const key = new URLSearchParams(window.location.search).get("feature");
  const f = FEATURES[key] || FALLBACK_FEATURE;
  $("coming-soon-icon").innerHTML = icon(f.icon);
  $("coming-soon-title").textContent = f.title;
  $("coming-soon-description").textContent = f.description;
  $("coming-soon-gated").hidden = !(key === "settings" && !currentUser());
}

function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };
  const f = featureFromURL();

  initDrawer();
  renderTopbar($("topbar"), user, {
    heading: f.title,
    subtitle: "This feature is currently under development.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));
  $("coming-soon-gated-cta").addEventListener("click", () => window.openAuthModal());

  renderFeature();
  onAuthChange(renderFeature);
  initAuth();
}

document.addEventListener("DOMContentLoaded", init);
