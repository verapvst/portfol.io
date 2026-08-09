/* ============================================================
   db.js - shared Supabase data-access helpers, used by every CRUD page
   (accounts.js, transactions.js, ...). Extracted once a second page
   needed ensurePortfolio()/findOrCreateInstitution() rather than
   duplicating them - the reference-data lookups in particular (find by
   name before creating) need to stay identical everywhere or the same
   institution/security starts silently duplicating per page.
   ============================================================ */

function $(id) { return document.getElementById(id); }

/** Every signed-in user needs exactly one portfolio to hang everything
    else off of. Created lazily on first visit to any CRUD page, not a
    separate "set up your portfolio" step.

    Visiting two pages in quick succession used to be able to run the
    "does one exist?" check on both before either insert committed, so
    both concluded "no" and both created a row - confirmed in production
    as three duplicate portfolios for one user. supabase/migrations/
    0003_portfolio_unique_and_dedupe.sql adds a unique constraint on
    user_id so a second concurrent insert now fails loudly (23505)
    instead of silently duplicating; caught here and turned into a
    re-read of the row the other call just created. */
async function ensurePortfolio() {
  const user = currentUser();
  if (!user) return null;

  const { data: existing, error } = await window.db
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);
  if (error) throw error;
  if (existing && existing.length) return existing[0].id;

  const { data: created, error: insertError } = await window.db
    .from("portfolios")
    .insert({ user_id: user.id, name: "My Portfolio", base_currency: "EUR" })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: retry, error: retryError } = await window.db
        .from("portfolios")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .single();
      if (retryError) throw retryError;
      return retry.id;
    }
    throw insertError;
  }
  return created.id;
}

async function loadInstitutions() {
  const { data, error } = await window.db.from("institutions").select("*").order("name");
  if (error) throw error;
  return data || [];
}

/** Institutions/Securities are shared reference data (Migration Plan
    §2.1/§2.2) - find by case- AND diacritic-insensitive name before
    creating (normalizeName(), utils.js), so typing "BPI" on two
    different pages, or a BPI PDF printing "BPI DINAMICO" without the
    accent, never produces a second row. `cache` is the caller's
    already-loaded array (kept in sync by pushing the new row on
    creation), not re-fetched here, so repeated lookups in one form
    session don't re-query. */
async function findOrCreateInstitution(name, cache) {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const existing = cache.find((i) => normalizeName(i.name) === normalizeName(trimmed));
  if (existing) return existing.id;

  const { data, error } = await window.db.from("institutions").insert({ name: trimmed }).select("id").single();
  if (error) throw error;
  cache.push({ id: data.id, name: trimmed });
  return data.id;
}

async function loadAccountsForPortfolio(portfolioId) {
  const { data, error } = await window.db
    .from("accounts")
    .select("*, institutions(id, name)")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadSecurities() {
  const { data, error } = await window.db.from("securities").select("*").order("name");
  if (error) throw error;
  return data || [];
}

/** Same find-or-create-by-name pattern as institutions. Captures only the
    minimal fields a Transaction needs to reference a security by - full
    Securities reference-data editing (ISIN, asset class, benchmark, ...)
    is its own future module (Migration Plan §2.2), not this form's job. */
async function findOrCreateSecurity({ name, type, currency }, cache) {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const existing = cache.find((s) => normalizeName(s.name) === normalizeName(trimmed));
  if (existing) return existing.id;

  const { data, error } = await window.db
    .from("securities")
    .insert({ name: trimmed, type, currency })
    .select("*")
    .single();
  if (error) throw error;
  cache.push(data);
  return data.id;
}

/** Securities's data source (supabase/migrations/0005/0006). Inner
    join on purpose - a security with no security_details row isn't a
    researchable product yet, so it has no place in this list (it might
    just be a plain holding created via Transactions, with no product
    research attached). Requires signing in, same as every other
    authenticated-only table today - see 0005_product_database.sql's own
    comment for why this isn't anon-readable yet. */
async function loadProductLibrary() {
  const { data, error } = await window.db
    .from("security_details")
    .select("*, securities!inner(id, name, type, isin, domicile, currency, benchmark, asset_class, institutions(name))")
    .order("name", { foreignTable: "securities" });
  if (error) throw error;
  return data || [];
}

async function loadProductDetail(securityId) {
  const { data, error } = await window.db
    .from("security_details")
    .select("*, securities!inner(id, name, type, isin, domicile, currency, benchmark, asset_class, institutions(name))")
    .eq("security_id", securityId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Whether the signed-in user actually holds this security (vs. just
    researching it) - a real transactions check, not inferred from the
    product catalogue itself, so a researched-but-never-bought product
    never gets mislabelled as held. */
async function isSecurityHeld(portfolioId, securityId) {
  const { data, error } = await window.db
    .from("transactions")
    .select("id")
    .eq("portfolio_id", portfolioId)
    .eq("security_id", securityId)
    .limit(1);
  if (error) throw error;
  return !!(data && data.length);
}

async function loadBrokers() {
  const { data, error } = await window.db.from("brokers").select("*").order("name");
  if (error) throw error;
  return data || [];
}
