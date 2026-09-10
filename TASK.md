# YADAH V2 — Frontend Build Plan

**Product**: Web client for the **Yadah Microfinance API** — susu collection, savings, loans, hire purchase, transfers and mobile-money payments for Yadah Dynamic Enterprise (Ghana).

| | |
|---|---|
| API base (staging) | `https://staging-backend.yadahdynamic.com/api/v1` |
| API docs (Scalar) | `https://staging-backend.yadahdynamic.com/api/v1/docs` |
| OpenAPI spec | `https://staging-backend.yadahdynamic.com/api/v1/openapi.json` (OpenAPI 3.1.0, v0.1.0) |
| Portal | Built into this app at `/portal/*` (own OTP login, own `__yadah_session_portal` cookie scoped to `/portal`) — see `app/lib/portal-session.server.ts` |
| Surface | **134 endpoints** across **17 tags**, 31 shared schemas (Aug 2026 — added Dashboard, Collectors, Payout Requests, Customer Portal, printable receipts) |
| Frontend stack | React Router v8 (framework mode, SSR on), React 19, Tailwind v4, shadcn/ui + Radix + Base UI, Recharts, Sonner, TypeScript |
| Current state | Bare template — `app/routes.ts` has a single `index("routes/home.tsx")`. The full shadcn component library is already vendored in [app/components/ui/](app/components/ui/). **No app code exists yet.** |

---

## 1. Non-negotiable API conventions

These apply to every request and must be encoded once in the API layer, not repeated per feature.

- **Money is integer pesewas.** GHS 10.50 → `1050`. Never use floats. All formatting/parsing goes through one module (`app/lib/money.ts`, to be written) — extend the existing [format.ts](app/lib/format.ts).
- **JSON, camelCase fields.** Dates are ISO 8601 **UTC**, but business days are **Accra calendar days** (`YYYY-MM-DD`). Do not let the browser timezone shift a day boundary — treat `accraDay` strings as opaque, and render UTC timestamps in Africa/Accra.
- **Auth**: `Authorization: Bearer <accessToken>`. Access token ~15 min. Refresh token is **opaque and single-use — rotated on every refresh; reusing an old one revokes the entire session.** A refresh mutex is mandatory (see §3.2).
- **Errors always** use `{ error: { code, message, details? } }`. `code` is a stable machine-readable string; `details` is an issue array on `VALIDATION_ERROR`.
- **Idempotency**: 12 money-moving endpoints require an `idempotencyKey` **in the JSON body** (not a header), 8–128 chars. Retries return the original record with `200` instead of double-recording.
- **Exports**: most list endpoints accept `format=json|csv|xlsx`. Export ignores pagination and caps at **10,000 rows**. `GET /customers/{id}/registration-form` returns **binary `application/pdf`**.
- **Realtime**: Socket.io emits money events to an admin room. Those events signal *when to refetch*; `GET /dashboard/summary` is always the source of truth (`GET /reports/dashboard` is a deprecated alias). Never render off the socket payload.

### Status codes in use

`200 201 204` · `400 401 403 404 409 413 415 422 429` · `502 503`

### Error codes to handle by name

