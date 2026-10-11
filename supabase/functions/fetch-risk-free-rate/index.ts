// Portfolio.io — fetch-risk-free-rate
//
// One function, not a backfill/fetch pair like the benchmark and FX
// collectors (0016/0018) - deliberately different from that pattern.
// Those exist because stock-style endpoints have a real cost/size
// tradeoff between a one-time deep pull (outputsize=full) and a cheap
// incremental one (outputsize=compact). Alpha Vantage's TREASURY_YIELD
// endpoint (an economic indicator, not a security price series) has no
// such distinction - one call returns the whole available history every
// time, so there's nothing to split: this function IS the backfill, and
// running it nightly IS the ongoing collector, both via the exact same
// call. Safe to re-run - upsert-on-conflict, same idempotency
// discipline as every other collector here.
//
// Response shape is genuinely different from TIME_SERIES_DAILY/FX_DAILY
// (0016/0018's functions) - not a date-keyed object, a flat array under
// "data": [{date, value}, ...]. Alpha Vantage represents a missing/non-
// trading-day observation as value:"." for these economic-indicator
// endpoints - filtered out explicitly below, never parsed as 0.
//
// USD-denominated (a US Treasury yield) - deliberately consistent with
// the two benchmarks already in this app (S&P 500/Nasdaq-100, 0018 -
// also raw USD, not EUR-converted). See 0021's own header comment for
// the full reasoning.
//
// Secrets required: ALPHAVANTAGE_API_KEY (same key the benchmark/FX
// functions use - Supabase dashboard -> Edge Functions -> Secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALPHAVANTAGE_API_KEY = Deno.env.get("ALPHAVANTAGE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 3-month is the Sharpe-ratio risk-free proxy; the rest are the US
// Treasury curve points the Simulator shows as short / mid / long yields
// (risk_free_rates.maturity already supports any of them, 0021 - one entry
// here, not a schema change). A caller can fetch a subset on demand by
// POSTing {"maturities": ["10year"]} (e.g. the Simulator's "refresh").
const ALL_MATURITIES = ["3month", "2year", "5year", "10year", "30year"].map((m) => ({ key: m, param: m }));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AlphaVantageEconomicSeries {
  "Error Message"?: string;
  Note?: string;
  Information?: string;
  data?: { date: string; value: string }[];
}

async function fetchTreasuryYield(maturity: string): Promise<AlphaVantageEconomicSeries> {
  const url = `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=${maturity}&apikey=${ALPHAVANTAGE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status} for TREASURY_YIELD/${maturity}`);
  }
  return (await res.json()) as AlphaVantageEconomicSeries;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!ALPHAVANTAGE_API_KEY) {
    return new Response(JSON.stringify({ error: "ALPHAVANTAGE_API_KEY not configured" }), { status: 500, headers: CORS });
  }

  let requested: string[] | null = null;
  try {
    const body = await req.json();
    if (Array.isArray(body?.maturities)) requested = body.maturities.map(String);
  } catch (_) { /* no body (cron) = every maturity */ }
  const MATURITIES = requested ? ALL_MATURITIES.filter((m) => requested!.includes(m.key)) : ALL_MATURITIES;

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results: { maturity: string; status: string; rows?: number; error?: string }[] = [];

  for (const m of MATURITIES) {
    const logRow = {
      entity_type: "risk_free" as const,
      entity_id: `treasury-${m.key}`,
      symbol_used: `TREASURY_YIELD/${m.param}`,
      provider: "alpha_vantage",
      status: "error" as "ok" | "error" | "missing",
      error_message: null as string | null,
      http_status: null as number | null,
    };

    try {
      const series = await fetchTreasuryYield(m.param);
      const issue = series["Error Message"] || series.Note || series.Information;
      const data = series.data;

      if (issue || !data) {
        logRow.status = "missing";
        logRow.error_message = issue || "No 'data' array in Alpha Vantage response.";
        results.push({ maturity: m.key, status: "missing", error: logRow.error_message });
      } else {
        const upsertRows = data
          .filter((r) => r.value !== "." && r.value != null && !Number.isNaN(Number(r.value)))
          .map((r) => ({
            maturity: m.key,
            date: r.date,
            rate_pct: Number(r.value),
            source: "alpha_vantage",
          }));

        if (!upsertRows.length) {
          logRow.status = "missing";
          logRow.error_message = "Data array was present but had no usable (non-'.') values.";
          results.push({ maturity: m.key, status: "missing" });
        } else {
          const { error: upsertError } = await db
            .from("risk_free_rates")
            .upsert(upsertRows, { onConflict: "maturity,date" });

          if (upsertError) {
            logRow.status = "error";
            logRow.error_message = upsertError.message;
            results.push({ maturity: m.key, status: "error", error: upsertError.message });
          } else {
            logRow.status = "ok";
            results.push({ maturity: m.key, status: "ok", rows: upsertRows.length });
          }
        }
      }
    } catch (err) {
      logRow.status = "error";
      logRow.error_message = err instanceof Error ? err.message : String(err);
      results.push({ maturity: m.key, status: "error", error: logRow.error_message });
    }

    await db.from("benchmark_fetch_log").insert(logRow);
    // Alpha Vantage's free tier limits calls per minute - space them out
    // (skipped after the last one, so a single on-demand refresh is fast).
    if (m !== MATURITIES[MATURITIES.length - 1]) await new Promise((r) => setTimeout(r, 13000));
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
