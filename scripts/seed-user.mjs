#!/usr/bin/env node
/**
 * Seed a staff user on the Yadah backend.
 *
 * `POST /users` is admin-only, so this logs in as an existing admin to get a
 * bearer token, then creates the new user. Nothing is hardcoded — the API URL
 * and admin credentials come from the environment (.env is auto-loaded).
 *
 * Usage:
 *   node scripts/seed-user.mjs \
 *     --name "Ama Mensah" --username ama.mensah --phone 0241234567 \
 *     --role collector --password "S3cret!pass" [--email ama@example.com]
 *
 * Admin credentials (to authorize the create) come from env vars
 *   ADMIN_USERNAME, ADMIN_PASSWORD
 * or flags --admin-username / --admin-password.
 */

// Load .env into process.env (Node >= 20.12). Safe if the file is missing.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env — rely on real environment variables
}

const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/$/, "");
if (!API_BASE_URL) {
  fail("API_BASE_URL is not set (add it to .env or export it).");
}

// ---- parse CLI flags -------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Seed a staff user.",
      "",
      "  --name       Full name (2–100 chars)              [required]",
      "  --username   3–30 chars, [a-z0-9._-]              [required]",
      "  --phone      Ghana number, e.g. 0241234567        [required]",
      "  --role       admin | manager | collector          [required]",
      "  --password   8–128 chars                           [required]",
      "  --email      optional",
      "",
      "Admin auth (to authorize creation):",
      "  --admin-username / ADMIN_USERNAME",
      "  --admin-password / ADMIN_PASSWORD",
    ].join("\n"),
  );
  process.exit(0);
}

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

const newUser = {
  name: flag("name"),
  username: flag("username"),
  phone: flag("phone"),
  role: flag("role"),
  password: flag("password"),
  ...(flag("email") ? { email: flag("email") } : {}),
};

const adminUsername = flag("admin-username") ?? process.env.ADMIN_USERNAME;
const adminPassword = flag("admin-password") ?? process.env.ADMIN_PASSWORD;

// ---- validate (mirror the OpenAPI constraints) -----------------------------
const errors = [];
if (!newUser.name || newUser.name.length < 2 || newUser.name.length > 100)
  errors.push("name must be 2–100 characters");
if (!newUser.username || !/^[a-z0-9._-]{3,30}$/.test(newUser.username))
  errors.push("username must be 3–30 chars of [a-z0-9._-]");
if (!newUser.phone || !/^0[25]\d{8}$/.test(newUser.phone))
  errors.push("phone must match 0[25]xxxxxxxx (e.g. 0241234567)");
if (!["admin", "manager", "collector"].includes(newUser.role))
  errors.push("role must be admin, manager, or collector");
if (!newUser.password || newUser.password.length < 8 || newUser.password.length > 128)
  errors.push("password must be 8–128 characters");
if (!adminUsername || !adminPassword)
  errors.push(
    "admin credentials missing (set ADMIN_USERNAME/ADMIN_PASSWORD or pass --admin-username/--admin-password)",
  );
if (errors.length) fail("Invalid input:\n  - " + errors.join("\n  - "));

// ---- run -------------------------------------------------------------------
async function api(path, { json, token } = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = payload?.error ?? { message: res.statusText };
    throw new Error(`${res.status} ${err.code ?? ""} — ${err.message ?? "request failed"}`.trim());
  }
  return payload;
}

try {
  console.log(`→ ${API_BASE_URL}`);
  console.log(`→ authenticating as admin "${adminUsername}"…`);
  const { tokens } = await api("/auth/login", {
    json: { username: adminUsername, password: adminPassword },
  });

  console.log(`→ creating ${newUser.role} "${newUser.username}"…`);
  const created = await api("/users", { json: newUser, token: tokens.accessToken });

  const u = created.user ?? created;
  console.log("\n✅ User created:");
  console.log(
    JSON.stringify(
      { id: u.id, name: u.name, username: u.username, phone: u.phone, role: u.role, email: u.email },
      null,
      2,
    ),
  );
  console.log(`\nThey can now sign in at /login with username "${newUser.username}".`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