```
VALIDATION_ERROR  BAD_REQUEST  FORBIDDEN  NOT_FOUND
INVALID_CREDENTIALS  INVALID_OTP  OTP_COOLDOWN  INVALID_REFRESH_TOKEN
PHONE_TAKEN  ID_TAKEN  USERNAME_TAKEN  PHONES_NOT_DISTINCT  CANNOT_MODIFY_SELF
CUSTOMER_INACTIVE  CUSTOMER_MISMATCH  CANNOT_TRASH  CANNOT_RESTORE  NOT_TRASHED
AMOUNT_MISMATCH  AMOUNT_TOO_SMALL  DEPOSIT_MISMATCH  COMMISSION_NOT_COVERED
CANNOT_TERMINATE  NO_ACTIVE_ACCOUNTS  NO_PAYOUT  NOT_PENDING_PAYOUT
EXCEEDS_PAYOUT  PAYOUT_EXCEEDS_BALANCE  EXCEEDS_BALANCE  EXCEEDS_AVAILABLE
EXCEEDS_REMAINING  WITHDRAWAL_LIMIT  ACCOUNT_NOT_ACTIVE  ALREADY_CLOSED
GHANA_CARD_REQUIRED  ID_DOCUMENT_REQUIRED  ID_DOCUMENT_IN_USE  LOAN_EXISTS  LOAN_NOT_OPEN  BIG_TIER_LOCKED
PRINCIPAL_OUT_OF_RANGE  NOT_ELIGIBLE  NOT_PENDING  INVALID_TRANSITION
OUT_OF_STOCK  STOCK_UNDERFLOW  AGREEMENT_NOT_OPEN  AGREEMENT_NOT_PENDING
NOT_REDEEMABLE  NOTHING_TO_REDEEM  REDEMPTION_WINDOW_OPEN  REDEMPTION_WINDOW_LAPSED
FILE_TOO_LARGE  UNSUPPORTED_FILE_TYPE
PAYSTACK_ERROR  PAYMENTS_NOT_CONFIGURED  BAD_SIGNATURE
```

Several of these carry actionable payloads the UI must surface rather than swallow — e.g. `AMOUNT_MISMATCH` on `POST /susu/collect-all` returns the required total *and a per-account breakdown*; `EXCEEDS_REMAINING` returns the exact remaining balance.

---

## 2. Roles and access

Three roles: **`admin`**, **`manager`**, **`collector`**. "Office" = admin + manager. Collector is field-only.

| Capability | admin | manager | collector |
|---|:--:|:--:|:--:|
| Record susu / savings deposits, `collect-all` | ✓ | ✓ | ✓ |
| Read customers, accounts, own collection summary | ✓ | ✓ | ✓ |
| Register / edit / trash customers, open and close accounts, withdrawals, payouts, transfers, corrections, trash and restore | ✓ | ✓ | — |
| Loans, hire purchase, reports, Paystack charges | ✓ | ✓ | — |
| Staff CRUD, role changes, password resets, disable/enable, `GET /reports/workers` | ✓ | — | — |

- **6 endpoints are admin-only**: the five `/users` write endpoints plus `GET /reports/workers`.
- **32 endpoints are explicitly office-only** (403 `FORBIDDEN — office only`).
- The Loans tag is documented module-wide as *"office only"* even though individual operations do not repeat it — **verify against staging before exposing loan/HP routes to collectors**.
- `GET /susu/summary`: collectors see only their own deposits; office may pass `collectorId` or omit it for everyone.
- Role change or disable **revokes all refresh sessions**; the access token still dies within 15 minutes, so the client must handle a mid-session `403` gracefully.

**Route protection must be server-side** (React Router `loader`), not just conditional rendering. Hiding a button is not access control.

---

## 3. Foundation work (blocks everything else)

### 3.1 Generated API types

Vendor `openapi.json` into the repo and generate types (`openapi-typescript` or equivalent) into `app/api/schema.d.ts`. Do **not** hand-write 88 endpoints' worth of interfaces. Re-generate on spec change; treat spec drift as a build break.

### 3.2 API client — `app/api/client.ts`

Single `apiFetch` used by every loader/action:

- Prefixes `/api/v1`, attaches the bearer token, sets `Content-Type`.
- Parses the `ErrorEnvelope` and throws a typed `ApiError { status, code, message, details }`.
- **Refresh mutex**: on `401`, a *single* in-flight refresh; all concurrent callers await it and retry once. A failed refresh (or `INVALID_REFRESH_TOKEN`) clears the session and redirects to login. Because refresh tokens are single-use, two parallel refreshes will kill the session — this is the highest-risk piece of the whole client.
- Handles `429` (`OTP_COOLDOWN`, rate limits) with a surfaced retry-after, and `502/503` with a "backend unavailable" state.
- Runs on the **server** (React Router loaders/actions). Tokens live in an httpOnly, secure, sameSite session cookie — never in `localStorage`.

### 3.3 Session and auth plumbing

