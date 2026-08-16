// Portfolio.io — backfill-fx-rates
//
// One-time (or occasionally re-run) historical pull of USD/EUR daily
// rates (Alpha Vantage FX_DAILY, outputsize=full) — see this feature's
// plan doc, section D/I. Only one pair for now (Portfol.io's benchmarks
// are USD-denominated, the portfolio is EUR) — deliberately not built
// as a generic multi-pair system yet, matching the plan's "don't over-
// engineer" instruction; add pairs by extending PAIRS below when a
// second one is actually needed.
//
// Same "Alpha Vantage returns HTTP 200 even on rejection" handling as
// the benchmark functions - checked explicitly.
//
// Secrets required: ALPHAVANTAGE_API_KEY (same key the benchmark
// functions use - Supabase dashboard -> Edge Functions -> Secrets).
//
// CONFIRMED DORMANT ON THE FREE TIER (2026-08-16) - same
// outputsize=full-is-premium finding as backfill-benchmark-history's
// own header comment; also hit the 25-requests/day quota independently
// in the same live test. Left AS-IS for the same reason: immediately
// useful again with zero changes on a premium plan. fx_rates instead
// grows via fetch-fx-rates's outputsize=compact nightly pull.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALPHAVANTAGE_API_KEY = Deno.env.get("ALPHAVANTAGE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAIRS = [{ from: "USD", to: "EUR" }];

interface AlphaVantageFxSeries {
  "Error Message"?: string;
  Note?: string;
  Information?: string;
  "Time Series FX (Daily)"?: Record<string, { "4. close": string }>;
}

async function fetchFxSeries(from: string, to: string, outputsize: "full" | "compact"): Promise<AlphaVantageFxSeries> {
  const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${from}&to_symbol=${to}&outputsize=${outputsize}&apikey=${ALPHAVANTAGE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status} for ${from}/${to}`);
  }
  return (await res.json()) as AlphaVantageFxSeries;
}

Deno.serve(async () => {
  if (!ALPHAVANTAGE_API_KEY) {
    return new Response(JSON.stringify({ error: "ALPHAVANTAGE_API_KEY not configured" }), { status: 500 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results: { pair: string; status: string; rows?: number; error?: string }[] = [];

  for (const pair of PAIRS) {
    const pairLabel = `${pair.from}/${pair.to}`;
    const logRow = {
      entity_type: "fx" as const,
      entity_id: pairLabel,
      symbol_used: pairLabel,
      provider: "alpha_vantage",
      status: "error" as "ok" | "error" | "missing",
      error_message: null as string | null,
      http_status: null as number | null,
    };

    try {
      const series = await fetchFxSeries(pair.from, pair.to, "full");
      const issue = series["Error Message"] || series.Note || series.Information;
      const dailySeries = series["Time Series FX (Daily)"];

      if (issue || !dailySeries) {
        logRow.status = "missing";
        logRow.error_message = issue || "No 'Time Series FX (Daily)' in Alpha Vantage response.";
        results.push({ pair: pairLabel, status: "missing" });
      } else {
        const upsertRows = Object.entries(dailySeries).map(([date, row]) => ({
          base_currency: pair.from,
          quote_currency: pair.to,
          date,
          rate: Number(row["4. close"]),
          source: "alpha_vantage",
        }));

        const { error: upsertError } = await db
          .from("fx_rates")
          .upsert(upsertRows, { onConflict: "base_currency,quote_currency,date" });

        if (upsertError) {
          logRow.status = "error";
          logRow.error_message = upsertError.message;
          results.push({ pair: pairLabel, status: "error", error: upsertError.message });
        } else {
          logRow.status = "ok";
          results.push({ pair: pairLabel, status: "ok", rows: upsertRows.length });
        }
      }
    } catch (err) {
      logRow.status = "error";
      logRow.error_message = err instanceof Error ? err.message : String(err);
      results.push({ pair: pairLabel, status: "error", error: logRow.error_message });
    }

    await db.from("benchmark_fetch_log").insert(logRow);
    await new Promise((r) => setTimeout(r, 15000));
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
