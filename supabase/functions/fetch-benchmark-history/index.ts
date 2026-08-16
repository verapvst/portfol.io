// Portfolio.io — fetch-benchmark-history
//
// Scheduled Edge Function (Supabase Cron, not called from the browser -
// see 0017_schedule_benchmark_fx_cron.sql). Pulls the last ~100 daily
// closes (Alpha Vantage TIME_SERIES_DAILY, outputsize=compact) for
// every row in `benchmarks` and upserts into benchmark_history. Using
// "compact" rather than a true delta call is deliberate: Alpha Vantage
// has no "just today" endpoint, and re-upserting the last ~100 days
// every night is cheap (one call per benchmark, well inside the free
// tier) while also self-healing any gap from a missed run - a night
// this function fails to run doesn't leave a permanent hole once it
// runs again.
//
// Same "Alpha Vantage returns HTTP 200 even on rejection" handling as
// backfill-benchmark-history - checked explicitly, never treated as a
// valid empty result.
//
// Secrets required: ALPHAVANTAGE_API_KEY (same one backfill-benchmark-
// history uses - Supabase dashboard -> Edge Functions -> Secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALPHAVANTAGE_API_KEY = Deno.env.get("ALPHAVANTAGE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Benchmark {
  id: string;
  provider_symbol: string;
}

interface AlphaVantageDailySeries {
  "Error Message"?: string;
  Note?: string;
  Information?: string;
  "Time Series (Daily)"?: Record<string, { "4. close": string }>;
}

async function fetchDailySeries(symbol: string): Promise<AlphaVantageDailySeries> {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${ALPHAVANTAGE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status} for ${symbol}`);
  }
  return (await res.json()) as AlphaVantageDailySeries;
}

Deno.serve(async () => {
  if (!ALPHAVANTAGE_API_KEY) {
    return new Response(JSON.stringify({ error: "ALPHAVANTAGE_API_KEY not configured" }), { status: 500 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: benchmarks, error: benchError } = await db.from("benchmarks").select("id, provider_symbol");
  if (benchError) {
    return new Response(JSON.stringify({ error: benchError.message }), { status: 500 });
  }

  const results: { benchmark_id: string; status: string; rows?: number }[] = [];

  for (const bench of benchmarks as Benchmark[]) {
    const logRow = {
      entity_type: "benchmark" as const,
      entity_id: bench.id,
      symbol_used: bench.provider_symbol,
      provider: "alpha_vantage",
      status: "error" as "ok" | "error" | "missing",
      error_message: null as string | null,
      http_status: null as number | null,
    };

    try {
      const series = await fetchDailySeries(bench.provider_symbol);
      const issue = series["Error Message"] || series.Note || series.Information;
      const dailySeries = series["Time Series (Daily)"];

      if (issue || !dailySeries) {
        logRow.status = "missing";
        logRow.error_message = issue || "No 'Time Series (Daily)' in Alpha Vantage response.";
        results.push({ benchmark_id: bench.id, status: "missing" });
      } else {
        const upsertRows = Object.entries(dailySeries).map(([date, row]) => ({
          benchmark_id: bench.id,
          date,
          close: Number(row["4. close"]),
          source: "alpha_vantage",
        }));

        const { error: upsertError } = await db
          .from("benchmark_history")
          .upsert(upsertRows, { onConflict: "benchmark_id,date" });

        if (upsertError) {
          logRow.status = "error";
          logRow.error_message = upsertError.message;
        } else {
          logRow.status = "ok";
        }
        results.push({ benchmark_id: bench.id, status: logRow.status, rows: upsertRows.length });
      }
    } catch (err) {
      logRow.status = "error";
      logRow.error_message = err instanceof Error ? err.message : String(err);
      results.push({ benchmark_id: bench.id, status: "error" });
    }

    await db.from("benchmark_fetch_log").insert(logRow);
    await new Promise((r) => setTimeout(r, 15000));
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
