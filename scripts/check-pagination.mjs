#!/usr/bin/env node
/**
 * Probe whether the Yadah backend honours `page` and `limit`.
 *
 * The frontend can't tell "the API ignored my limit" from "the table failed to
 * slice" — both look like every row on every page. This hits the paginated
 * endpoints directly and reports, per endpoint:
 *
 *   - whether `items.length` respects the requested `limit`
 *   - whether the echoed `page` / `limit` match what was asked for
 *   - whether page 2 actually returns different records from page 1
 *
 * A companion to check-user-search.mjs, which asks the same question of
 * `?search=`.
 *
 * Usage:
 *   node scripts/check-pagination.mjs
 *   node scripts/check-pagination.mjs --admin-username you --admin-password ***
 *
 * Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD or the flags above.
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
if (!username || !password) {
  fail(
    "admin credentials missing (set ADMIN_USERNAME/ADMIN_PASSWORD or pass --admin-username/--admin-password)",
  );
}

async function api(path, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `${res.status} ${path} — ${body?.error?.code ?? "?"}: ${body?.error?.message ?? res.statusText}`,
    );
  }
  return body;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** The `id`s on a page, so two pages can be compared for overlap. */
const idsOf = (body) => (body.items ?? []).map((item) => item.id);

async function probe(label, path, token) {
  console.log(`\n── ${label} (${path}) ──`);

  const LIMIT = 2;
  let first;
  try {
    first = await api(`${path}?page=1&limit=${LIMIT}`, token);
  } catch (error) {
    console.log(`  ✗ ${error.message}`);
    return;
  }

  const { total } = first;
  console.log(
    `  asked page=1 limit=${LIMIT} → items=${first.items?.length ?? "?"} page=${first.page} limit=${first.limit} total=${total}`,
  );

  // 1. Does the response body echo the fields the table's controlled mode
  //    needs? A missing `page` turns pagination off entirely in the UI.
  for (const field of ["items", "page", "limit", "total"]) {
    if (first[field] === undefined) {
      console.log(`  ✗ response has no \`${field}\` — the pager can't work without it`);
    }
  }

  // 2. Is `limit` respected? This is the one that renders every row on every
  //    page.
  const returned = first.items?.length ?? 0;
  if (total > LIMIT && returned > LIMIT) {
    console.log(
      `  ✗ LIMIT IGNORED — asked for ${LIMIT}, got ${returned} of ${total}. The API is returning the whole collection.`,
    );
  } else if (returned <= LIMIT) {
    console.log(`  ✓ limit respected (${returned} ≤ ${LIMIT})`);
  }

  // 3. Is `page` respected? Compare page 2's ids against page 1's.
  if (total > LIMIT) {
    const second = await api(`${path}?page=2&limit=${LIMIT}`, token);
    const a = new Set(idsOf(first));
    const b = idsOf(second);
    const overlap = b.filter((id) => a.has(id));
    if (b.length === 0) {
      console.log(`  ! page 2 is empty though total=${total}`);
    } else if (overlap.length === b.length) {
      console.log(`  ✗ PAGE IGNORED — page 2 returned the same records as page 1`);
    } else if (overlap.length > 0) {
      console.log(`  ! page 2 overlaps page 1 by ${overlap.length} record(s)`);
    } else {
      console.log(`  ✓ page respected (page 2 is a different set)`);
    }
  } else {
    console.log(`  · only ${total} record(s) — not enough to test paging`);
  }
}

async function login() {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(
      `login failed — ${body?.error?.code ?? res.status}: ${body?.error?.message ?? res.statusText}`,
    );
  }
  return body;
}

const { tokens } = await login();
const token = tokens?.accessToken;
if (!token) fail("login returned no access token");
console.log(`✓ signed in as ${username}`);

await probe("Customers", "/customers", token);
await probe("Loans", "/loans", token);
await probe("Staff", "/users", token);
await probe("Susu accounts", "/susu/accounts", token);
await probe("Savings accounts", "/savings/accounts", token);

console.log(
  "\nIf a `LIMIT IGNORED` line appeared, the fix is on the API — the table now\nslices locally as a floor, but every row is still being downloaded.",
);
