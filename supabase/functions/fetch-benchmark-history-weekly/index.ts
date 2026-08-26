// Portfolio.io — fetch-benchmark-history-weekly
//
// Scheduled Edge Function (Supabase Cron, weekly - see
// 0029_schedule_benchmark_weekly_cron.sql). Pulls the latest weekly bar
// (Alpha Vantage TIME_SERIES_WEEKLY - live-tested working on the
// current plan, 2026-08-26, unlike TIME_SERIES_DAILY's outputsize=full
// which is premium-gated) for every benchmark that has a proxy_symbol
// configured (today: sp500 -> SPY, nasdaq100 -> QQQ) and upserts one row
// per benchmark into benchmark_history.
//
// NOT a revival of the retired fetch-benchmark-history/backfill-
// benchmark-history functions - those were daily-shaped and are stale
// against the current schema (0018 renamed close -> index_level; this
// migration, 0028, adds per-row symbol/instrument_type). This is a new
// function with a genuinely different shape: weekly cadence (matching
// the portfolio's own Weekly Check-in, not nightly), and it tags every
// row 'etf'/the proxy symbol so it lives in its own segment of the
// series - see 0028's own header comment and
// js/calculations.js:indexValueSeries() for why that segmentation
// matters (never divide a SPY price against the frozen SPX index-level
// history it follows - two genuinely different scales).
//
// Two dates per row, deliberately: `date` is the Sunday checkpoint
// (this function's own invocation date - the cron below is scheduled
// for Sunday specifically so this is always correct without
// recomputing "nearest Sunday" here), `price_date` is the real trading
// day Alpha Vantage's weekly bar is actually from (typically the
// preceding Friday) - markets are closed Sunday, so these are never the
// same date and neither is ever invented from the other.
//
// Same "Alpha Vantage returns HTTP 200 even on rejection" defensive
// checking as every other function in this family - never treated as a
// valid empty result.
//
// Secrets required: ALPHAVANTAGE_API_KEY (same one every other
// benchmark/FX/risk-free-rate function already uses - Supabase
// dashboard -> Edge Functions -> Secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALPHAVANTAGE_API_KEY = Deno.env.get("ALPHAVANTAGE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Benchmark {
  id: string;
  proxy_symbol: string | null;
}

interface AlphaVantageWeeklySeries {
  "Error Message"?: string;
  Note?: string;
  Information?: string;
  "Weekly Time Series"?: Record<string, { "4. close": string }>;
}

async function fetchWeeklySeries(symbol: string): Promise<AlphaVantageWeeklySeries> {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHAVANTAGE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status} for ${symbol}`);
  }
  return (await res.json()) as AlphaVantageWeeklySeries;
}

Deno.serve(async () => {
  if (!ALPHAVANTAGE_API_KEY) {
    return new Response(JSON.stringify({ error: "ALPHAVANTAGE_API_KEY not configured" }), { status: 500 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const checkpointDate = new Date().toISOString().slice(0, 10);

  const { data: benchmarks, error: benchError } = await db
    .from("benchmarks")
    .select("id, proxy_symbol")
    .not("proxy_symbol", "is", null);
  if (benchError) {
    return new Response(JSON.stringify({ error: benchError.message }), { status: 500 });
  }

  const results: { benchmark_id: string; status: string; price_date?: string }[] = [];

  for (const [i, bench] of (benchmarks as Benchmark[]).entries()) {
    // Alpha Vantage's free tier rejects requests fired faster than
    // ~1/second (confirmed live, 2026-08-26 - back-to-back SPY/QQQ
    // calls with no gap got "Please consider spreading out your free
    // API requests more sparingly"). Only 2 benchmarks today, so a
    // fixed 2s gap between each is simple and comfortably safe -
    // revisit if this list ever grows large enough to make a real
    // rate-limiter worth the complexity.
    if (i > 0) await new Promise((r) => setTimeout(r, 2000));

    const symbol = bench.proxy_symbol!;
    const logRow = {
      entity_type: "benchmark" as const,
      entity_id: bench.id,
      symbol_used: symbol,
      provider: "alpha_vantage",
      status: "error" as "ok" | "error" | "missing",
      error_message: null as string | null,
      http_status: null as number | null,
    };

    try {
      const series = await fetchWeeklySeries(symbol);
      const issue = series["Error Message"] || series.Note || series.Information;
      const weeklySeries = series["Weekly Time Series"];

      if (issue || !weeklySeries) {
        logRow.status = "missing";
        logRow.error_message = issue || "No 'Weekly Time Series' in Alpha Vantage response.";
        results.push({ benchmark_id: bench.id, status: "missing" });
      } else {
        // Alpha Vantage returns weekly bars newest-first - the latest
        // real trading week's close is the first entry, never computed
        // or guessed here.
        const [priceDate, latestBar] = Object.entries(weeklySeries)[0];

        const { error: upsertError } = await db
          .from("benchmark_history")
          .upsert(
            [{
              benchmark_id: bench.id,
              date: checkpointDate,
              price_date: priceDate,
              index_level: Number(latestBar["4. close"]),
              symbol,
              instrument_type: "etf",
              frequency: "weekly",
              source: "alpha_vantage",
            }],
            { onConflict: "benchmark_id,date" }
          );

        if (upsertError) {
          logRow.status = "error";
          logRow.error_message = upsertError.message;
        } else {
          logRow.status = "ok";
        }
        results.push({ benchmark_id: bench.id, status: logRow.status, price_date: priceDate });
      }
    } catch (err) {
      logRow.status = "error";
      logRow.error_message = err instanceof Error ? err.message : String(err);
      results.push({ benchmark_id: bench.id, status: "error" });
    }

    await db.from("benchmark_fetch_log").insert(logRow);
  }

  return new Response(JSON.stringify({ checkpointDate, processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
