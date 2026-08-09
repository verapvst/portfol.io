// Portfolio.io — backfill-daily-prices
//
// One-time (or occasionally re-run) historical backfill - deliberately
// a SEPARATE function from fetch-daily-prices, not the same function
// with a mode flag. The two are genuinely different operations: this
// one does a bulk historical pull per security (EODHD's /api/eod/
// endpoint, up to the free tier's own limit - the past year only,
// confirmed 2026-08-09), fetch-daily-prices does one incremental
// "today's quote" per security on a schedule. Keeping them separate
// functions matches how differently they're actually invoked (this one
// by hand, occasionally; that one by cron, daily) rather than forcing
// one function to serve two call patterns.
//
// Same security set as fetch-daily-prices (anything with a
// data_provider_symbol set), same upsert-on-conflict idempotency (safe
// to re-run - re-fetching a date already in daily_prices just
// overwrites it with the same or refreshed value, never duplicates),
// same price_fetch_log audit trail (one row per security PER RUN, not
// per day - logging 365 rows for one backfilled security would drown
// out the real signal fetch-daily-prices's log already provides).
//
// Secrets required: EODHD_API_TOKEN (same one fetch-daily-prices
// already uses - Supabase dashboard -> Edge Functions -> Secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EODHD_API_TOKEN = Deno.env.get("EODHD_API_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Security {
  id: string;
  name: string;
  data_provider_symbol: string;
}

interface EodhdEodRow {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjusted_close: number | null;
  volume: number | null;
}

async function fetchHistory(symbol: string, from: string, to: string): Promise<EodhdEodRow[]> {
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${EODHD_API_TOKEN}&from=${from}&to=${to}&period=d&fmt=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`EODHD HTTP ${res.status} for ${symbol}`);
  }
  const body = await res.json();
  // A symbol with no history at all (or an EODHD error shape) comes
  // back as something other than an array - treated as "no rows",
  // never as a crash, matching fetch-daily-prices's own "NA is not an
  // error" discipline.
  return Array.isArray(body) ? body : [];
}

Deno.serve(async (req) => {
  if (!EODHD_API_TOKEN) {
    return new Response(JSON.stringify({ error: "EODHD_API_TOKEN not configured" }), { status: 500 });
  }

  // Optional override via POST body: { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }.
  // Defaults to the free tier's own real limit (the past year) through
  // today - not a guessed window, the one EODHD's docs actually state.
  let from: string, to: string;
  try {
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    from = body.from || oneYearAgo.toISOString().slice(0, 10);
    to = body.to || today.toISOString().slice(0, 10);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: securities, error: secError } = await db
    .from("securities")
    .select("id, name, data_provider_symbol")
    .not("data_provider_symbol", "is", null);

  if (secError) {
    return new Response(JSON.stringify({ error: secError.message }), { status: 500 });
  }

  const results: { security_id: string; name: string; status: string; rows?: number; error?: string }[] = [];

  for (const sec of securities as Security[]) {
    const logRow = {
      security_id: sec.id,
      symbol_used: sec.data_provider_symbol,
      provider: "eodhd-backfill",
      status: "error" as "ok" | "error" | "missing",
      error_message: null as string | null,
      http_status: null as number | null,
    };

    try {
      const rows = await fetchHistory(sec.data_provider_symbol, from, to);

      if (!rows.length) {
        logRow.status = "missing";
        logRow.error_message = `No historical rows returned for ${from} to ${to}.`;
        results.push({ security_id: sec.id, name: sec.name, status: "missing" });
      } else {
        const upsertRows = rows
          .filter((r) => r.close !== null && r.close !== undefined)
          .map((r) => ({
            security_id: sec.id,
            date: r.date,
            open: r.open,
            high: r.high,
            low: r.low,
            close: r.close,
            adjusted_close: r.adjusted_close,
            volume: r.volume,
            source: "eodhd",
          }));

        const { error: upsertError } = await db
          .from("daily_prices")
          .upsert(upsertRows, { onConflict: "security_id,date" });

        if (upsertError) {
          logRow.status = "error";
          logRow.error_message = upsertError.message;
          results.push({ security_id: sec.id, name: sec.name, status: "error", error: upsertError.message });
        } else {
          logRow.status = "ok";
          results.push({ security_id: sec.id, name: sec.name, status: "ok", rows: upsertRows.length });
        }
      }
    } catch (err) {
      logRow.status = "error";
      logRow.error_message = err instanceof Error ? err.message : String(err);
      results.push({ security_id: sec.id, name: sec.name, status: "error", error: logRow.error_message });
    }

    await db.from("price_fetch_log").insert(logRow);

    // Free tier: 20 calls/day total, same ceiling as fetch-daily-prices -
    // a courteous delay between calls, not the real limiting factor.
    await new Promise((r) => setTimeout(r, 500));
  }

  return new Response(JSON.stringify({ from, to, processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
