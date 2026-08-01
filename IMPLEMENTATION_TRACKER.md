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

Access: **office** = admin + manager. Collectors may read and nothing else —
**every role now sees every customer**, the API's own words being *"All roles see
all customers."* The scoping that once narrowed a collector to their assigned
customers is gone, and `assignedCollectorId` with it. Collectors used to be able
to replace a photo; see the note under the table.

| # | Method | Path | Summary | Access | Client fn | Status |
|---|--------|------|---------|--------|-----------|--------|
| 14 | POST | `/customers` | Register a customer | **office** | `createCustomer()` | ✅ wired (`/customers/new`) |
| 15 | GET | `/customers` | List customers (paginated) | all roles | `listCustomers()` | ✅ wired (table) |
| 16 | GET | `/customers/{id}` | Get one customer | all roles | `getCustomer()` | ✅ wired (detail page) |
| 17 | PATCH | `/customers/{id}` | Update customer profile | **office** | `updateCustomer()` | ✅ wired (`?edit`, and image URLs) |
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

Two changes from the 2026-07-26 pull:

- **`dailyAmount` has a floor of `500`** (GHS 5). It used to accept a single
  pesewa. Mirrored as `SUSU_MIN_DAILY_AMOUNT` in
  [susu-client.ts](app/lib/susu-client.ts) and enforced by `readOpenAccountForm`
  — without it the form takes GHS 1.00 and the API answers a 400 whose message
  names no field.
- **All roles see all accounts, and any collector may record a deposit on any of
  them.** Same relaxation as customers; see the note under that table.

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

An open-ended balance, not a cycle — which is the whole of the difference from
susu. Money goes in any day (**GHS 10 minimum** a deposit); money comes out
against three rules that between them explain every figure on the screens:

| Rule | Detail |
|------|--------|
| Minimum balance | **GHS 50** must stay in an open account. Only closure releases it. |
| Withdrawal fee | **GHS 10**, flat, on every withdrawal — and once more on closure. |
| One per day | One withdrawal per **Accra calendar day**, and a closure counts as one. |

`availableToWithdraw` is computed server-side as balance − minimum − fee, never
negative, and is **read rather than recomputed** — a balance can look ample and
still refuse a withdrawal, which is why the account page shows the split.

Access splits on direction: all roles see all accounts and anyone may pay *in*;
opening, withdrawing and closing are office-only.

| # | Method | Path | Summary | Access | Client fn | Status |
|---|--------|------|---------|--------|-----------|--------|
| 30 | POST | `/savings/accounts` | Open (optional `initialDeposit`) | **office** | `openSavingsAccount()` | ✅ wired (`/customers/:id/accounts`) |
| 31 | GET | `/savings/accounts` | List accounts (paginated) | all roles | `listSavingsAccounts()` | ✅ wired (savings section) |
| 32 | GET | `/savings/accounts/{id}` | Detail with `availableToWithdraw` | all roles | `getSavingsAccount()` | ✅ wired (`/savings/:id`) |
| 33 | GET | `/savings/accounts/{id}/transactions` | Statement, newest first | all roles | `listSavingsTxns()` | ✅ wired (statement) |
| 34 | POST | `/savings/accounts/{id}/deposits` | Record a deposit | any collector + office | `recordSavingsDeposit()` | ✅ wired (deposit drawer) |
| 35 | POST | `/savings/accounts/{id}/withdrawals` | Process a withdrawal | **office** | `recordSavingsWithdrawal()` | ✅ wired (withdraw drawer) |
| 36 | POST | `/savings/accounts/{id}/close` | Close = final payout | **office** | `closeSavingsAccount()` | ✅ wired (confirm + figures) |

> **`accountNumber` is ten digits here, not six.** A field built for a susu
> number silently refuses a savings one, which is why the lookup field on
> `/customers/:id/accounts` takes its length from the selected product and the
> product switch clears whatever was typed.
>
> **`amount` on a withdrawal is what the customer *receives*.** The fee is
> debited on top, so the balance falls by `amount + 1000`. Sending the total to
> debit would short the customer by ten cedis.
>
> **Idempotency:** endpoints 34 and 35 require a key, and so does 30 when it
> carries an `initialDeposit` — the opening deposit is recorded atomically with
> the account, so a retry must not open a second one.

### Loans (`tags: Loans`)

