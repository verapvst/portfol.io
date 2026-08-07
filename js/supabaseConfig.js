// Portfolio.io — Supabase connection config.
//
// The anon/public key is safe to ship in client-side code by design — it's
// what Supabase expects to sit in a browser. Row Level Security (see
// supabase/migrations/0001_initial_schema.sql) is what actually protects
// the data, not keeping this key secret. Never put the service_role key
// here or anywhere in this app — that one bypasses RLS entirely and must
// never leave the Supabase dashboard / server-side tooling.
//
// Fill these in once the project exists: Supabase Dashboard -> Project
// Settings -> API -> "Project URL" and "anon public" key.
window.SUPABASE_CONFIG = {
  url: "https://mdsjlaniascmrktxvezh.supabase.co",
  anonKey: "sb_publishable_3fKyaMC4Hn6x8RYBR5jJ2g_gNEwnLfG",
};
