// Portfolio.io - fetch-inflation
//
// US CPI (monthly index level) from Alpha Vantage's CPI endpoint into
// inflation_rates (0040). The index LEVEL is stored, never a derived rate:
// year-on-year inflation = level / level 12 months earlier - 1, computed at
// read time, so nothing here needs a backfill if the derivation changes.
// Like fetch-risk-free-rate this is one call that returns the whole
// history, so it is both the backfill and the ongoing collector - safe to
// re-run (upsert). Run monthly by cron or on demand from the Simulator.
//
// Secrets required: ALPHAVANTAGE_API_KEY (same key as the other collectors).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALPHAVANTAGE_API_KEY = Deno.env.get("ALPHAVANTAGE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!ALPHAVANTAGE_API_KEY) {
    return new Response(JSON.stringify({ error: "ALPHAVANTAGE_API_KEY not configured" }), { status: 500, headers: CORS });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const logRow = {
    entity_type: "inflation" as const,
    entity_id: "cpi-us",
    symbol_used: "CPI/monthly",
    provider: "alpha_vantage",
    status: "error" as "ok" | "error" | "missing",
    error_message: null as string | null,
    http_status: null as number | null,
  };
  let payload: Record<string, unknown> = {};

  try {
    const res = await fetch(`https://www.alphavantage.co/query?function=CPI&interval=monthly&apikey=${ALPHAVANTAGE_API_KEY}`);
    logRow.http_status = res.status;
    const json = await res.json();
    const issue = json["Error Message"] || json["Note"] || json["Information"];
    const data = json.data as { date: string; value: string }[] | undefined;

    if (issue || !data) {
      logRow.status = "missing";
      logRow.error_message = issue || "No 'data' array in Alpha Vantage response.";
      payload = { status: "missing", error: logRow.error_message };
    } else {
      const rows = data
        .filter((r) => r.value !== "." && r.value != null && !Number.isNaN(Number(r.value)))
        .map((r) => ({ series: "cpi_us", date: r.date, value: Number(r.value), source: "alpha_vantage" }));
      const { error } = await db.from("inflation_rates").upsert(rows, { onConflict: "series,date" });
      if (error) {
        logRow.error_message = error.message;
        payload = { status: "error", error: error.message };
      } else {
        logRow.status = "ok";
        payload = { status: "ok", rows: rows.length, latest: rows.map((r) => r.date).sort().pop() };
      }
    }
  } catch (err) {
    logRow.error_message = err instanceof Error ? err.message : String(err);
    payload = { status: "error", error: logRow.error_message };
  }

  await db.from("benchmark_fetch_log").insert(logRow);
  return new Response(JSON.stringify(payload), { headers: { ...CORS, "Content-Type": "application/json" } });
});
