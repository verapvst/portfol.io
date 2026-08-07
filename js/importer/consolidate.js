/**
 * Merge one fund+month's parsed documents (Ficha Mensal, Carteira
 * Detalhada) into the row shapes the Excel sheets expect.
 *
 * Deliberately simple: no sessions, no persistence, no separate model
 * layer. This is exactly the merge the app needs today - if a real need
 * for more shows up in practice, that's the time to add it, not before.
 */

function val(field) {
  return field && field.value !== undefined ? field.value : null;
}

const TABLE_HEADERS = {
  fundSnapshots: ["Fund", "Report Month", "Reference Date", "Management Company",
    "Legal Form", "Launch Date", "Min Subscription Amount", "Subscription Fee %",
    "Redemption Fee %", "Management Fee % (TER)", "Depositary Fee %", "AUM",
    "AUM Unit", "SRRI Class", "Total Net Assets", "Benchmark", "Category", "Sources"],
  fundPerformance: ["Fund", "Report Month", "Period", "Return %", "Risk Class"],
  fundAssetClassDistribution: ["Fund", "Report Month", "Category", "Weight %"],
  fundTopHoldings: ["Fund", "Report Month", "Asset", "Weight %"],
  fundShareClasses: ["Fund", "Report Month", "Class Label", "Net Assets", "Units Outstanding"],
  fundHoldings: ["Fund", "Report Month", "Category Path", "Name", "Currency",
    "Quantity/Nominal", "Price", "Price Type", "Market Value", "Weight %"],
};

function buildFundTables(group) {
  const fm = group.fichaMensal;
  const hr = group.holdingsReport;
  const fundName = group.fundName;
  const period = group.period;

  const sourcesLabel = [fm ? "Ficha Mensal" : null, hr ? "Carteira Detalhada" : null]
    .filter(Boolean).join(" + ") || "—";
  const c = fm ? fm.commercial_characteristics : null;

  const fundSnapshots = [[
    fundName, period,
    (fm && val(fm.fund.reference_date)) || (hr && val(hr.fund.as_of_date)) || "",
    (c && val(c.management_company)) || (hr && val(hr.fund.management_company)) || "",
    (fm && val(fm.fund.legal_form)) || "",
    (c && val(c.launch_date)) || "",
    (c && val(c.minimum_subscription_amount)) ?? "",
    (c && val(c.subscription_fee_pct)) ?? "",
    (c && val(c.redemption_fee_pct)) ?? "",
    (c && val(c.management_fee_pct)) ?? "",
    (c && val(c.depositary_fee_pct)) ?? "",
    (c && val(c.assets_under_management)) ?? "",
    (c && c.assets_under_management && c.assets_under_management.unit) || "",
    (fm && val(fm.risk.srri_class)) ?? "",
    (hr && val(hr.fund_totals.total_net_assets)) ?? "",
    "", // Benchmark - reservado, nenhum documento visto até agora o inclui
    "", // Category - reservado
    sourcesLabel,
  ]];

  const fundPerformance = fm
    ? fm.performance.periods.map((p) => [fundName, period, p.period, p.return_pct ?? "", p.risk_class ?? ""])
    : [];
  const fundAssetClassDistribution = fm
    ? fm.asset_class_distribution.categories.map((x) => [fundName, period, x.category, x.weight_pct])
    : [];
  // Fund Top Holdings só existe quando falta a Carteira Detalhada: com os dois
  // documentos presentes, o mesmo top-10 (mesmos ativos, mesma ordem) já sai de
  // Fund Holdings, e com pesos mais precisos (extraídos da Carteira Detalhada,
  // não da Ficha Mensal, que tem uma data de referência ligeiramente diferente).
  const fundTopHoldings = (fm && !hr)
    ? fm.top_holdings.holdings.map((h) => [fundName, period, h.asset, h.weight_pct])
    : [];

  const fundShareClasses = hr
    ? hr.fund_totals.share_classes.map((sc) => {
        const unitsEntry = hr.units_outstanding.share_classes.find((u) => u.class_label === sc.class_label);
        return [fundName, period, sc.class_label, val(sc.net_assets) ?? "", unitsEntry ? (val(unitsEntry.units) ?? "") : ""];
      })
    : [];

  // "Fund Holdings" = tudo o que conta para o NAV do fundo: posições
  // normais, liquidez e ajustamentos. off_balance_sheet (futuros) fica
  // de fora de propósito - não conta para o NAV.
  const navContributingPositions = hr
    ? [...hr.holdings, ...hr.cash_positions, ...hr.other_adjustments]
    : [];
  const fundHoldings = navContributingPositions.map((h) => [
    fundName, period, h.category_path || "", h.name, h.currency,
    h.quantity_or_nominal ?? "", h.price ?? "", h.price_type || "",
    h.market_value ?? "", h.weight_pct ?? "",
  ]);

  const warnings = [...(fm ? fm.warnings : []), ...(hr ? hr.warnings : [])];

  // Validação mínima, inline - o suficiente para esta fase. Nunca bloqueia.
  const issues = [];
  if (hr) {
    const sum = navContributingPositions.reduce((s, h) => s + (h.market_value || 0), 0);
    const nav = hr.fund_totals.total_net_assets.value;
    if (nav && Math.abs(sum - nav) > 0.01) {
      issues.push(`Soma das posições (${sum.toFixed(2)}) não bate com o NAV total (${nav.toFixed(2)}).`);
    }
  }

  return {
    fundSnapshots, fundPerformance, fundAssetClassDistribution, fundTopHoldings,
    fundShareClasses, fundHoldings, warnings, issues,
  };
}

window.BPIConsolidate = { buildFundTables, TABLE_HEADERS };
