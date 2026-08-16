// Portfolio.io — fetch-fx-rates
//
// Scheduled Edge Function (Supabase Cron - see
// 0017_schedule_benchmark_fx_cron.sql). Nightly incremental pull
// (Alpha Vantage FX_DAILY, outputsize=compact - last ~100 days) for
// every pair in PAIRS, upserted into fx_rates. Same "compact and self-
// healing" reasoning as fetch-benchmark-history: no true delta endpoint
// exists, so re-upserting the recent window is cheap and recovers
// automatically from a missed run.
//
// Secrets required: ALPHAVANTAGE_API_KEY (same key backfill-fx-rates
// uses - Supabase dashboard -> Edge Functions -> Secrets).

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

async function fetchFxSeries(from: string, to: string): Promise<AlphaVantageFxSeries> {
  const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${from}&to_symbol=${to}&outputsize=compact&apikey=${ALPHAVANTAGE_API_KEY}`;
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
  const results: { pair: string; status: string; rows?: number }[] = [];

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
      const series = await fetchFxSeries(pair.from, pair.to);
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
        } else {
          logRow.status = "ok";
        }
        results.push({ pair: pairLabel, status: logRow.status, rows: upsertRows.length });
      }
    } catch (err) {
      logRow.status = "error";
      logRow.error_message = err instanceof Error ? err.message : String(err);
      results.push({ pair: pairLabel, status: "error" });
    }

    await db.from("benchmark_fetch_log").insert(logRow);
    await new Promise((r) => setTimeout(r, 15000));
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
