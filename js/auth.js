/* ============================================================
   auth.js - real Supabase Auth (email + password).

   Deliberately separate from shell.js's Owner Access: Owner Access is a
   client-side money-visibility toggle - it controls what you SEE, and its
   own comment says plainly it isn't real security. This is real,
   server-enforced auth. The session created here is what every RLS policy
   in supabase/migrations/0001_initial_schema.sql checks before allowing a
   write - it controls what you can WRITE. The two are expected to converge
   into the Admin-mode elevation described in the Migration Plan's Phase 5;
   until then they're two independent mechanisms on purpose.
   ============================================================ */

let authSession = null;
const authListeners = [];

function onAuthChange(fn) {
  authListeners.push(fn);
}

function currentUser() {
  return authSession?.user || null;
}

async function initAuth() {
  if (!window.db) return;
  const { data } = await window.db.auth.getSession();
  authSession = data.session;
  authListeners.forEach((fn) => fn(authSession));

  window.db.auth.onAuthStateChange((_event, session) => {
    authSession = session;
    authListeners.forEach((fn) => fn(authSession));
  });
}

async function signIn(email, password) {
  if (!window.db) throw new Error("Supabase not configured yet.");
  const { data, error } = await window.db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOutUser() {
  if (!window.db) return;
  await window.db.auth.signOut();
}

/* ---------- Auth button (topbar) + modal ---------- */

function initAuthButton(container) {
  if (!container) return;
  initValuesToggle(document.getElementById("values-toggle-slot"));
  onAuthChange(() => initValuesToggle(document.getElementById("values-toggle-slot")));

  const btn = document.createElement("button");
  btn.id = "auth-btn";
  btn.className = "topbar-pill-btn glass-quiet";
  btn.type = "button";

  const render = () => {
    const u = currentUser();
    btn.innerHTML = u
      ? `👤 <span class="label">${u.email}</span>`
      : `👤 <span class="label">Sign In</span>`;
    btn.setAttribute("aria-label", u ? "Sign out" : "Sign in");
  };
  render();

  btn.addEventListener("click", () => {
    if (currentUser()) {
      if (confirm(`Signed in as ${currentUser().email}. Sign out?`)) signOutUser();
    } else {
      window.openAuthModal();
    }
  });

  onAuthChange(render);
  container.appendChild(btn);
}

/** Sign-in only, deliberately - no sign-up flow anywhere in the UI.
    Portfol.io has exactly one legitimate user; a public visitor being
    able to self-register was never a feature, and per the three-layer
    access model (docs/production-architecture.md, extended) a random
    link recipient should land in Showcase, not be invited to create an
    account. Removed at the UI level here; disabling email sign-up in
    the Supabase project's own Auth settings is the matching
    database-level lock and isn't something this codebase can do for
    itself (that's a dashboard setting, not a migration). Even without
    that second lock, RLS already scopes every private table to
    `user_id = auth.uid()` - a hypothetical extra account could only
    ever see its own empty portfolio, never Vera's real one - so this
    is about not inviting confusion, not closing a data leak. */
function initAuthModal() {
  if (document.getElementById("auth-modal-root")) return;

  const root = document.createElement("div");
  root.id = "auth-modal-root";
  root.innerHTML = `
    <div id="auth-modal-backdrop"></div>
    <div id="auth-modal" class="glass" role="dialog" aria-modal="true" aria-label="Sign in">
      <h2 class="owner-modal-title" id="auth-modal-title">Sign In</h2>
      <p class="owner-modal-label">Email</p>
      <input id="auth-email-input" class="owner-modal-input" type="email" autocomplete="username" spellcheck="false"/>
      <p class="owner-modal-label">Password</p>
      <input id="auth-password-input" class="owner-modal-input" type="password" autocomplete="current-password"/>
      <p class="owner-modal-error" id="auth-modal-error"></p>
      <button id="auth-modal-submit" class="owner-modal-submit" type="button">Sign In</button>
    </div>`;
  document.body.appendChild(root);

  const emailInput = root.querySelector("#auth-email-input");
  const passwordInput = root.querySelector("#auth-password-input");
  const errorEl = root.querySelector("#auth-modal-error");
  const submitBtn = root.querySelector("#auth-modal-submit");

  const close = () => {
    root.classList.remove("open");
    emailInput.value = "";
    passwordInput.value = "";
    errorEl.textContent = "";
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  const open = () => {
    root.classList.add("open");
    document.addEventListener("keydown", onKey);
    setTimeout(() => emailInput.focus(), 50);
  };

  const attempt = async () => {
    errorEl.textContent = "";
    submitBtn.disabled = true;
    try {
      await signIn(emailInput.value.trim(), passwordInput.value);
      close();
    } catch (err) {
      errorEl.style.color = "var(--negative)";
      errorEl.textContent = err.message || "Something went wrong.";
    }
    submitBtn.disabled = false;
  };

  root.querySelector("#auth-modal-backdrop").addEventListener("click", close);
  submitBtn.addEventListener("click", attempt);
  passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });

  window.openAuthModal = open;
  window.closeAuthModal = close;
}