- Cookie session storage; `requireUser(request)` and `requireRole(request, [...])` loader helpers.
- `GET /auth/me` hydrates the current user into the root loader.
- Logout calls `POST /auth/logout` and destroys the cookie.

### 3.4 Money, dates, idempotency

- `app/lib/money.ts` — `toPesewas`, `formatGhs`, and a `<MoneyInput>` that stores pesewas while displaying cedis. Every amount field in the app uses it.
- `app/lib/accra.ts` — Accra-day formatting/parsing, plus the default "last 30 days" range used by statements, transactions, and collections.
- `app/lib/idempotency.ts` — key generated **once per form mount** and reused across retries, so a double-submit or a network retry deduplicates. Regenerating per submit defeats the entire mechanism.

### 3.5 App shell

Replace the template `home.tsx`/`welcome.tsx`. Build sidebar navigation (module list gated by role), header with user menu, breadcrumbs, `sonner` toasts, and error boundaries that render `ApiError.code` meaningfully. `app/routes.ts` becomes a nested layout tree.

### 3.6 Reusable data-layer primitives

Nearly every list endpoint shares the same shape: `page`, `limit`, `search`, `from`, `to`, `format`, plus module filters. Build **once**:

- `<DataTable>` wrapper over the existing [data-table.tsx](app/components/ui/data-table.tsx) — URL-driven pagination/filter state, empty and loading states.
- `<ExportButton>` — `format=csv|xlsx` download with the 10,000-row cap communicated.
- `<DateRangeFilter>`, `<SearchInput>` (fuzzy, typo-tolerant server-side), `<StatusFilter>`.
- `<TrashDrawer>` — 6 modules have a `/trash` list plus restore endpoint with identical mechanics.
- `<ConfirmDestructive>` — every trash/close/terminate/repossess/forfeit action.

---

## 4. Feature modules

Ordered by dependency. Each is a route group with list, detail, and action flows.

### 4.1 Auth — 9 endpoints

Login (username+password), **phone OTP login** (`request` → `verify`), refresh, logout, change password, forgot/reset password by OTP, `me`.

- OTP: 6-digit code by SMS (and email if on file), **5-minute expiry, max 5 verify attempts, 60s resend cooldown**. Use the existing [input-otp.tsx](app/components/ui/input-otp.tsx). Build a visible resend countdown driven by the cooldown.
- The API **deliberately does not leak account existence** — the response is identical whether or not the phone is registered. The UI must not imply otherwise.
- `password/change` revokes all *other* sessions; `password/reset` revokes **all** sessions → force re-login.

### 4.2 Customers — 11 endpoints

Registration is office-only and is **the heaviest form in the app**:

- Personal (full name as on ID, DOB, gender, nationality, marital status), contact (residential address, phone, alt phone), identification (type and number), occupation, next of kin.
- **Required images**: customer photo + ID front + ID back. Flow is `POST /uploads/images` first (multipart, field `image`, JPEG/PNG/WebP, max 5 MB, `kind=document` for ID scans), then submit the returned URLs. **Nothing is attached to a record by the upload call** — so abandoned or replaced uploads must be cleaned up via `DELETE /uploads/images`. Build this cleanup or the bucket fills with orphans.
- **Validation to mirror client-side**: phone, alt phone and next-of-kin phone must all be different (`PHONES_NOT_DISTINCT`); ID formats are checked per type — Ghana Card `GHA-123456789-0`, voter ID 8 digits, passport `G12345678`, driver's licence 10–20 alphanumerics; **minimum age 10**.
- Detail page aggregates every product the customer holds.
- `GET /customers/{id}/registration-form` → A4 PDF with the photo embedded and signature lines. Binary — needs its own download handling, not a JSON fetch.
- `GET /customers/{id}/statement` → all products with period opening/closing positions plus unified transactions, default last 30 Accra days, `format=csv`.
- Lifecycle: deactivate (blocks edits, stays visible) vs. trash (`DELETE`, hides from listings, restorable). Trash is **refused with `CANNOT_TRASH` while any susu/savings/loan/HP is open**. Phone stays reserved while trashed. Inactive customers cannot be edited — reactivate first.

