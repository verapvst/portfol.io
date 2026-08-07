// Portfolio.io — Supabase client init.
// Depends on supabaseConfig.js (window.SUPABASE_CONFIG) and the Supabase
// JS library loaded before this script — see index.html/data-hub.html.
//
// window.db is the single client every page's data-access code should use.
// Stays undefined (with a console warning, not a thrown error) until
// supabaseConfig.js is actually filled in, so the rest of the app can keep
// running on the existing repository.js mock data in the meantime.

(function () {
  const { url, anonKey } = window.SUPABASE_CONFIG || {};

  if (!url || !anonKey) {
    console.warn(
      "Supabase not configured yet — fill in js/supabaseConfig.js. " +
      "Falling back to repository.js mock data."
    );
    window.db = null;
    return;
  }

  window.db = window.supabase.createClient(url, anonKey);
})();
