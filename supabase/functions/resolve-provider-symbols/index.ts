// Portfolio.io - resolve-provider-symbols
//
// Fills securities.data_provider_symbol for the research universe WITHOUT
// guessing: for each security with an ISIN and no symbol yet, it asks
// EODHD's search API for that ISIN and accepts a listing ONLY if the
// returned ISIN equals securities.isin (the cross-check refinement #2 of
// 0004 demands - the reason is the SPYM incident, where a plain ticker
// resolved to a different fund). Among verified listings it prefers a EUR
// line on a German/European exchange so prices need no currency
// conversion. Never overwrites an existing symbol unless {"force": true}.
//
// Call manually once after 0039 (e.g. from the Supabase dashboard's
// function tester, or `curl` with the anon key): optional body
// {"isins": ["IE00BMW3QX54"], "force": false, "dry_run": true}. A dry run
// returns what WOULD be written, so you can eyeball it first.
//
// Secrets required: EODHD_API_TOKEN. Each lookup is one EODHD API call
// (free tier: 20/day) - the default batch is capped at 8 securities.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EODHD_API_TOKEN = Deno.env.get("EODHD_API_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Preference order for the exchange part of the EODHD code. EUR-quoted
// European listings first; anything else only if nothing better verifies.
const EXCHANGE_PREFERENCE = ["XETRA", "F", "PA", "AS", "MI", "LSE", "SW"];

interface SearchHit {
  Code?: string;
  Exchange?: string;
  Name?: string;
  Currency?: string;
  ISIN?: string | null;
  previousClose?: number;
  previousCloseDate?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!EODHD_API_TOKEN) {
    return new Response(JSON.stringify({ error: "EODHD_API_TOKEN not configured" }), { status: 500, headers: CORS });
  }

  let body: { isins?: string[]; force?: boolean; dry_run?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch (_) { /* defaults */ }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let query = db.from("securities").select("id, name, isin, data_provider_symbol").not("isin", "is", null);
  if (body.isins?.length) query = query.in("isin", body.isins);
  else {
    // Default scope: the Simulator's research universe (securities with a
    // theme, set by migration 0039). Older research products are only
    // touched when asked for by ISIN - every lookup costs an API call.
    query = query.not("theme", "is", null);
    if (!body.force) query = query.is("data_provider_symbol", null);
  }
  const { data: securities, error } = await query.limit(body.limit ?? 8);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });

  const results: Record<string, unknown>[] = [];
  for (const sec of securities ?? []) {
    try {
      const res = await fetch(`https://eodhd.com/api/search/${encodeURIComponent(sec.isin)}?api_token=${EODHD_API_TOKEN}&fmt=json`);
      if (!res.ok) throw new Error(`EODHD HTTP ${res.status}`);
      const hits = (await res.json()) as SearchHit[];

      // Verified = the provider's own ISIN field equals ours. A hit with a
      // missing or different ISIN is rejected, however good its name looks.
      const verified = hits.filter((h) => h.ISIN && h.ISIN.toUpperCase() === sec.isin.toUpperCase() && h.Code && h.Exchange);
      verified.sort((a, b) => {
        const ra = EXCHANGE_PREFERENCE.indexOf(a.Exchange!), rb = EXCHANGE_PREFERENCE.indexOf(b.Exchange!);
        return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      });
      const best = verified[0];

      if (!best) {
        results.push({ isin: sec.isin, name: sec.name, status: "no-verified-listing", candidates: hits.length });
      } else {
        const symbol = `${best.Code}.${best.Exchange}`;
        if (!body.dry_run) {
          const { error: updError } = await db.from("securities")
            .update({ data_provider_symbol: symbol, price_currency: best.Currency ?? null }).eq("id", sec.id);
          if (updError) throw new Error(updError.message);
        }
        results.push({
          isin: sec.isin, name: sec.name, status: body.dry_run ? "would-set" : "set",
          symbol, currency: best.Currency, previousClose: best.previousClose, previousCloseDate: best.previousCloseDate,
          other_verified_listings: verified.slice(1, 4).map((h) => `${h.Code}.${h.Exchange} (${h.Currency})`),
        });
      }
    } catch (err) {
      results.push({ isin: sec.isin, name: sec.name, status: "error", error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return new Response(JSON.stringify({ processed: results.length, results }, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