### 4.3 Susu — 17 endpoints (largest and most rule-dense module)

One account = **one cycle of exactly 31 deposits** at a fixed daily amount (min GHS 5, **immutable for the account's life**). A customer may hold multiple concurrent accounts. Account numbers are 6-digit randomized.

Statuses: `active` · `completed` · `pending-payout` · `closed` · `terminated`.

- **Deposit** — send *cash received* as `amount`; it must be a **multiple of the daily amount**, and days covered are derived (1× = today, more = catch-up on missed days). Idempotency key required. The 31st deposit completes the cycle. SMS receipt sent.
- **Collect-all** — one cash amount split across *all* the customer's active accounts, **atomic**. Amount must equal the exact sum of daily amounts; on mismatch the error details carry the required total and a per-account breakdown → render that breakdown, do not just show the message.
- **Corrections** (office) — only the **most recent** deposit of an open account can be edited or trashed; counters adjust atomically including un-completing a cycle. **Transfer-created deposits are immutable.** Restore only works while the cycle positions are still free.
- **Close** = withdrawal. Payout = total deposits − **exactly one day's commission**, regardless of exit day. Refused with `COMMISSION_NOT_COVERED` if deposits do not cover it → the UI must then offer **terminate** instead.
- **Terminate** — escape hatch for accounts below one day's amount (including empty): full refund, no commission.
- **Payout** — draws down a `pending-payout` balance (e.g. excess after a loan repayment via susu closure); omit amount to pay everything; the account closes at zero.
- `GET /susu/summary` — daily reconciliation by Accra day and collector. This is the collector's primary screen.

### 4.4 Savings — 13 endpoints

Account numbers are 10-digit randomized. Types `standard` | `student` — **label only, money rules identical**. For student accounts the customer record is the minor and the guardian's ID goes in the customer identification fields with the guardian as next of kin (office procedure — surface this as form guidance).

- Min deposit **GHS 10**; optional `initialDeposit` recorded atomically at opening.
- **Withdrawal**: `amount` = what the customer receives; a **flat GHS 10 fee is debited on top**. **Max one withdrawal per account per Accra day** (`WITHDRAWAL_LIMIT`). Balance may never fall below the **GHS 50 minimum** except via closure. Surface `availableToWithdraw` (= balance − 50 − 10, floored at 0) prominently — it prevents most failed submits.
- **Closure**: releases the minimum balance, fee still applies (GHS 200 → customer receives 190). Response `flagged: true` when the balance did not cover the fee — needs a distinct UI treatment.
- Trash/restore: only the **newest live** deposit or withdrawal of an active account; closures and transfer-created transactions are immutable. Trashing a withdrawal frees its 1-per-day slot; restoring re-claims it and is refused if the day was taken meanwhile.

### 4.5 Loans — 13 endpoints

Tiers: **small GHS 1,000–20,000**, **big up to 50,000**. Durations 3/6/12 months, flat rate per duration (config-driven, documented as 10/20/30%). **Requires a Ghana Card on the profile** (`GHANA_CARD_REQUIRED`) **and both sides of the ID document uploaded** (`ID_DOCUMENT_REQUIRED`; the same applies to hire purchase via `NOT_ELIGIBLE`, and the scans cannot be removed from a profile while a loan or agreement is open — `ID_DOCUMENT_IN_USE`). **One open loan per customer** (`LOAN_EXISTS`). **Big tier requires a previous small loan repaid on time** (`BIG_TIER_LOCKED`).

Statuses: `pending` · `active` · `repaid` · `rejected` · `arrears`. Plus a `frozen` flag once rate escalation is exhausted.

- **There is no auto-approval.** `GET /loans/eligibility/{customerId}` summarizes ~4 months of susu/savings history; a human admin decides. Design the eligibility screen as a *decision aid* — history summary, then approve/reject.
- Approve locks rate and interest from current config and generates the monthly schedule (remainder folds into the last instalment). `PUT /loans/config` affects **new** applications only.
- **Repayment**: allocated oldest-instalment-first; **overpayment refused with the exact remaining balance** — pre-fill from that. Settling exactly flips to `repaid` and stamps `repaidOnTime`. Idempotency key required.
- **Repay by susu closure** — one atomic cross-module transaction: the susu account stops with normal commission math and its payout applies to the loan, capped at remaining. Excess either stays in the susu account pending withdrawal (default) or, with `excessTo=savings`, credits the active savings account in the same transaction. **The UI must make this choice explicit and preview the numbers before submit.**
- Trash: only `pending` or `rejected` applications — approved money history never leaves the ledger. Restoring a pending application re-checks the one-open-loan rule.
- Interest **escalates on the original principal** when overdue; `ratePercent` moves up the ladder. Show current vs. original rate on the detail page.

### 4.6 Hire Purchase — 23 endpoints (largest by count, ships in two stages)

**Inventory**: name, description, stock, `costPrice` (**office-only, never shown to customers — enforce this in the UI**), `sellingPrice`, condition `new|used`, status `active|discontinued`. Stock adjustments require a reason and are audited. Items used by an agreement can never be trashed.

**Agreements** — statuses: `pending` · `rejected` · `active` · `in-arrears` · `repossessed` · `closed-redeemed` · `closed-forfeited` · `closed-completed`.

- Eligibility requires an active susu or savings account, **≥3 months saving history, no active loan (loans and HP block each other), and no open HP agreement**.
- Signing decrements stock and **snapshots prices** — later item edits never change signed agreements.
- **Deposit = exactly 50% of selling price**, must match `depositRequired` exactly, and **releases the item**. Idempotency key required.
- Interest is **flat, applied once at activation** — early settlement pays the same total. Payments go oldest-instalment-first; overpay refused with the exact remaining; settling transfers ownership; clearing all month-overdue instalments auto-lifts the arrears flag.
- **Repossession → 1-month redemption window** (`redemptionDeadline` = repossession + 1 month, exact). Payments made are kept. Redeem pays the **full remaining balance, computed server-side** (`redeem` takes no amount). Forfeit is refused while the window is open; `restock` puts the item back as **used** at a new office-set price. This lifecycle needs a clear state-machine visualization and a live countdown to the deadline.
- ⚠️ **Stage B is pending a client decision**: instalment *schedules* and the interest method are not final. Rejecting a pending agreement restores stock; automatic arrears flagging arrives with Stage B — for now `mark-arrears` is a manual office action. **Build the schedule view behind a flag and confirm the interest method before implementing it.**

### 4.7 Transfers — 1 endpoint, disproportionate complexity

Move money between one customer's own accounts, atomically. Supported routes: **susu → savings / loan / hire-purchase**, **savings → susu / loan / hire-purchase**.

Each side keeps its own rules:

- A **savings source is a real withdrawal** — GHS 10 fee, one per day, available-balance limits apply.
- A **susu source stops the account** with normal commission — *or* draws a `pending-payout` balance, **the only case where a partial amount is allowed**.
- Loan/HP destinations receive **at most their remaining balance**; susu-source excess stays pending withdrawal.
- Internal savings credits **skip** the GHS 10 minimum-deposit rule.

Build this as a guided wizard with a **computed preview** (fee, commission, amount landing, excess disposition) before confirmation. `amount` is optional in the body — omitting it means "whole balance", which must be unmistakable in the UI.

### 4.8 Payments — Paystack mobile money — 4 endpoints

Charge a customer's wallet: `kind` ∈ `susu-deposit | savings-deposit | loan-repayment | hp-deposit | hp-installment | hp-redemption`, `phone` matching `^0[25]\d{8}$`, `provider` ∈ `mtn | vod | atl`. **Loan and HP charges are office-only. `hp-redemption` omits `amount`** (always the full remaining).

- `pay_offline` — the customer approves a prompt on their handset. `displayText` from Paystack must be shown verbatim.
- **Two independent statuses**: `status` (`pending|success|failed` — Paystack's view of the money) and `executionStatus` (`pending|applied|failed` — whether it hit the target record). **The UI must show both.** A paid charge whose target state changed becomes `executionStatus=failed` for the office to resolve — that needs a visible reconciliation queue, not a silent failure.
- Poll `GET /payments/charges/{reference}`; `POST .../verify` is the missed-webhook fallback and is safe to call repeatedly.
- `POST /payments/paystack/webhook` is server-to-server (HMAC-SHA512 signed) — **not a client concern**; do not call it.

### 4.9 Reports and Dashboard — 7 endpoints

- **Dashboard**: today's cash in/out by source (**internal transfers excluded from cash totals**), month-to-date revenue (susu commissions + savings fees), live portfolio position. Socket.io money events to the admin room signal *when to refetch*. Use Recharts plus the existing [chart.tsx](app/components/ui/chart.tsx).
- **Unified transaction feed**: every money event across all modules, newest first, inclusive Accra-day range (default last 30 days), filterable by module and customer. A transfer appears as **its per-module legs plus the transfer row itself, all `direction=internal`** — so totals count only real cash movement. The table must make that visually obvious or the numbers will look wrong to staff.
- Collections by staff (reconciliation), outstanding loans (soonest due first), **arrears aging buckets (1–30 / 31–90 / 90+)**, commission/revenue.
- `GET /reports/workers` (admin) — heartbeats for the SMS, loan-escalation, HP-arrears and debt-recovery workers. **In-memory, resets on restart** — label it as such so a zeroed panel is not read as an outage.
- CSV/XLSX export on every report.

### 4.10 Users / Staff — 7 endpoints (admin)

Create (admin sets the initial password and shares it offline), list, detail, update profile/role, reset password, disable/enable. **There is no delete endpoint** — disable is the terminal state; the UI must not offer deletion. Admins cannot change or disable **themselves** (`CANNOT_MODIFY_SELF`). Role change and disable revoke all of that user's sessions.

---

## 5. Cross-cutting work

- **Offline / poor-connectivity tolerance.** Collectors record deposits in the field. Idempotency keys make retries safe by design — pair them with a queued-submit UX and clear pending/synced states. This is the single biggest field-usability decision and should be settled early.
- **Socket.io client** for dashboard refetch signals (admin room only).
- **SMS side effects.** Deposits, collect-all, withdrawals, closures, loan approvals, HP deposits, arrears warnings and transfers all send SMS to the customer. Confirmation dialogs should say so.
- **Accessibility and field realities**: large touch targets, high contrast in sunlight, minimal typing on mobile, tolerant fuzzy search (server-side, typo-tolerant on name/phone/account-number prefix).
- **Testing**: unit-test money conversion, Accra-day handling, and the refresh mutex. Integration-test the atomic flows (collect-all, susu-closure repayment, transfers) against staging.
- **Config**: `API_BASE_URL` per environment; the Dockerfile already exists for deployment.

---

## 6. Suggested sequencing

| Phase | Scope | Unblocks |
|---|---|---|
| **0** | Generated types, `apiFetch` + refresh mutex, session cookie, money/Accra/idempotency libs, app shell, DataTable/Export/Trash primitives | everything |
| **1** | Auth (password + OTP), role-gated routing, `/auth/me` | all authed routes |
| **2** | Customers + Uploads (incl. orphan cleanup, PDF, statement) | susu, savings, loans, HP |
| **3** | Susu (deposits, collect-all, corrections, close/terminate/payout, summary) | transfers, loan-by-susu-closure |
| **4** | Savings (deposits, withdrawals, closure, corrections) | transfers |
| **5** | Reports + Dashboard + Socket.io | office visibility |
| **6** | Loans (eligibility, application, approve/reject, repayments, susu-closure repayment, config) | — |
| **7** | Hire Purchase Stage A (inventory, agreements, deposit, repossession/redemption/forfeit) | — |
| **8** | Transfers wizard | — |
| **9** | Paystack charges + reconciliation queue | — |
| **10** | Users/staff admin, worker heartbeats | — |
| **11** | HP Stage B (schedules, interest method, auto-arrears) — **blocked on client decision** | — |

---

## 7. Open questions to resolve before building

1. **HP Stage B**: which interest method did the client confirm? Instalment schedules and automatic arrears flagging are unimplemented server-side.
2. **Loans/HP and collectors**: the Loans tag says "office only" module-wide, but no individual loan operation carries the marker. Confirm the actual 403 behaviour on staging before gating routes.
3. **Offline capture**: is queued offline deposit entry in scope for v2, or is connectivity assumed?
4. **Socket.io**: exact URL, namespace, auth handshake, and event names — not covered by the OpenAPI spec.
5. **`GET /loans/config` response** is typed as an opaque `config` object in the spec; capture the real shape from staging.
6. **Uploads**: retention policy for images never attached to a record — is client-side `DELETE` the only cleanup, or does the server sweep?

---

## Appendix — full endpoint index (88)

### Auth (9)
```
POST   /auth/login                       Login with username and password
POST   /auth/otp/request                 Request a login OTP by phone
POST   /auth/otp/verify                  Login by verifying a phone OTP
POST   /auth/refresh                     Rotate the refresh token
POST   /auth/logout                      Logout (revoke the refresh session)
POST   /auth/password/change             Change own password
POST   /auth/password/forgot             Request a password-reset OTP by phone
POST   /auth/password/reset              Reset password with a phone OTP
GET    /auth/me                          Current authenticated user
```

### Users (7) — admin for all writes
```
POST   /users                            Create a staff member
GET    /users                            List staff (admin, manager)
GET    /users/{id}                       Get one staff member (admin, manager)
PATCH  /users/{id}                       Update profile or role
POST   /users/{id}/reset-password        Reset a staff password
POST   /users/{id}/disable               Deactivate a staff member
POST   /users/{id}/enable                Reactivate a staff member
```

### Customers (11)
```
POST   /customers                        Register a customer (office)
GET    /customers                        List customers
GET    /customers/trash                  List trashed customers (office)
GET    /customers/{id}                   Get one customer
PATCH  /customers/{id}                   Update profile (office)
DELETE /customers/{id}                   Move to trash (office)
POST   /customers/{id}/restore           Restore from trash (office)
GET    /customers/{id}/registration-form Printable registration PDF (office)
GET    /customers/{id}/statement         Statement of account (office)
POST   /customers/{id}/deactivate        Deactivate (office)
POST   /customers/{id}/activate          Reactivate (office)
```

### Susu (17)
```
POST   /susu/accounts                                    Open an account (office)
GET    /susu/accounts                                    List accounts
GET    /susu/accounts/trash                              List trashed accounts (office)
GET    /susu/accounts/{id}                               Detail with cycle progress
DELETE /susu/accounts/{id}                               Move to trash (office)
POST   /susu/accounts/{id}/restore                       Restore from trash (office)
GET    /susu/accounts/{id}/deposits                      Deposit history
POST   /susu/accounts/{id}/deposits                      Record a deposit
GET    /susu/accounts/{id}/deposits/trash                Trashed deposits (office)
PATCH  /susu/accounts/{id}/deposits/{depositId}          Correct latest deposit (office)
DELETE /susu/accounts/{id}/deposits/{depositId}          Trash latest deposit (office)
POST   /susu/accounts/{id}/deposits/{depositId}/restore  Restore a deposit (office)
POST   /susu/collect-all                                 Collect across all accounts (atomic)
POST   /susu/accounts/{id}/close                         Close = withdrawal (office)
POST   /susu/accounts/{id}/terminate                     Terminate below commission (office)
POST   /susu/accounts/{id}/payout                        Pay out pending balance (office)
GET    /susu/summary                                     Daily collection summary
```

### Savings (13)
```
POST   /savings/accounts                                      Open an account (office)
GET    /savings/accounts                                      List accounts
GET    /savings/accounts/trash                                List trashed accounts (office)
GET    /savings/accounts/{id}                                 Detail incl. availableToWithdraw
DELETE /savings/accounts/{id}                                 Move to trash (office)
POST   /savings/accounts/{id}/restore                         Restore from trash (office)
GET    /savings/accounts/{id}/transactions                    Transaction history
GET    /savings/accounts/{id}/transactions/trash              Trashed transactions (office)
DELETE /savings/accounts/{id}/transactions/{txnId}            Trash a transaction (office)
POST   /savings/accounts/{id}/transactions/{txnId}/restore    Restore a transaction (office)
POST   /savings/accounts/{id}/deposits                        Record a deposit (min GHS 10)
POST   /savings/accounts/{id}/withdrawals                     Process a withdrawal (office)
POST   /savings/accounts/{id}/close                           Close the account (office)
```

### Uploads (2)
```
POST   /uploads/images                   Upload an image, get its URL
DELETE /uploads/images                   Delete an uploaded image
```

### Loans (13)
```
GET    /loans/config                     Current tiers, rates, durations
PUT    /loans/config                     Update loan parameters (office)
GET    /loans/eligibility/{customerId}   History summary for the human decision
POST   /loans/applications               Apply for a loan
GET    /loans                            List loans
GET    /loans/trash                      Trashed applications
GET    /loans/{id}                       Detail with schedule and repayments
DELETE /loans/{id}                       Trash an application
POST   /loans/{id}/restore               Restore an application
POST   /loans/{id}/approve               Approve a pending loan
POST   /loans/{id}/reject                Reject a pending loan
POST   /loans/{id}/repayments            Record a cash repayment
POST   /loans/{id}/repayments/susu-closure  Repay by closing a susu account (atomic)
```

### Reports (7)
```
GET    /reports/dashboard                Live dashboard metrics
GET    /reports/transactions             Unified transaction feed
GET    /reports/collections              Collections by staff member
GET    /reports/loans/outstanding        Open loans with balances and days overdue
GET    /reports/loans/aging              Arrears aging buckets
GET    /reports/commission               Susu commissions + savings fees
GET    /reports/workers                  Background-worker heartbeats (admin)
```

### Hire Purchase (23)
```
POST   /hire-purchase/items                             Add an inventory item
GET    /hire-purchase/items                             List inventory
GET    /hire-purchase/items/trash                       Trashed items
PATCH  /hire-purchase/items/{id}                        Update an item
DELETE /hire-purchase/items/{id}                        Trash an item
POST   /hire-purchase/items/{id}/restore                Restore an item
POST   /hire-purchase/items/{id}/adjust-stock           Adjust stock with a reason
GET    /hire-purchase/config                            HP settings
PUT    /hire-purchase/config                            Update the interest rate
GET    /hire-purchase/eligibility/{customerId}          HP eligibility summary
POST   /hire-purchase/agreements                        Sign an agreement
GET    /hire-purchase/agreements                        List agreements
GET    /hire-purchase/agreements/trash                  Trashed agreements
GET    /hire-purchase/agreements/{id}                   Detail with payments
DELETE /hire-purchase/agreements/{id}                   Trash an agreement
POST   /hire-purchase/agreements/{id}/restore           Restore an agreement
POST   /hire-purchase/agreements/{id}/deposit           Record the 50% deposit
POST   /hire-purchase/agreements/{id}/reject            Reject a pending agreement
POST   /hire-purchase/agreements/{id}/payments          Record a monthly payment
POST   /hire-purchase/agreements/{id}/redeem            Redeem a repossessed item
POST   /hire-purchase/agreements/{id}/mark-arrears      Flag as in arrears
POST   /hire-purchase/agreements/{id}/repossess         Record a repossession
POST   /hire-purchase/agreements/{id}/forfeit           Close as forfeited
```

### Transfers (1)
```
POST   /transfers                        Move money between a customer's accounts (office, atomic)
```

### Payments (4)
```
POST   /payments/charges                        Charge a mobile-money wallet via Paystack
GET    /payments/charges/{reference}            Charge status (poll)
POST   /payments/charges/{reference}/verify     Verify with Paystack and apply
POST   /payments/paystack/webhook               Paystack webhook (server-to-server)
```
