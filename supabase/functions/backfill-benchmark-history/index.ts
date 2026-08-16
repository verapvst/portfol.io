// Portfolio.io — backfill-benchmark-history
//
// One-time (or occasionally re-run) historical pull for every row in
// `benchmarks` (currently S&P 500 via SPY, Nasdaq-100 via QQQ) — see
// this feature's plan doc, section F. Deliberately a SEPARATE function
// from fetch-benchmark-history, matching the existing backfill-daily-
// prices / fetch-daily-prices split (0004/0010): this one does a bulk
// historical pull per benchmark (Alpha Vantage TIME_SERIES_DAILY,
// outputsize=full — years of history in one call), fetch-benchmark-
// history does a cheap incremental "recent days" pull on a schedule.
//
// Alpha Vantage returns HTTP 200 even when it's rejecting the request
// (rate limit, bad symbol, bad key) — the payload carries an "Error
// Message" or "Note"/"Information" field instead of a non-2xx status.
// Checked explicitly below; never treated as a valid empty result.
//
// Price-only, not dividend-adjusted (see benchmarks.data_type) — Alpha
// Vantage's free TIME_SERIES_DAILY_ADJUSTED sits behind a premium plan.
// This function stores exactly what the free endpoint returns; nothing
// here claims otherwise.
//
// CONFIRMED DORMANT ON THE FREE TIER (2026-08-16, live test against the
// real key): outputsize=full itself is ALSO a premium-only parameter on
// TIME_SERIES_DAILY now - Alpha Vantage's response was "The
// outputsize=full parameter value is a premium feature for the
// TIME_SERIES_DAILY endpoint," logged in benchmark_fetch_log. This
// function will keep returning status:"missing" for every benchmark
// until the account is upgraded - a real, live-verified limitation, not
// a bug in this code. Decision made with the app's owner: don't chase a
// free deep-history workaround (the obvious one, Stooq's public CSV
// endpoint, turned out to require passing a JS proof-of-work bot
// challenge no server-side call can satisfy - not something this
// codebase will script around). Benchmark history instead starts thin
// via fetch-benchmark-history's own outputsize=compact pull and grows
// one real day at a time - see plan doc section F's "accept and grow
// organically" decision. Left AS-IS (not deleted, not rewritten to
// compact) so it becomes immediately useful again with zero changes if
// the Alpha Vantage plan is ever upgraded.
//
// Secrets required (Supabase dashboard -> Edge Functions -> Secrets,
// never in this file, never in the frontend): ALPHAVANTAGE_API_KEY.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected.

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
  "Time Series (Daily)"?: Record<string, { "1. open": string; "2. high": string; "3. low": string; "4. close": string; "5. volume": string }>;
}

async function fetchDailySeries(symbol: string, outputsize: "full" | "compact"): Promise<AlphaVantageDailySeries> {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=${outputsize}&apikey=${ALPHAVANTAGE_API_KEY}`;
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

  const results: { benchmark_id: string; status: string; rows?: number; error?: string }[] = [];

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
      const series = await fetchDailySeries(bench.provider_symbol, "full");
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
          results.push({ benchmark_id: bench.id, status: "error", error: upsertError.message });
        } else {
          logRow.status = "ok";
          results.push({ benchmark_id: bench.id, status: "ok", rows: upsertRows.length });
        }
      }
    } catch (err) {
      logRow.status = "error";
      logRow.error_message = err instanceof Error ? err.message : String(err);
      results.push({ benchmark_id: bench.id, status: "error", error: logRow.error_message });
    }

    await db.from("benchmark_fetch_log").insert(logRow);

    // Alpha Vantage free tier: 5 calls/minute, 25 calls/day. Only 2
    // benchmarks today, but this delay respects the per-minute ceiling
    // regardless of how many benchmarks exist later.
    await new Promise((r) => setTimeout(r, 15000));
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