**Office only — all ten.** The tag says so outright, and unlike susu and savings
there is no half of this a collector takes part in: a repayment is taken at the
counter, not in the field. This is why `/loans` is the one cross-customer ledger
in the app, where the susu equivalent was deliberately deleted — `GET /loans`
takes a `search` *and* joins `customerName` onto its rows, and more to the point
a **pending application has to be found by whoever approves it**, who has no
reason to have opened that customer's record first.

The product in one paragraph: a fixed principal over 3, 6 or 12 months at a
**flat** rate (a one-off percentage of the principal, not an APR and not
amortised), so `totalDue = principal + interest` and nothing about it moves as
the loan is repaid. **A human approves it** — the API says "No auto-approval
exists" — and `GET /loans/eligibility/{customerId}` exists to put ~4 months of
susu/savings history in front of that person. Approval locks rate and interest
**from the config as it stands at that moment**, generates the monthly schedule
(remainder folding into the last instalment), and sends an SMS.

Three rules that shape every screen:

| Rule | Detail |
|------|--------|
| One open loan per customer | A second application is *always* refused, 409 `LOAN_EXISTS`. |
| Ghana Card required | 422 `GHANA_CARD_REQUIRED` — a hard gate, not a factor. |
| Big tier is earned | Needs a previous small loan repaid on time (`repaidOnTime` → `bigTierUnlocked`). |

And the one that has no analogue in the other products: **escalation**. A loan
that falls behind moves *up* the rate ladder (10 → 20 → 30) on the **original
principal**, so `ratePercent` is the *current* rate and `totalDue` grows.
`escalatedAt` stamps the last move; `frozen` says the ladder is exhausted and
the loan now needs a person. `/loans/:id` states both, because otherwise an
operator is holding a figure larger than the one the customer was quoted with
nothing on screen explaining it.

