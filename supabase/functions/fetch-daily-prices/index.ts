// Portfolio.io — fetch-daily-prices
//
// Scheduled Edge Function (Supabase Cron, not called from the browser -
// see docs/production-architecture.md and supabase/migrations/0004).
// Reads securities.data_provider_symbol (set only after a human confirms
// the symbol against the real provider AND cross-checks its ISIN -
// refinement #2), fetches the latest quote for each, and UPSERTs into
// daily_prices. Never touches valuations/transactions/holdings - this is
// the one and only writer of daily_prices and price_fetch_log, nothing
// else.
//
// Provider: EODHD, not the originally-planned Twelve Data. Both Alpha
// Vantage and Twelve Data's free tiers were tested against the real 4
// ETFs before writing this file: Alpha Vantage returned empty for 3 of
// them; Twelve Data explicitly paywalls those same 3 behind a paid plan.
// Both "resolved" a plain SPYM ticker to an unrelated US S&P 500 fund,
// not the SPDR Emerging Markets UCITS ETF actually held - only caught by
// cross-checking the returned ISIN against securities.isin. EODHD's free
// tier (20 calls/day) genuinely covers all 4, verified the same way.
//
// Secrets required (Supabase dashboard -> Edge Functions -> Secrets,
// never in this file, never in the frontend):
//   EODHD_API_TOKEN
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
// Supabase runtime for every Edge Function - not set manually.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EODHD_API_TOKEN = Deno.env.get("EODHD_API_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Security {
  id: string;
  name: string;
  data_provider_symbol: string;
}

interface EodhdRealtimeQuote {
  code?: string;
  timestamp?: number | "NA";
  open?: number | "NA";
  high?: number | "NA";
  low?: number | "NA";
  close?: number | "NA";
  volume?: number | "NA";
  previousClose?: number | "NA";
}

async function fetchQuote(symbol: string): Promise<EodhdRealtimeQuote> {
  const url = `https://eodhd.com/api/real-time/${encodeURIComponent(symbol)}?api_token=${EODHD_API_TOKEN}&fmt=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`EODHD HTTP ${res.status} for ${symbol}`);
  }
  return (await res.json()) as EodhdRealtimeQuote;
}

Deno.serve(async () => {
  if (!EODHD_API_TOKEN) {
    return new Response(JSON.stringify({ error: "EODHD_API_TOKEN not configured" }), { status: 500 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: securities, error: secError } = await db
    .from("securities")
    .select("id, name, data_provider_symbol")
    .not("data_provider_symbol", "is", null);

  if (secError) {
    return new Response(JSON.stringify({ error: secError.message }), { status: 500 });
  }

  const results: { security_id: string; status: string }[] = [];

  for (const sec of securities as Security[]) {
    const logRow = {
      security_id: sec.id,
      symbol_used: sec.data_provider_symbol,
      provider: "eodhd",
      status: "error" as "ok" | "error" | "missing",
      error_message: null as string | null,
      http_status: null as number | null,
    };

    try {
      const quote = await fetchQuote(sec.data_provider_symbol);

      // EODHD returns the string "NA" (not an error object) for a symbol
      // with no data on this call - a market holiday, an unlisted
      // instrument, or (per the header comment) a symbol that silently
      // resolves nowhere. Never treated as 0 or skipped silently.
      if (quote.close === "NA" || quote.close === undefined || quote.timestamp === "NA" || !quote.timestamp) {
        logRow.status = "missing";
        logRow.error_message = "EODHD returned no data (NA) for this symbol on this call.";
      } else {
        const date = new Date(quote.timestamp * 1000).toISOString().slice(0, 10);

        const { error: upsertError } = await db.from("daily_prices").upsert(
          {
            security_id: sec.id,
            date,
            open: quote.open !== "NA" ? quote.open : null,
            high: quote.high !== "NA" ? quote.high : null,
            low: quote.low !== "NA" ? quote.low : null,
            close: quote.close,
            volume: quote.volume !== "NA" ? quote.volume : null,
            source: "eodhd",
          },
          { onConflict: "security_id,date" } // idempotent - refinement #8
        );

        if (upsertError) {
          logRow.status = "error";
          logRow.error_message = upsertError.message;
        } else {
          logRow.status = "ok";
        }
      }
    } catch (err) {
      logRow.status = "error";
      logRow.error_message = err instanceof Error ? err.message : String(err);
    }

    await db.from("price_fetch_log").insert(logRow);
    results.push({ security_id: sec.id, status: logRow.status });

    // EODHD free tier: 20 calls/day total - a small delay is just good
    // manners here, the real ceiling is the daily count, not per-minute.
    await new Promise((r) => setTimeout(r, 500));
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
