# Yadah Microfinance — API Integration Tracker

Frontend integration tracker for the **Yadah Microfinance API** (Susu collection, savings, and loans).
Stack: React Router v8 (SSR) · HeroUI v3 · Tailwind CSS v4.

- **Backend (staging):** `https://yadah-backend-staging.adamusgh.com`
- **API base path:** `/api/v1` → full base `https://yadah-backend-staging.adamusgh.com/api/v1`
- **Docs / OpenAPI:** [`/api/v1/docs`](https://yadah-backend-staging.adamusgh.com/api/v1/docs) · spec: `/api/v1/openapi.json`
- **Spec version:** `0.1.0` (OpenAPI 3)

---

## Conventions (from the spec)

| Rule | Detail |
|------|--------|
| Format | JSON, **camelCase** field names |
| Money | **Integer pesewas** — GHS 10.50 = `1050`. Never send/store floats. |
| Dates | ISO 8601, **UTC** |
| Auth | `Authorization: Bearer <accessToken>` |
| Errors | Always `{ error: { code, message, details? } }` |
| Access token | JWT, **~15 min** lifetime |
| Refresh token | Opaque, **single-use**, rotated on every refresh |

**Phone format:** `^0[25]\d{8}$` (Ghana MTN/Vodafone-style, e.g. `0241234567`, `0501234567`).
**Username format:** `^[a-z0-9._-]+$`, length 3–30.
**Password:** length 8–128 (min 8 on create; login only requires min 1).

---

## Auth model

- **Two login methods:** username+password, or phone OTP (request → verify).
- On successful login/verify → `{ user, tokens }` where `tokens = { accessToken, refreshToken }`.
- **Access token expires ~15 min** → call `POST /auth/refresh` with the current `refreshToken` to get a fresh pair. The old refresh token is invalidated (rotation) — always persist the newly returned one.
- **Logout** revokes the refresh session (`204`).

### Roles

| Role | Capabilities (from endpoint access rules) |
|------|-------------------------------------------|
| `admin` | Full: create/update staff, change roles & status |
| `manager` | Read staff (list + get one) |
| `collector` | No staff-management access (field/collection role) |

---

## Endpoint inventory & status

Legend: ⬜ not started · 🟡 in progress · ✅ done

### Auth (`tags: Auth`)

| # | Method | Path | Summary | Auth | Client fn | Status |
|---|--------|------|---------|------|-----------|--------|
| 1 | POST | `/auth/login` | Login with username + password | public | `login()` | ✅ wired (login UI) |
| 2 | POST | `/auth/otp/request` | Request a login OTP by phone | public | `requestOtp()` | ✅ wired (login UI) |
| 3 | POST | `/auth/otp/verify` | Login by verifying a phone OTP | public | `verifyOtp()` | ✅ wired (login UI) |
| 4 | POST | `/auth/refresh` | Rotate the refresh token | public (refresh token in body) | `refresh()` | ✅ wired (`withAuth` auto-refresh) |
| 5 | POST | `/auth/logout` | Logout (revoke refresh session) | public (refresh token in body) | `logout()` | ✅ wired ([logout.tsx](app/routes/logout.tsx)) |
| 6 | GET | `/auth/me` | Current authenticated user | Bearer | `me()` | 🟡 client fn only |
| 6a | POST | `/auth/password/change` | Change own password | Bearer | — | ⬜ new in spec, no client fn |
| 6b | POST | `/auth/password/forgot` | Request a password-reset OTP | public | — | ⬜ new in spec, no client fn |
| 6c | POST | `/auth/password/reset` | Reset password with a phone OTP | public | — | ⬜ new in spec, no client fn |

### Users (`tags: Users`)

| # | Method | Path | Summary | Access | Client fn | Status |
|---|--------|------|---------|--------|-----------|--------|
| 7 | POST | `/users` | Create a staff member | **admin** | `createUser()` | ✅ wired (staff drawer) |
| 8 | GET | `/users` | List staff (paginated) | admin, manager | `listUsers()` | ✅ wired (staff table) |
| 9 | GET | `/users/{id}` | Get one staff member | admin, manager | `getUser()` | 🟡 client fn only — no detail route |
| 10 | PATCH | `/users/{id}` | Update profile / role | **admin** | `updateUser()` | ✅ wired (edit drawer) |
| 11 | POST | `/users/{id}/reset-password` | Reset a staff password | **admin** | `resetUserPassword()` | ✅ wired |
| 12 | POST | `/users/{id}/disable` | Deactivate a staff member | **admin** | `disableUser()` | ✅ wired |
| 13 | POST | `/users/{id}/enable` | Reactivate a staff member | **admin** | `enableUser()` | ✅ wired (status filter) |

> Endpoints 11–13 are not in the original v0.1.0 notes below — they landed later
> and were found by re-pulling the spec. `PATCH /users/{id}` no longer accepts
> `status`; disable/enable own that now.

### Customers (`tags: Customers`)

Access: **office** = admin + manager. Collectors may list — scoped by the API to
their own assigned customers — and nothing else. They used to be able to replace
a photo; see the note under the table.

| # | Method | Path | Summary | Access | Client fn | Status |
|---|--------|------|---------|--------|-----------|--------|
| 14 | POST | `/customers` | Register a customer | **office** | `createCustomer()` | ✅ wired (`/customers/new`) |
| 15 | GET | `/customers` | List customers (paginated) | all roles | `listCustomers()` | ✅ wired (table) |
| 16 | GET | `/customers/{id}` | Get one customer | all roles | `getCustomer()` | ✅ wired (detail page) |
| 17 | PATCH | `/customers/{id}` | Update profile / reassign collector | **office** | `updateCustomer()` | ✅ wired (`?edit`, and image URLs) |
| 18 | POST | `/customers/{id}/deactivate` | Deactivate (idempotent) | **office** | `deactivateCustomer()` | ✅ wired |
| 19 | POST | `/customers/{id}/activate` | Reactivate | **office** | `activateCustomer()` | ✅ wired (status filter) |

> **Withdrawn — `POST /customers/{id}/photo` and `POST /customers/{id}/id-document`
> no longer exist.** Images go to `POST /uploads/images` and the customer record
> holds the returned URL in `photoUrl` / `idDocumentFrontUrl` /
> `idDocumentBackUrl` (the single `idDocumentUrl` is gone — the API stores both
> sides now). The photo endpoint admitted the *assigned collector*; `PATCH
> /customers/{id}` does not, so that capability is lost until the API offers a
> collector-writable path.
>
> Also new on create/update: 409 `PHONE_TAKEN` and `ID_TAKEN`.

### Uploads (`tags: Uploads`)

| # | Method | Path | Summary | Access | Client fn | Status |
|---|--------|------|---------|--------|-----------|--------|
| 20 | POST | `/uploads/images` | Upload an image, get a hosted URL | any signed-in | `uploadImage()` | ✅ wired |
| 21 | DELETE | `/uploads/images` | Remove one by `publicId` | any signed-in | `deleteImage()` | ⚠️ wrapped, unused |

Multipart part is named **`image`** (not `photo`, which is what the retired
customer endpoints wanted). `?kind=photo|document`, default `photo`; `document`
is stored at higher resolution. JPEG/PNG/WebP, max 5 MB — 413 `FILE_TOO_LARGE`,
415 `UNSUPPORTED_FILE_TYPE`. Returns `{ url, publicId }`.

> Nothing calls `deleteImage()` yet: replacing a picture overwrites the URL on
> the record and orphans the old upload rather than deleting it. Worth a pass if
> storage cost matters.

### Susu (`tags: Susu`)

One account = **one cycle of 31 deposits at a fixed daily amount**. The amount
is immutable for the cycle's life; a customer may hold several concurrent
accounts. Commission at closure is exactly one day's deposit, whatever day the
customer exits on.

`SusuAccount` now carries a six-digit **`accountNumber`**, unique and quotable —
the handle a customer reads down a phone, and the only way to look an account up
without knowing its `id`. Deposits can also answer 422 `ACCOUNT_NOT_ACTIVE`.

| # | Method | Path | Summary | Access | Client fn | Status |
|---|--------|------|---------|--------|-----------|--------|
| 22 | POST | `/susu/accounts` | Open an account | **office** | `openSusuAccount()` | ✅ wired (`/customers/:id/accounts`) |
| 23 | GET | `/susu/accounts` | List accounts (paginated) | all roles | `listSusuAccounts()` | ✅ wired (`/customers/:id/accounts`, always `customerId`-scoped); new `accountNumber` filter wrapped but unused |
| 24 | GET | `/susu/accounts/{id}` | Detail with cycle progress | all roles (scoped) | `getSusuAccount()` | ✅ wired (`/susu/:id`) |
| 25 | GET | `/susu/accounts/{id}/deposits` | Statement, newest first | all roles (scoped) | `listSusuDeposits()` | ✅ wired (grid + statement) |
| 26 | POST | `/susu/accounts/{id}/deposits` | Record a deposit / catch-up | collector (own) + office | `recordSusuDeposit()` | ✅ wired (deposit form) |
| 27 | POST | `/susu/collect-all` | One cash amount across all active accounts (atomic) | collector (own) + office | `collectAll()` | ✅ wired (`/collections`) |
| 28 | POST | `/susu/accounts/{id}/close` | Close = withdrawal | **office** | `closeSusuAccount()` | ✅ wired (confirm + figures) |
| 29 | GET | `/susu/summary` | Daily collection summary | own / office any | `getSusuSummary()` | ✅ wired (dashboard) |

**Idempotency:** endpoints 26 and 27 *require* an `idempotencyKey` (8–128 chars)
and replay the original result rather than double-recording. Mint it in the
**loader** (`newIdempotencyKey()`) and carry it in a hidden field — a key minted
in the action is new on every submit and protects nothing, and one minted during
render differs between SSR and hydration.

### Savings (`tags: Savings`)

**Not yet integrated** (7 endpoints, all live on staging). Balances are pesewas;
`availableToWithdraw` is computed server-side as balance − GHS 50 minimum
balance − GHS 10 fee, never negative. Deposits have a GHS 10 minimum;
withdrawals and closure are office-only.

---

## Request / response contracts

### 1. POST `/auth/login`
```jsonc
// body
{ "username": "string (3-30, ^[a-z0-9._-]+$)", "password": "string (>=1)" }
// 200
{ "user": PublicUser, "tokens": AuthTokens }
// 401 -> ErrorEnvelope
```

### 2. POST `/auth/otp/request`
```jsonc
// body
{ "phone": "string (^0[25]\\d{8}$)" }
// 200
{ "message": "string" }
// 429 -> ErrorEnvelope (rate limited)
```

### 3. POST `/auth/otp/verify`
```jsonc
// body
{ "phone": "string (^0[25]\\d{8}$)", "code": "string (^\\d{6}$)" }
// 200
{ "user": PublicUser, "tokens": AuthTokens }
// 401 -> ErrorEnvelope
```

### 4. POST `/auth/refresh`
```jsonc
// body
{ "refreshToken": "string (>=1)" }
// 200
{ "tokens": AuthTokens }   // <-- persist the NEW refreshToken; old one is dead
// 401 -> ErrorEnvelope
```

### 5. POST `/auth/logout`
```jsonc
// body
{ "refreshToken": "string (>=1)" }
// 204  (no content)
```

### 6. GET `/auth/me`  — `Authorization: Bearer <accessToken>`
```jsonc
// 200
{ "user": PublicUser }
// 401 -> ErrorEnvelope
```

### 7. POST `/users`  — admin only
```jsonc
// body   (required: name, username, phone, role, password)
{
  "name": "string (2-100)",
  "username": "string (3-30, ^[a-z0-9._-]+$)",
  "phone": "string (^0[25]\\d{8}$)",
  "email": "string (email format, optional)",
  "role": "admin | manager | collector",
  "password": "string (8-128)"
}
// 201 -> { "user": PublicUser }
// 403 -> ErrorEnvelope (not admin)
// 409 -> ErrorEnvelope (username/phone/email already exists)
```

### 8. GET `/users`  — admin, manager
```jsonc
// query params (all optional)
//   page   integer >=1            default 1
//   limit  integer 1-100          default 20
//   role   admin|manager|collector
//   status active|disabled
//   search string 1-100
// 200
{ "items": PublicUser[], "page": int, "limit": int, "total": int }
// 403 -> ErrorEnvelope
```

### 9. GET `/users/{id}`  — admin, manager
```jsonc
// path: id = user id (24-char hex)
// 200 -> { "user": PublicUser }
// 404 -> ErrorEnvelope
```

### 10. PATCH `/users/{id}`  — admin only
```jsonc
// path: id = user id (24-char hex)
// body (all optional; send only what changes)
{
  "name": "string (2-100)",
  "phone": "string (^0[25]\\d{8}$)",
  "email": "string (email)",
  "role": "admin | manager | collector",
  "status": "active | disabled"
}
// 200 -> { "user": PublicUser }
// 403 / 404 / 409 -> ErrorEnvelope
```

---

## Data models (`components.schemas`)

```ts
// PublicUser — required: id, name, username, phone, role
type PublicUser = {
  id: string;
  name: string;
  username: string;
  phone: string;
  email?: string;
  role: "admin" | "manager" | "collector";
};

// AuthTokens
type AuthTokens = {
  accessToken: string;   // JWT, ~15 min
  refreshToken: string;  // opaque, single-use, rotated
};

// ErrorEnvelope — every non-2xx response
type ErrorEnvelope = {
  error: {
    code: string;      // stable machine code, e.g. VALIDATION_ERROR
    message: string;
    details?: unknown; // present on VALIDATION_ERROR: array of issues
  };
};
```

> ⚠️ **Still missing from the spec:** the API is named for "Susu collection,
> savings, and loans", and as of the 2026-07-25 pull Auth, Users, Customers,
> Susu and Savings are all published — **loans are not**. Re-pull before
> building those screens. The version string is still `0.1.0` even though the
> surface has grown three times, so the version is not a reliable signal that
> nothing changed; diff the paths.

---

## Implementation plan (frontend)

### Phase 0 — Foundations
- [x] `API_BASE_URL` env config → [env.server.ts](app/lib/env.server.ts) (defaults to staging).
- [x] `app/lib/api/` folder for typed client.
- [x] Shared types (`Role`, `AuthUser`/PublicUser, `AuthTokens`) → [auth-client.ts](app/lib/auth-client.ts).
- [x] `apiFetch` wrapper: base URL, JSON, error-envelope → typed `ApiError` → [client.ts](app/lib/api/client.ts).
- [x] Client-side validators mirroring spec regex → [validation.ts](app/lib/validation.ts).
- [x] Money helpers → [money.ts](app/lib/money.ts). Amounts are parsed from the
      typed digits rather than through a float (`10.55 * 100` is
      `1054.9999999999998`), and formatted by hand rather than with
      `Intl.NumberFormat`, whose ICU data differs between the SSR runtime and
      the browser — `GH₵` vs `GHS` is a hydration mismatch you only see on
      someone else's machine.

### Phase 1 — Auth client + session
- [x] [auth.ts](app/lib/api/auth.ts): `login`, `requestOtp`, `verifyOtp`, `refresh`, `logout`, `me`.
- [x] Token storage: httpOnly signed cookie via `createCookieSessionStorage` → [session.server.ts](app/lib/session.server.ts). Tokens never reach client JS.
- [x] `requireUser()` / `getOptionalUser()` / `getAccessToken()` / `createUserSession()` / `logout()` helpers.
- [x] Auto-refresh: on `401`, `withAuth` spends the refresh token once, retries,
      and hands back a `Set-Cookie` with the rotated token → [session.server.ts](app/lib/session.server.ts).
- [ ] Rotation safety: single-flight refresh (dedupe concurrent 401s).

### Phase 2 — Auth UI
- [x] `/login` route — password form + phone-OTP tabs → [login.tsx](app/routes/login.tsx); reuses [inputs.tsx](app/components/inputs.tsx).
- [x] OTP flow: phone → request → verify, with resend / change-number; `429` handled.
- [x] Error handling: field-level + form-level, mapped from `ApiError` status/code.
- [x] Redirect flow: `requireUser` → `/login?redirectTo=…`; post-login safe redirect (open-redirect guarded).
- [x] Logout action wired to [logout.tsx](app/routes/logout.tsx).
- [x] Post-login landing: `/dashboard` inside the [app-layout.tsx](app/routes/app-layout.tsx) shell.
      Still a placeholder — it prints the session user back at them. `GET /susu/summary`
      is what belongs there.
- [ ] Password change / forgot / reset — three endpoints now in the spec, no UI.

### Phase 3 — Users / staff management
- [x] `/staff` list route — paginated table (reuse [data-table.tsx](app/components/data-table.tsx)); filters: role, status, live search.
- [ ] `/staff/:id` detail view.
- [x] Create staff form (admin only) — role select, phone/username/password validation matching spec regex.
- [x] Edit staff (admin only) — profile/role; disable/enable for status.
- [x] Role-based UI gating: hide admin-only actions from managers/collectors.
- [x] Handle `403` (forbidden) and `409` (conflict — duplicate username/phone/email) inline.
- [ ] Emptying an optional field can't clear it — omitted and "set to empty" are the same over the wire ([users.ts](app/lib/api/users.ts), [customers.tsx](app/routes/customers.tsx)).

### Phase 3.1 — Customers
- [x] Shared field primitives extracted from `staff.tsx` → [form-fields.tsx](app/components/form-fields.tsx), so both pages read as one app.
- [x] Client-safe types + enum labels → [customer-client.ts](app/lib/customer-client.ts).
- [x] `apiFetch` multipart support for the two upload endpoints → [client.ts](app/lib/api/client.ts).
- [x] `/customers` list route — table, live search, status + collector filters, pagination.
- [x] `/customers/new` + `/customers/:id/edit` — full pages, not a drawer. ~20 fields is too
      much for a slide-over, and a registration form deserves a URL you can link to and refresh.
      Both share [customer-form.tsx](app/components/customer-form.tsx) and
      [customer-form.ts](app/lib/customer-form.ts) so they can't validate differently.
- [x] The form runs as a 5-step stepper, validated per step on the way through.
      `readCustomerForm` is isomorphic — the same function the action runs also runs in the
      browser to gate each step, so there is no second copy of the rules to drift.
- [x] `/customers/:id` detail page — profile, image uploads, status switch. Editing happens in
      place behind `?edit` rather than at a route of its own; `/customers/new` is the same grid
      with every field blank. Both share
      [customer-profile.tsx](app/components/customer-profile.tsx).
- [x] **Uploads rebuilt for the new API.** `POST /customers/{id}/photo` and
      `/customers/{id}/id-document` were withdrawn; images now go to `POST /uploads/images`
      (multipart part named `image`, `?kind=photo|document`) and the URL comes back to be stored
      on the record. Wrapped in [uploads.ts](app/lib/api/uploads.ts), with the two-step dance
      shared by both pages in
      [customer-uploads.server.ts](app/lib/customer-uploads.server.ts).
      - Registration now uploads **before** it creates, which removes the half-registered case
        entirely — a rejected file fails before any customer exists.
      - `idDocumentUrl` became `idDocumentFrontUrl` + `idDocumentBackUrl`; the UI has three slots.
- [ ] **Regression from that change:** a collector can no longer replace a customer's photo. The
      retired photo endpoint admitted the assigned collector, but its replacement path
      (`PATCH /customers/{id}`) is office-only, so the upload column is hidden from collectors
      rather than offering them a guaranteed 403. Needs either a collector-writable upload path
      or an accepted loss of the field-photo flow.
- [x] 409 `PHONE_TAKEN` / `ID_TAKEN` land on the phone and ID number inputs rather than in a
      banner — both usually mean the person is already registered.
- [x] Deactivate / activate (no delete exists — history stays intact).
- [x] 403/404 from a loader render as real error pages, not "unexpected error"
      (`throwAsRouteError` in [client.ts](app/lib/api/client.ts)).
- [x] Registration doesn't ask who collects — the Assignment section is off on `/customers/new`
      and a customer is created unassigned. A collector is set later from the record, if at all.
- [x] Auto-assigning the registrar **as collector** is dropped, not deferred. It could never
      have fired: `POST /customers` is office-only and `assignedCollectorId` must be an *active
      collector* (422 INVALID_COLLECTOR), so an admin/manager's own id was never a legal value.
- [x] The registrar *is* captured, just not through that field. `registeredById` is absent from
      the request body and present on the response — the API sets it from the token that called
      `POST /customers`, so it is already the signed-in user on every record ever created. The
      record page now shows it as **Registered by** in the Assignment section, resolved through
      one `GET /users/{id}` (the collector list can't name them — the registrar is an admin or
      manager). The two are different questions: `registeredById` is who signed the customer up,
      `assignedCollectorId` is who collects from them.
- [ ] **Blocked by the API:** the intent is that any collector may collect from any customer, but
      the API still scopes a collector to the customers assigned to them — so an unassigned
      customer is today visible to *no* collector rather than all of them. Until that scoping is
      relaxed, someone registered here has to be assigned from the record page before they can be
      collected from.
- [ ] Collector select pages at 100 — the API's ceiling. Needs paging past that.
- [x] Susu / savings accounts belonging to a customer — they hang off `/customers/:id/accounts`,
      reached from the Accounts row action and the button on the detail page. One page per
      customer with a section per product, not a product picker in front of it. Savings is
      the second section once its endpoints are wired.

### Phase 3.2 — Susu
- [x] Money helpers (Phase 0) — the prerequisite, now unblocked and done.
- [x] Client-safe types, enum labels, and cycle arithmetic → [susu-client.ts](app/lib/susu-client.ts).
      The derived numbers (`remainingDeposits`, `projectedPayout`, `collectAllTotal`,
      `buildCycleSlots`) live here rather than in the routes, so the counter answer to
      "how much do I get?" can't differ between two screens.
- [x] Endpoint wrappers → [susu.ts](app/lib/api/susu.ts), mirroring [customers.ts](app/lib/api/customers.ts).
- [x] **`accountNumber`** — six digits, unique, now issued by the API. The card face prints it
      whole and no longer fakes a reference out of the last four of the `id`; that was invented
      precisely because a 24-char hex string is unquotable down a phone, and there is now a real
      one. `GET /susu/accounts?accountNumber=` is wired as a list filter.
- [ ] Nothing yet *uses* the `accountNumber` filter — a counter lookup ("customer quotes their
      number, find the account") has no screen. `SUSU_ACCOUNT_NUMBER_PATTERN` is in
      [susu-client.ts](app/lib/susu-client.ts) ready for it.
- [x] 422 `ACCOUNT_NOT_ACTIVE` on deposits — documented on the wrapper; the generic 422 path
      already surfaces its message.
- [x] Form readers → [susu-form.ts](app/lib/susu-form.ts), isomorphic like the customer
      ones: `readDepositForm` runs in the action *and* against the typed value on screen,
      so the days-left rule exists once.
- [x] Shared date formatting → [format.ts](app/lib/format.ts). Lifted out of
      `customer-detail.tsx`, which had its own copy. Reads the ISO digits rather than
      building a `Date`: local parsing shifts the day west of UTC, and locale/timezone
      formatting differs between the SSR runtime and the browser.
- [x] [susu-cycle.tsx](app/components/susu-cycle.tsx) — `CycleGrid`, `CycleBar`, `StatusPill`.
- [x] `/customers/:id/accounts` — everything one customer saves into, a section per product,
      status filter and paging over the susu table, plus open-account. A customer opens a
      fresh cycle roughly monthly (sometimes several at once), so the list is unbounded and
      is paged rather than shown whole. The daily amount is immutable, so opening confirms
      with the amount, the 31-day total, and what closing costs — a ceiling this app
      invented would eventually refuse a legitimate account, a confirmation never does.
- [x] ~~`/susu` — accounts table, status filter, pagination.~~ **Removed.** An account is
      reached through the customer who holds it; a cross-customer ledger was a second way in
      that nobody's day started from. `/collections` is the collector's daily entry point and
      the dashboard summary is the office's.
- [x] `/susu/:id` — 31-cell cycle grid, money panel, statement, deposit form, close.
      Catch-ups render dashed in the grid and as a `12–15` range in the statement, so
      the two reconcile against each other.
- [x] Record deposit (single day + catch-up), branching on `replayed` rather than on the
      status code, which `apiFetch` doesn't surface. `EXCEEDS_REMAINING` lands on the
      field with the real number; a 409 says to retry, which the carried key makes safe.
- [x] **`/collections`** — search a customer, see the per-account split, collect one
      prefilled total. `AMOUNT_MISMATCH` re-seeds the field from the API's figure rather
      than arguing with it.
- [x] Close account (office) — confirms with saved / commission / payout, warns up front
      when the deposits don't cover the commission (the `flagged` case).
- [x] Dashboard replaced with `/susu/summary`: date picker, collector filter for office,
      and the day's deposits. Collectors see their own figures; the API ignores
      `collectorId` for them, so it isn't sent.
- [x] ~~`/susu` shows one row per *account*; a customer with three accounts is three rows.~~
      Answered by removing that page: the list is now always one customer's, where several
      rows for one person is the point rather than the problem.
- [ ] No totals on `/customers/:id/accounts` — with a cycle a month, "how much has this
      customer saved with us, ever" is a fair question and the page can't answer it. Needs
      either an API roll-up or a walk of every page.
- [ ] No offline handling. A collector out of signal loses the submit — the idempotency
      key makes a retry safe, but nothing queues it for them.

### Phase 3.5 — Responsive & mobile (cross-cutting, non-negotiable)
> **Mobile-first.** Collectors work from phones in the field; admins/managers on desktop. Every screen must work from ~360px up to wide desktop. Design mobile layout first, then enhance at `sm`/`md`/`lg`/`xl`.
- [ ] Global layout: [sidebar.tsx](app/components/sidebar.tsx) collapses to a drawer/off-canvas ([side-drawer.tsx](app/components/side-drawer.tsx)) below `md`; persistent rail on `lg+`.
- [ ] Tables → cards: [data-table.tsx](app/components/data-table.tsx) reflows to stacked cards on mobile (no horizontal scroll for key data); full table on `md+`.
- [ ] Forms ([inputs.tsx](app/components/inputs.tsx)): single-column on mobile, multi-column grid on `md+`; inputs min 44px tap targets.
- [ ] Touch targets ≥44×44px; adequate spacing for thumb use on primary actions.
- [ ] Modals/drawers: full-screen sheet on mobile, centered dialog on desktop.
- [ ] Use `dvh`/`svh` (not `vh`) and safe-area insets for mobile browser chrome.
- [ ] Fluid typography and spacing; no fixed pixel widths that overflow small screens.
- [ ] Test matrix: 360px, 390px, 768px, 1024px, 1440px. Verify no horizontal body scroll at any width.
- [ ] Keep the theme toggle ([theme-toggle.tsx](app/components/theme-toggle.tsx)) reachable in both mobile and desktop chrome.

### Phase 4 — Cross-cutting
- [ ] Global error toast from `ErrorEnvelope.code` (reuse [toast.tsx](app/components/toast.tsx)).
- [ ] `VALIDATION_ERROR` → map `details` issues to field-level form errors.
- [ ] Client-side validators mirroring server regex (phone, username, password, email).
- [ ] Loading / empty / error states on all data views.

---

## Error codes seen / handled

| Code | Where | HTTP | Handling |
|------|-------|------|----------|
| `VALIDATION_ERROR` | any body validation | 400/422 | map `details` to fields |
| `UNAUTHORIZED` | any Bearer endpoint | 401 | confirmed against staging — `"Missing Bearer token"`; `withAuth` refreshes and retries |
| `EXCEEDS_REMAINING` | susu deposit | 422 | `details.remaining` → field error on days covered |
| `AMOUNT_MISMATCH` | susu collect-all | 422 | `details.required` + `details.breakdown` → re-seed the amount field |
| `NO_ACTIVE_ACCOUNTS` | susu collect-all | 422 | nothing to collect into |
| `CUSTOMER_INACTIVE` | open susu account | 422 | offer reactivation instead |
| `ALREADY_CLOSED` | susu close | 409 | someone got there first |
| (concurrent) | susu deposit | 409 | retry — the carried idempotency key makes it safe |
| (auth failure) | login/verify/refresh/me | 401 | clear session → `/login` |
| (forbidden) | users create/update/list | 403 | show "no permission" |
| (not found) | get/patch user | 404 | 404 state |
| (conflict) | create/patch user | 409 | duplicate field message |
| (rate limit) | otp/request | 429 | "try again later" |

> Fill exact `code` strings as they're observed against staging — the spec only guarantees `VALIDATION_ERROR` by name.

---

## Open questions / follow-ups
- [x] ~~Install `lucide-react`~~ — a dependency since `^1.26.0`; typecheck is green.
- [ ] **Reconcile [sidebar.tsx](app/components/sidebar.tsx) roles** — it was scaffolded with `officer`/`supervisor`/`receptionist`; the API's real roles are `admin`/`manager`/`collector` (now the source of truth in [auth-client.ts](app/lib/auth-client.ts)).
- [ ] Set a real `SESSION_SECRET` env var in staging/prod (dev fallback is insecure by design).
- [ ] Confirm exact stable error `code` values for 401/403/404/409/429 against staging.
- [ ] Confirm refresh-token storage lifetime and whether it's cookie- or client-managed.
- [x] ~~When are the Susu / Savings endpoints landing?~~ Landed — pulled 2026-07-25. **Loans still absent.**
- [ ] **`GET /susu/accounts` returns `customerId` and no name.** An id on screen is no use,
      so [susu.tsx](app/routes/susu.tsx) fetches each customer on the page — an N+1 capped
      at the page size and run in parallel. `/susu/summary` already embeds `customerName`;
      the accounts list doing the same would delete that code.
- [ ] **`GET /susu/accounts` has no `search`.** Finding an account means going through the
      customer, which is why `/susu`'s customer filter is a chip set from the customer page
      rather than a dropdown.
- [ ] Susu SMS receipts are sent by the API on deposit, collect-all and closure. Confirm
      the sender/number with the business so the UI can say what the customer will receive.
- [ ] `GET /susu/summary?date=` is an **Accra calendar day**, not UTC. Confirm how the
      API resolves "today" before showing a date picker that could straddle midnight.
- [ ] CORS: verify staging allows the frontend origin (dev `http://localhost:5173`).

---

_Spec pulled: 2026-07-25 from `/api/v1/openapi.json` (still v0.1.0 — the version does not move when endpoints land, so diff the paths). Re-pull and diff before each new feature phase._