| # | Method | Path | Summary | Access | Client fn | Status |
|---|--------|------|---------|--------|-----------|--------|
| 37 | GET | `/loans/config` | Current tiers, rates, durations | **office** | `getLoanConfig()` | ✅ wired (`/loans/config`, application form) |
| 38 | PUT | `/loans/config` | Update loan parameters | **office** | `updateLoanConfig()` | ✅ wired (`/loans/config`) |
| 39 | GET | `/loans/eligibility/{customerId}` | History summary for the decision | **office** | `getLoanEligibility()` | ✅ wired (`/customers/:id/loans`) |
| 40 | POST | `/loans/applications` | Record an application (pending) | **office** | `applyForLoan()` | ✅ wired (apply drawer) |
| 41 | GET | `/loans` | List loans (paginated, `search`) | **office** | `listLoans()` | ✅ wired (`/loans`, customer's book) |
| 42 | GET | `/loans/{id}` | Detail with schedule + repayments | **office** | `getLoan()` | ✅ wired (`/loans/:id`) |
| 43 | POST | `/loans/{id}/approve` | Approve — locks rate, builds schedule, SMS | **office** | `approveLoan()` | ✅ wired (confirm + figures) |
| 44 | POST | `/loans/{id}/reject` | Reject with a reason (2–300) | **office** | `rejectLoan()` | ✅ wired (reason drawer) |
| 45 | POST | `/loans/{id}/repayments` | Record a cash repayment | **office** | `recordLoanRepayment()` | ✅ wired (repay drawer) |
| 46 | POST | `/loans/{id}/repayments/susu-closure` | Repay by closing a susu account | **office** | `repayLoanFromSusu()` | ✅ wired (account picker) |

> **`GET /loans/config` has no declared response shape.** The spec gives it
> `config: {}` — an object with no properties at all — so the six field names
> are an *inference* from the fully-specified `PUT` body. `normalizeLoanConfig`
> in [loan-client.ts](app/lib/loan-client.ts) reads whatever comes back
> defensively and falls back to the documented defaults (10/20/30%, 1k–20k,
> to 50k), returning a `complete` flag; both `/loans/config` and the application
> drawer say outright when a default was used, because those six numbers are the
> bounds a principal is validated against. **Worth confirming against staging
> and then simplifying.**
>
> **`PUT /loans/config` replaces, it does not patch** — all six fields are
> required, so the settings form renders all six prefilled and posts all six
> back. Changes apply to *new applications and approvals only*; a running loan
> keeps the rate it was approved at, which is what makes it safe to edit
> mid-month and also means it can't be used to correct a loan approved wrong.
>
> **`GET /loans/{id}` carries no `customerName`,** where the list rows do. The
> detail page therefore costs a second `GET /customers/{id}` to put a name in
> the trail. Same gap as `GET /susu/accounts`, in the other direction.
>
> **Idempotency:** endpoints 45 and 46 require a key. 40 does *not* — `LOAN_EXISTS`
> stands in for one, since a double submit creates the first application and the
> second is refused, which is the outcome a key would have produced.
>
> **`PAYOUT_EXCEEDS_BALANCE` is a fork in the workflow, not a validation quibble.**
> The susu-closure path refuses the *whole* operation if the payout would
> overshoot what the loan owes, because the API has nowhere to put the excess —
> the way through is a cash repayment for the balance, then an ordinary closure.
> So the drawer measures each account's `projectedPayout` against `remaining`
> **before** the click and says which ones would be refused and why, rather than
> offering them and reporting a 422.

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
// PublicUser — required: id, name, username, phone, role, mustChangePassword
type PublicUser = {
  id: string;
  name: string;
  username: string;
  phone: string;
  email?: string;
  role: "admin" | "manager" | "collector";
  // Set by an admin's reset, cleared by POST /auth/password/change. There is no
  // `status` here — a user's active/disabled state is a GET /users filter only,
  // never a field on the record, so the staff table shows the status it filtered
  // by rather than reading one per row.
  mustChangePassword: boolean;
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

> ✅ **Loans landed** — pulled 2026-08-01, ten new paths under `tags: Loans`.
> Every other path is unchanged from the 2026-07-26 pull, and so is every
> schema that already existed; the only new one is `Loan`. The version string is
> *still* `0.1.0` even though the surface has now grown four times, so the
> version remains no signal at all that nothing changed — diff the paths.
>
> ⚠️ **And do not trust the paths alone either.** The 2026-07-26 pull moved
> nothing in the path list — all 31 the same — while dropping a *field* the
> frontend wrote on every customer save (`assignedCollectorId`), raising a
> *minimum* the open-account form validated against (`dailyAmount` 1 → 500), and
> adding a *required* field the session had to start carrying
> (`mustChangePassword`). The client types here are hand-written, so `tsc` sees
> none of that: diff `components.schemas` and the request bodies, not just the
> paths.

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
- [x] **Forced password change.** `PublicUser` now carries a required
      `mustChangePassword`, set by an admin's reset and cleared by
      `POST /auth/password/change`. `requireUser` is the gate: while the flag is set, every
      authenticated route redirects to
      [change-password.tsx](app/routes/change-password.tsx), which is the only exemption —
      no route can be reached around it, because they all call `requireUser`. `/logout` never
      does, so signing out stays available; the page offers it.

      Two things the endpoint's shape forces:
      - A `401` there is ambiguous. `INVALID_CREDENTIALS` (wrong current password) and an
        expired access token are the same status, and `withAuth` retries a 401 by spending the
        refresh token — so a typo would have logged the user out. The action branches on `code`
        and turns that one into a field error before `withAuth` ever sees it.
      - The change makes the user in the session cookie stale, and the guard reads the flag from
        there. `withAuth` now hands its callback a `setUser`, so the refreshed `/auth/me` user is
        written into the *same* session it holds. Committing it separately would have overwritten
        a token rotation with the pre-refresh pair off the request cookie.
- [x] Also reachable voluntarily, from the user menu — nobody should wait for an admin reset to
      change a password they'd rather not keep.
- [ ] Forgot / reset password — [auth.ts](app/lib/api/auth.ts) wraps `forgotPassword` and
      `resetPassword`, but there is no UI: a signed-out user who has forgotten their password
      still can't get in on their own. Phone → OTP → new password, and the OTP step is the same
      dance `/login` already runs.

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
- [x] **Collector assignment is gone — the whole concept, not just the scoping.** The
      2026-07-26 spec pull has no `assignedCollectorId` on `Customer`, in either write body,
      or as a `GET /customers` filter, and says plainly: *"All roles see all customers."*
      `GET /susu/accounts` says the same, and recording a deposit now admits *"any collector
      or office staff"*. This is the resolution of the "Blocked by the API" item that used to
      sit here — the backend didn't relax the scoping, it removed what the scoping was for.

      Ripped out of the frontend accordingly: the field off both types, the query param off
      `listCustomers`, the "Filter by collector" select and the Collector column off the list,
      the reassignment dropdown off the record. The **Assignment** section is now **Record** —
      "Registered by" and the customer id, which is all that was left in it.

      Two `GET /users?role=collector` calls per page load went with it (customers list, customer
      record). They existed only to name a field that no longer exists, and with them goes the
      "Collector select pages at 100" item — there is no collector select left to page.
- [x] The registrar is still captured. `registeredById` is absent from the request body and
      present on the response — the API sets it from the token that called `POST /customers`, so
      it is the signed-in user on every record ever created. Shown as **Registered by** in the
      Record section, resolved through one `GET /users/{id}` (office roles only — `/users` is
      admin+manager, so a collector would get a 403 that sinks the page).
- [x] Susu / savings accounts belonging to a customer — they hang off `/customers/:id/accounts`,
      reached from the Accounts row action and the button on the detail page. One page per
      customer with a product filter over one list, not a product picker in front of it —
      see Phase 3.3.

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
- [x] `/customers/:id/accounts` — everything one customer saves into, with a status filter,
      an account-number lookup, paging and open-account. A customer opens a fresh cycle
      roughly monthly (sometimes several at once), so the list is unbounded and is paged
      rather than shown whole. The daily amount is immutable, so opening confirms with the
      amount, the 31-day total, and what closing costs — a ceiling this app invented would
      eventually refuse a legitimate account, a confirmation never does. Savings joined the
      same list behind a product switch in Phase 3.3.
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
- [x] **Dashboard widened into an overview** — four figures, a collections chart, the day's
      statement, and a rail (the day's card, the round, the book, payouts coming). Built from
      the collections the API already publishes, since there is no analytics endpoint:
      - the chart's x-axis is **months** (last 6 or 12). No endpoint takes a date range, so
        money in is summed from susu deposit *statements* — one request per account, since a
        statement carries a whole 31-deposit cycle, where `GET /susu/summary` would have been
        one request per **day** (365 for a year). Bounded by `MAX_STATEMENTS` (400, newest
        accounts first, concurrency 8); accounts closed before the window are skipped
        outright. When the bound bites, or a statement fails to read, the page says the
        figures are a floor. **The API change worth asking for is `GET /susu/deposits?from=&to=`
        or a monthly summary — that replaces the whole scan with one request.**
      - because every deposit names its collector, scoping the chart to one person is exact
        rather than proportional. Money out is bucketed from closed accounts'
        `closedAt` / `payoutAmount` (free — already in the list) and is drawn only when the
        collections beside it are also whole-book: one collector's takings against
        everybody's payouts would invent a deficit.
      - the day's statement, the "collected today" figure and its vs-yesterday delta are two
        `GET /susu/summary` calls (the selected day and the one before it), not a range.
      - `expectedDaily` (Σ `dailyAmount` over running cycles) is the day's round: the only
        target this business has that isn't invented.
      - account lists are pulled whole (10 pages × 100) so the portfolio total is a total;
        past that, the page says the figures are a floor.
      - charts are hand-built in [charts.tsx](app/components/charts.tsx) — percentages in
        CSS, nothing measured — so SSR and hydration agree and the marks use the app's own
        palette. Export is a client-side CSV of the day, with the formula-injection guard in
        [analytics.ts](app/lib/analytics.ts).
- [x] ~~`/susu` shows one row per *account*; a customer with three accounts is three rows.~~
      Answered by removing that page: the list is now always one customer's, where several
      rows for one person is the point rather than the problem.
- [ ] No totals on `/customers/:id/accounts` — with a cycle a month, "how much has this
      customer saved with us, ever" is a fair question and the page can't answer it. Needs
      either an API roll-up or a walk of every page.
- [ ] No offline handling. A collector out of signal loses the submit — the idempotency
      key makes a retry safe, but nothing queues it for them.

### Phase 3.3 — Savings
- [x] **Two things lifted out of susu first**, because savings needs them and neither
      belonged to susu: the payment channel enum → [channel.ts](app/lib/channel.ts), and
      idempotency-key minting/reading → [idempotency.ts](app/lib/idempotency.ts).
      [susu-client.ts](app/lib/susu-client.ts) re-exports both under the names it used to
      own, so no call site changed.
- [x] Client-safe types, the three product rules as named constants, and the fee/floor
      arithmetic → [savings-client.ts](app/lib/savings-client.ts). `SAVINGS_MIN_BALANCE`,
      `SAVINGS_FEE` and `SAVINGS_MIN_DEPOSIT` are hard-coded in the API's *descriptions*
      rather than returned as fields, so they are named once here instead of retyped as
      literals across four screens.
- [x] Endpoint wrappers → [savings.ts](app/lib/api/savings.ts), mirroring
      [susu.ts](app/lib/api/susu.ts).
- [x] Form readers → [savings-form.ts](app/lib/savings-form.ts), isomorphic like the susu
      ones: `readWithdrawalForm` runs in the action *and* against the typed value on screen,
      so "more than is available" is one rule.
- [x] `SavingsCard` in [account-card.tsx](app/components/account-card.tsx) — deliberately the
      same object as the susu card, since the two sit in one grid and a different shape would
      read as a different app. Leaf green for open, the same navy for closed. The bottom strip
      is not 31 boxes but the balance split into available and held back, which is the savings
      answer to the question the susu ticks answer.
- [x] **Savings joins `/customers/:id/accounts` as a product filter over one list**, not as a
      second section. It was built as a stacked section first, and that was wrong: it put two
      of every control on the page — two status filters, two Open buttons, two paginations —
      and made the second product something you scrolled to. Susu and savings are one question
      ("what is this customer saving into?") asked of two ledgers, so `?product=` selects the
      ledger and the single filter, lookup field, Open button and card grid below all follow
      it. Only the selected product is fetched, where two sections loaded both every visit.
- [x] The switch is two links, not a dropdown — it is the page's primary axis, and a dropdown
      hides the existence of the other product behind a click. Real links, so each product has
      a shareable URL and the pair works with JavaScript off; susu is the default and keeps the
      bare path.
- [x] It sits in the filter bar, first, left of the lookup field it reframes — switching product
      changes what a number typed there would even mean. Sized off the shared `FIELD` constant
      and a 2px border, exactly as the input and the status select are, so the three share one
      height by sharing one recipe rather than by three numbers that happen to agree today.
      `FilterSelect` gave up HeroUI's `Select` over the same constant.
- [x] Product-specific filters reset on the way across. Susu has three statuses to savings' two
      (`completed` has no meaning without a cycle) and the account number is six digits against
      ten, so `status`, `accountNumber` and `page` are all dropped when the product changes —
      and the loader validates `status` against the *selected* product rather than in general,
      so a hand-edited URL falls back to `active` instead of being sent to be rejected.
- [x] The lookup field now covers savings too, which the two-section layout had skipped. Its
      length, `maxLength` and empty-state wording all follow the product.
- [x] No idle help line under it — the placeholder names the field and `maxLength` enforces the
      digit count, so a line reciting both was standing instruction nobody needed twice. The
      two surprising things stay: nothing happens until the number is whole, and a whole one
      overrides the status filter. The line holds its height while empty, so the cards don't
      hop as it comes and goes.
- [x] Open account (office) — the opening deposit is *optional*, the one amount field in the
      app where blank is a valid answer. Sent with its idempotency key so a retry can't open a
      second account with a second deposit in it.
- [x] **Both Open account forms are drawers, not modals**, matching the deposit, withdrawal and
      susu-deposit forms — opening an account is the same kind of act and was the odd one out.
      Not only cosmetic: `ConfirmModal` renders in a portal, so the field couldn't sit in the
      `<Form>` that posts it and each dialog mirrored its state into a hidden input on a second
      form, submitted by `requestSubmit`. `SideDrawer` renders in place, so the field carries
      its own `name`, Enter submits, and the button can show a pending state instead of the
      dialog vanishing on click and the outcome arriving as a toast.
- [x] `/savings/:id` — statement of signed amounts, the fee column and a running balance, with
      the three transaction types told apart by more than a minus sign.
- [x] ~~Money panel where the susu page puts its cycle chips — balance, available now, and what
      the minimum and fee hold back.~~ **Removed by request**, along with the prose above it
      that said the same thing. Worth knowing what went with it: **the balance is no longer
      stated anywhere on this page.** It survives as the `Balance after` on the newest statement
      row, and `availableToWithdraw` still governs and is printed by the withdrawal form — so
      nothing is unreachable, but the account's headline figure is now something you read out
      of a table column. If it is wanted back, beside the account number in the trail is a
      lighter home for it than a panel was.
- [x] Record deposit (any collector), withdraw and close (office), each branching on
      `replayed` rather than the status code. `EXCEEDS_AVAILABLE` lands on the field with the
      API's own figure; `WITHDRAWAL_LIMIT` is caught *before* the submit by reading today's
      Accra day off the statement, so the button is disabled with a sentence rather than the
      submit being refused.
- [x] **Withdraw and Close are never disabled — they alert instead.** They *were* disabled on
      the two rules that block a cash-out, which was fine while the money panel stood beside
      them explaining the figures. With that panel gone the buttons were grey with nothing on
      the page saying why, and an account sitting on exactly the ₵50 minimum read as a broken
      page: click Withdraw, nothing happens. Both now always click, and
      `withdrawBlockedReason` answers with a toast naming the rule and the figures. Closing is
      exempt from the available-balance rule — releasing the minimum is what closing *is*.
- [x] The page carries no standing explanation of either rule now: the minimum-balance note,
      the money panel and the daily-limit note have all gone by request, so **the toast on the
      click is the only place either rule is stated.** Nothing is unreachable — the API
      enforces both and the withdrawal drawer still prints what is available — but a teller
      cannot read the rules off this screen before acting, only after.
- [x] Two idempotency keys per page load, not one — deposit and withdrawal are separate
      endpoints, and sharing a key would leave one holding a spent one after the other fired.
- [x] **Every movement of money confirms first.** Closing already did; susu deposits, savings
      deposits and savings withdrawals now do too, each showing the figures it is about to
      commit — the deposit its total and the cycle or balance after, the withdrawal what the
      customer receives, the fee, and what the balance drops to. None of the three is
      reversible: the API has no un-deposit, only a second transaction.
- [x] Two details that pattern needs. The confirm submits with `useSubmit(formEl)` rather than
      `requestSubmit()`, because the drawer's `onSubmit` is intercepted to raise the
      confirmation — Enter in the amount field has to ask too, or it becomes the one route
      that skips it — and `requestSubmit` would re-fire that handler and bounce forever. And
      the modal carries `z-60`: its backdrop and the drawer's panel are both `z-50`, so which
      paints on top was down to React Aria portalling to the end of `body`. Stated rather than
      inherited.
- [ ] **Not verified against real data.** Typecheck and build pass and the routes register,
      but there are no API credentials in the repo, so no savings account has been opened,
      deposited into, or closed through these screens. The arithmetic on the withdraw drawer
      (receives / fee / leaves the balance / balance after) is the part most worth watching
      the first time it runs.
- [ ] **A day's savings movements are still invisible.** `GET /susu/summary` reconciles susu
      only and the API publishes no savings equivalent, so savings deposits are missing from
      the end-of-day count and savings withdrawals are missing from the dashboard's "paid
      out" series — that series counts susu closures alone, and the chart's caption says so.
      Savings *balances* do now appear, under "Money under management", because those can be
      summed from `GET /savings/accounts`.
- [ ] No cross-customer savings lookup by `accountNumber`, same gap as susu's.

### Phase 3.4 — Loans
- [x] Client-safe types, the config shape, and the projection arithmetic →
      [loan-client.ts](app/lib/loan-client.ts). `projectInterest`,
      `projectTotalDue` and `projectInstalments` live here rather than in the
      routes so the quote on the application drawer and the confirmation behind
      it can't disagree — and `projectInstalments` mirrors the API's
      remainder-into-the-last-instalment rule rather than dividing evenly, so
      the schedule this app projects adds up to the one the API will generate.
- [x] Endpoint wrappers → [loans.ts](app/lib/api/loans.ts), mirroring
      [savings.ts](app/lib/api/savings.ts).
- [x] Form readers → [loan-form.ts](app/lib/loan-form.ts), isomorphic like the
      susu and savings ones: `readLoanApplicationForm` runs in the action *and*
      against the typed value on screen, so the tier bounds exist once.
- [x] **The application form validates against the tier the customer can
      actually reach**, not the product's outer ceiling. `bigTierUnlocked` is
      false for most people, and validating against `bigMaxPesewas` regardless
      would let the form submit a principal the API is certain to refuse — with
      `BIG_TIER_LOCKED`, which names no field, so the message would land in a
      banner rather than on the input that caused it.
- [x] `/loans` — the book and the approval queue in one list: search, status
      filter, pagination. Status is genuinely optional on the API, so "all" is a
      real default and the queue is one click into it.
- [x] `/customers/:id/loans` — the eligibility summary, the customer's history,
      and the apply drawer. Mirrors `/customers/:id/accounts`: a loan belongs to
      a customer, so this is where one is applied for and there is no
      `/loans/new`.
- [x] The three refusals knowable before the form opens — no Ghana Card, an
      open loan, a deactivated customer — are checked on the click and answered
      with the instruction (add the card / settle it / reactivate them). The
      Apply button is never disabled, for the same reason the savings Withdraw
      button isn't: a grey button with nothing beside it explaining itself is
      how that page confused someone once already.
- [x] The eligibility panel scores nothing. The API doesn't, and inventing a
      score would be this app asserting a lending policy it hasn't been told —
      it shows months of history, susu deposited, savings held, and marks the
      two facts that are gates rather than evidence.
- [x] `/loans/:id` — money panel, schedule, repayment history, and the four
      writes. A **pending** loan renders no empty schedule and no empty history:
      it is figures and a decision, because that is all it is until approval.
- [x] Approve confirms with the figures **and says they may move** — the rate is
      locked from the config at approval, not at application, so a config change
      in between lands on a different number.
- [x] Reject takes a reason (2–300) in a drawer, because it is stored on the
      record and read back later by whoever fields the customer's question.
- [x] Repayment gates against `remaining` before the round trip, offers "Settle
      in full", and names the consequence settlement carries: paying exactly
      stamps `repaidOnTime`, which unlocks the big tier for the next loan. 422
      `EXCEEDS_BALANCE` re-seeds from the API's own figure — a loan can't be
      overpaid, so the correction is exact rather than a guess.
- [x] Susu-closure repayment lists the customer's open cycles with the payout
      each would produce, and marks the ones the API would refuse (`NO_PAYOUT`,
      `PAYOUT_EXCEEDS_BALANCE`) with the way through. Blocked accounts stay
      visible rather than being filtered out — the reason is the useful part.
- [x] Escalation and `frozen` are stated on the money panel, not left implicit.
      An escalated loan's `totalDue` is larger than the figure the customer was
      quoted, and an operator needs to be able to explain that.
- [x] `/loans/config` — all six settings, prefilled, because the endpoint
      replaces rather than patches. Says outright that changes apply to new
      applications only, and warns when a value came from this app's defaults
      rather than the API.
- [x] Nav: `/loans` is office-only (`admin`, `manager`) — every loan endpoint
      is. The customer record's Loans button is gated the same way, where its
      Accounts button is not.
- [ ] **Not verified against real data.** Typecheck and build pass and the
      routes register, but there are no API credentials in the repo, so no loan
      has been applied for, approved, or repaid through these screens. Three
      things are worth watching the first time they run: the **config response's
      real field names** (inferred, see the note above), whether a **pending**
      loan's `ratePercent`/`interestAmount` are populated or zero, and the exact
      strings the schedule's `status` takes — the spec types it as an open
      string, so `scheduleStatusLabel` maps the likely values and title-cases
      anything else.
- [ ] No loan figures on the dashboard. `GET /loans?status=pending` would give
      the queue depth in one request, and `status=arrears` the book at risk;
      both are one-liners once someone decides where they belong.
- [ ] Repayments are invisible in the day's reconciliation. `GET /susu/summary`
      covers susu only, and there is no loan equivalent — same gap savings has.
- [ ] No SMS copy confirmed. The API sends one on approval; the business should
      say what it reads so the confirmation can quote it.

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
- [x] ~~When are the Susu / Savings endpoints landing?~~ Landed — pulled 2026-07-25.
- [x] ~~When are the Loans endpoints landing?~~ Landed — pulled 2026-08-01. The
      whole API surface named in the title is now published.
- [ ] **Confirm the real shape of `GET /loans/config`.** The spec declares it as
      a propertyless object, so the six field names this app reads are inferred
      from the `PUT` body. Once confirmed against staging, `normalizeLoanConfig`
      and the "showing defaults" warnings it feeds can collapse to a plain type.
- [ ] Confirm what the approval SMS says, so `/loans/:id` can quote it.
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

_Spec pulled: 2026-08-01 from `/api/v1/openapi.json` (still v0.1.0 — the version does not move when endpoints land, so diff the paths). Re-pull and diff before each new feature phase._
