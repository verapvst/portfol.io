/* ============================================================
   portfolio-detail.js - the Portfolio Detail page ("what do I have?").
   Reads the exact same data.portfolio.holdings/accounts contract
   Overview's Top Holdings card reads (repository.js/analytics.js -
   getPortfolioDataAuto()) - this page is the full list that card is a
   preview of, never a second computation of it. Every euro figure goes
   through formatMoney() (shell.js) so Showcase/Private masking and this
   page's own column visibility stay driven by the same isOwnerMode(),
   not a page-local flag.
   ============================================================ */

function $(id) { return document.getElementById(id); }

function accountName(data, accountId) {
  const acc = data.portfolio.accounts.find((a) => a.id === accountId);
  return acc ? acc.name : "—";
}

/** Avg. Cost / Unrealised P&L columns only render in Private mode - per
    docs/information-architecture.md's Portfolio Detail row ("Showcase =
    structure + %, no €/cost-basis"), this isn't a mask-in-place like
    formatMoney() elsewhere (a whole row of "······" repeated three
    times reads as noise, not privacy) - the columns themselves aren't
    there in Showcase. Weight/Account/Type are ratio/structural facts,
    shown either way. */
function holdingsDetailRowHTML(h, data, owner) {
  const pnlTone = h.pnl > 0 ? "up" : h.pnl < 0 ? "down" : "text-muted";
  const moneyCells = owner ? `
      <td>${formatMoney(h.value)}</td>
      <td>${h.costBasis != null ? formatMoney(h.costBasis) : "—"}</td>
      <td class="${h.pnl != null ? pnlTone : "text-muted"}">${h.pnl != null ? `${formatMoney(h.pnl, { signed: true })}${h.pnlPct != null ? ` (${fmtPct(h.pnlPct)})` : ""}` : "—"}</td>` : "";

  return `
    <tr data-drill-type="holding" data-drill-id="${h.id}" tabindex="0" role="button" aria-label="${h.name} details">
      <td>
        <p class="asset-name">${h.name}</p>
        <p class="asset-ticker">${h.ticker} · ${h.type}</p>
      </td>
      <td>${accountName(data, h.accountId)}</td>
      <td>${h.weight.toFixed(2)}%</td>
      ${moneyCells}
    </tr>`;
}

function renderHoldingsDetail(container, data) {
  const owner = isOwnerMode();
  const holdings = [...data.portfolio.holdings].sort((a, b) => b.weight - a.weight);

  if (!holdings.length) {
    container.innerHTML = `<p class="holdings-detail-empty">No holdings on record yet.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-scroll">
      <table class="holdings-table holdings-detail-table${owner ? "" : " showcase"}">
        <thead>
          <tr>
            <th>Asset</th><th>Account</th><th>Weight</th>
            ${owner ? `<th>Market Value</th><th data-info="cost-basis" tabindex="0" role="button" aria-label="About this metric">Avg. Cost</th><th data-info="unrealised-pnl" tabindex="0" role="button" aria-label="About this metric">Unrealised P&amp;L</th>` : ""}
          </tr>
        </thead>
        <tbody>${holdings.map((h) => holdingsDetailRowHTML(h, data, owner)).join("")}</tbody>
      </table>
    </div>`;
}

function renderSummary(container, data) {
  const holdings = data.portfolio.holdings;
  const accountsCount = data.portfolio.accounts.length;
  const accountsLabel = `${accountsCount} account${accountsCount === 1 ? "" : "s"}`;
  container.textContent = isOwnerMode()
    ? `${holdings.length} holdings across ${accountsLabel} · ${fmtEUR(data.analytics.performance.totalValue)} total`
    : `${holdings.length} holdings across ${accountsLabel}`;
}

function renderAll(data) {
  renderSummary($("holdings-detail-summary"), data);
  renderHoldingsDetail($("holdings-detail-table"), data);
}

async function init() {
  const user = { initial: "V", name: "Vera Sousa", role: "Long-term investor", greetingName: "Vera" };

  initDrawer();
  initInfoPopovers();
  initDrillDown();

  renderTopbar($("topbar"), user, {
    heading: "Portfolio Detail",
    subtitle: "Every position you hold, right now.",
  });
  initNavigation(user);
  initAuthModal();
  initAuthButton($("auth-slot"));

  // Same live-with-mock-fallback seam as Overview (analytics.js's
  // getPortfolioDataAuto()) - re-fetches and redraws on every sign-in/
  // out, and hands the resolved data to setCurrentPortfolioData() so
  // this page's own drill-down drawers (holdingDrill in shell.js) read
  // the same object the table just rendered, never a second fetch.
  const loadAndRender = async () => {
    const data = await getPortfolioDataAuto();
    setCurrentPortfolioData(data);
    renderAll(data);
  };
  onAuthChange(() => { loadAndRender(); });
  await initAuth();
  await loadAndRender();
}

document.addEventListener("DOMContentLoaded", init);
