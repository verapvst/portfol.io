// Portfolio.io - refresh-quote
//
// "Take a live value if needed": fetches the latest EODHD quote for ONE
// security on demand (the Simulator's refresh button) and upserts it into
// daily_prices - the same table, same shape and same writer discipline as
// the nightly fetch-daily-prices, just triggered by a signed-in user
// instead of cron. Returns the observation with its price date and the
// time it was fetched, so the UI can always show how fresh the number is.
//
// Guard rails: signed-in users only (JWT checked), one security per call,
// and a 60-second per-security cooldown that returns the stored row
// instead of burning an API call (EODHD free tier: 20 calls/day).
//
// Secrets required: EODHD_API_TOKEN.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EODHD_API_TOKEN = Deno.env.get("EODHD_API_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const COOLDOWN_MS = 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!EODHD_API_TOKEN) return json({ error: "EODHD_API_TOKEN not configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "Sign in required" }, 401);

  let securityId = "";
  try { securityId = String((await req.json()).security_id ?? ""); } catch (_) { /* handled below */ }
  if (!securityId) return json({ error: "security_id required" }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: sec } = await db.from("securities").select("id, name, data_provider_symbol").eq("id", securityId).maybeSingle();
  if (!sec) return json({ error: "Unknown security" }, 404);
  if (!sec.data_provider_symbol) return json({ error: "No verified price symbol for this security yet (run resolve-provider-symbols)" }, 422);

  const { data: latest } = await db.from("daily_prices").select("date, close, fetched_at")
    .eq("security_id", securityId).order("date", { ascending: false }).limit(1).maybeSingle();
  if (latest && Date.now() - new Date(latest.fetched_at).getTime() < COOLDOWN_MS) {
    return json({ security_id: securityId, date: latest.date, close: latest.close, fetched_at: latest.fetched_at, cached: true });
  }

  const res = await fetch(`https://eodhd.com/api/real-time/${encodeURIComponent(sec.data_provider_symbol)}?api_token=${EODHD_API_TOKEN}&fmt=json`);
  if (!res.ok) return json({ error: `EODHD HTTP ${res.status}` }, 502);
  const q = await res.json();
  if (q.close === "NA" || q.close === undefined || q.timestamp === "NA" || !q.timestamp) {
    return json({ error: "Provider returned no data for this symbol right now (market closed or unlisted)" }, 404);
  }

  const date = new Date(q.timestamp * 1000).toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const { error } = await db.from("daily_prices").upsert({
    security_id: securityId, date,
    open: q.open !== "NA" ? q.open : null, high: q.high !== "NA" ? q.high : null, low: q.low !== "NA" ? q.low : null,
    close: q.close, volume: q.volume !== "NA" ? q.volume : null, source: "eodhd", fetched_at: fetchedAt,
  }, { onConflict: "security_id,date" });
  if (error) return json({ error: error.message }, 500);

  return json({ security_id: securityId, date, close: q.close, fetched_at: fetchedAt, cached: false });
});
