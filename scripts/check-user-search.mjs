#!/usr/bin/env node
/**
 * Probe `GET /users?search=…` on the Yadah backend.
 *
 * The frontend can't tell "the API ignored my filter" from "nothing matched",
 * so this hits the endpoint directly: it fetches the unfiltered page, then
 * re-requests it with a search term and reports whether the result set
 * actually narrowed. Case and partial-match behaviour are probed too, since
 * those are the usual reasons a search "does nothing".
 *
 * Usage:
 *   node scripts/check-user-search.mjs [term]
 *
 * Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD (or the flags
 * --admin-username / --admin-password). With no [term], a substring of the
 * first listed staff member's name is used.
 */

try {
  process.loadEnvFile(".env");
} catch {
  // no .env — rely on real environment variables
}

const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/$/, "");
if (!API_BASE_URL) fail("API_BASE_URL is not set (add it to .env or export it).");

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}
const username = flag("admin-username") ?? process.env.ADMIN_USERNAME;
const password = flag("admin-password") ?? process.env.ADMIN_PASSWORD;
if (!username || !password)
  fail(
    "admin credentials missing (set ADMIN_USERNAME/ADMIN_PASSWORD or pass --admin-username/--admin-password)",
  );

// The first bare argument is the search term; skip flags and their values.
const termArg = (() => {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      i++; // its value
      continue;
    }
    return args[i];
  }
  return undefined;
})();

async function api(path, { method = "GET", json, token } = {}) {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
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
    throw new Error(
      `${method} ${url} → ${res.status} ${err.code ?? ""} — ${err.message ?? "request failed"}`.trim(),
    );
  }
  return { payload, url };
}

/** One `GET /users` call; prints the request line and a one-line summary. */
async function list(token, query) {
  const qs = new URLSearchParams(query).toString();
  const { payload, url } = await api(`/users${qs ? `?${qs}` : ""}`, { token });
  const names = payload.items.map((u) => `${u.name} (${u.username})`);
  console.log(`\n→ ${url}`);
  console.log(`  total=${payload.total} returned=${payload.items.length}`);
  for (const n of names.slice(0, 10)) console.log(`    · ${n}`);
  if (names.length > 10) console.log(`    … ${names.length - 10} more`);
  return payload;
}

try {
  console.log(`→ ${API_BASE_URL}`);
  const { payload: auth } = await api("/auth/login", {
    method: "POST",
    json: { username, password },
  });
  const token = auth.tokens.accessToken;
  console.log(`✓ authenticated as "${username}" (${auth.user?.role ?? "?"})`);

  // Baseline: what the page shows with no search term at all.
  const base = await list(token, { page: "1", limit: "20", status: "active" });
  if (!base.items.length) fail("No active staff returned — nothing to search against.");

  const sample = base.items[0];
  // Middle-of-string slice, so a prefix-only backend implementation shows up
  // as a miss rather than a false pass.
  const term = termArg ?? sample.name.split(" ")[0];
  const partial = term.slice(1, Math.max(2, term.length - 1)) || term;

  const cases = [
    { label: "exact word from a known name", search: term },
    { label: "lowercased", search: term.toLowerCase() },
    { label: "UPPERCASED", search: term.toUpperCase() },
    { label: "partial / substring", search: partial },
    { label: "username", search: sample.username },
    { label: "phone", search: sample.phone },
    { label: "no-match sentinel", search: "zzzznomatchzzzz" },
  ];

  const results = [];
  for (const c of cases) {
    const r = await list(token, {
      page: "1",
      limit: "20",
      status: "active",
      search: c.search,
    });
    results.push({ ...c, total: r.total, count: r.items.length });
  }

  console.log("\n──────── summary ────────");
  console.log(`baseline (no search): total=${base.total}`);
  for (const r of results)
    console.log(
      `  ${String(r.total).padStart(4)}  ${r.label.padEnd(30)} search=${JSON.stringify(r.search)}`,
    );

  const sentinel = results.at(-1);
  if (sentinel.total === base.total) {
    console.log(
      "\n✗ The API IGNORES `search`: a term that matches nothing returned the full list.",
    );
  } else {
    console.log("\n✓ The API honours `search` (the sentinel term narrowed the list).");
    const misses = results
      .slice(0, -1)
      .filter((r) => r.total === 0)
      .map((r) => r.label);
    if (misses.length)
      console.log(`  …but these returned 0 results: ${misses.join(", ")}`);
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
