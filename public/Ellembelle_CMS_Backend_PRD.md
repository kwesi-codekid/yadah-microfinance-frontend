# Ellembelle CMS — Backend (API) Build Specification

**Audience:** AI coding agents (and the backend developer, Jacob).
**Scope:** Backend/API only. No UI work. This document is the source of truth for what to build, in what order, and by what rules.
**Companion:** `Ellembelle_CMS_Backend_WBS_Tracker.xlsx` — the same 23 work items, tracked for the PM. WBS IDs in this document (e.g. `0.1`, `5.2`) match the tracker exactly.

> **How to use this doc.** Work top-to-bottom in WBS order (Section 10). Each task lists its dependencies, deliverables, and a checklist. Do not start a task whose dependencies are unchecked. Business rules in Sections 4–9 are binding — when a rule and your instinct disagree, the rule wins; if a rule seems wrong, stop and flag it rather than "fixing" it silently.

> **Flagged assumptions** (override freely; each is marked `ASSUMPTION` where it appears):
> - RBAC role names and the permission model are a proposal (Section 3.6).
> - "Long-lived" JWT = 90 days, configurable via env (Section 5).
> - `membershipNumber` is a client-defined unique string; format not validated beyond uniqueness (Section 4.3).
> - Gantt/estimates are calendar-day based (see tracker), not working days.

---

## 1. Overview & Scope

### 1.1 What this system is
A centralized, role-based Constituency Management System for the NDC Ellembelle Constituency. The backend exposes a REST API consumed by a PWA frontend (built separately). It digitizes membership/leadership records, communications/events, election archives, reporting, party documentation, government-project tracking, and member feedback.

### 1.2 In scope (this build)
Seven functional modules plus system-wide cross-cutting features, all as API endpoints:
1. Membership & Leadership Registry
2. Communication, Event & Activity Tracker
3. Election Management & Schedules
4. Reports
5. Documentation & Records
6. Government Projects
7. Complaints & Suggestions

Cross-cutting: SMS-OTP auth, role-based access control (RBAC), audit trail, soft-delete, notifications abstraction, OpenAPI docs.

### 1.3 Out of scope — do NOT build
These are Phase 2 / excluded. If a task seems to require them, stop and flag:
- OCR / scanned-document data extraction (upload is supported; extraction is not).
- Polling-station-level general-election data (regional-level figures only this phase).
- Auto-population of the executives registry from election results (executives are managed manually).
- Read receipts / acknowledgment tracking on announcements.
- Offline mode / write queue.
- Employment records (unscoped — do not model unless explicitly added).
- **Any financial management** — incoming donations, dues, accounting. (The donations registry in Section 4/3.5 is a *benevolence record of items the party gave out*, not money handling.)

---

## 2. Tech Stack & Conventions

### 2.1 Locked stack
| Concern | Choice |
|---|---|
| Runtime / language | Node.js (LTS) + TypeScript (strict) |
| Web framework | Express |
| Database | MongoDB on Coolify, **replica set** (transactions available) |
| ODM | Mongoose |
| Validation | Zod (single source of truth for request + env validation) |
| Logging | Pino (+ pino-http request logging) |
| API docs | OpenAPI 3.1 + Scalar UI |
| Auth | SMS OTP → long-lived, **stateless** JWT |
| SMS provider | smsonlinegh |
| API prefix | `/api/v1` |
| Testing | Vitest + `mongodb-memory-server` (`MongoMemoryReplSet`) |

### 2.2 Folder structure (feature-module based)
```
src/
  app.ts                 # express app assembly (middleware, routes, error handler, openapi)
  server.ts              # bootstrap: env, db connect, listen
  config/
    env.ts               # Zod-validated environment schema (fail-fast on boot)
    constants.ts
  db/
    connection.ts        # mongoose connect (replica set), graceful shutdown
    plugins/
      audit.plugin.ts    # audit-trail (see 3.5)
      softDelete.plugin.ts
  lib/
    logger.ts            # pino instance
    jwt.ts               # sign/verify
    otp.ts               # generate/hash/verify OTP codes
    openapi.ts           # registry + Scalar mount
    apiError.ts          # typed error class
    response.ts          # success/error envelope helpers
  middleware/
    auth.ts              # verify JWT, attach req.user
    rbac.ts              # requirePermission(...)
    validate.ts          # zod request validation (body/params/query)
    requestLogger.ts     # pino-http
    errorHandler.ts      # central error → envelope
  modules/
    auth/
    members/
    tein/
    leadership/          # executives, ward coordinators, committees
    communications/
    events/
    elections/
    reports/
    documentation/       # reference library + donations
    projects/
    complaints/
    portal/              # member-facing read endpoints
  notifications/
    index.ts             # Notifier facade + channel selection
    channel.ts           # NotificationChannel interface
    adapters/
      smsOnlineGh.adapter.ts
      whatsapp.adapter.ts   # stub
      push.adapter.ts       # stub (web-push)
  types/
    express.d.ts         # req.user augmentation
test/
  setup.ts               # MongoMemoryReplSet lifecycle
  <module>.test.ts
```

Per module, use consistent layers:
`*.model.ts` (Mongoose) · `*.schema.ts` (Zod request/response) · `*.service.ts` (business logic, owns transactions) · `*.controller.ts` (thin HTTP) · `*.routes.ts` · `*.openapi.ts` (path registration) · `*.test.ts`.

### 2.3 Conventions
- **Files:** `<entity>.<layer>.ts` (e.g. `member.service.ts`). **Collections:** lowercase plural (`members`, `teinmembers`).
- **Identifiers:** `camelCase` for variables/functions, `PascalCase` for types/models/interfaces, `SCREAMING_SNAKE` for constants/env.
- **Commits:** Conventional Commits — `feat(members): ...`, `fix(auth): ...`, `test(elections): ...`, `chore:`, `docs:`, `refactor:`. Scope = module name.
- **HTTP:** plural resource nouns, kebab-case paths where multi-word (`/ward-coordinators`). Standard verbs. Filtering via query params, never in the path.
- **Async:** async/await only; no floating promises. Services throw `ApiError`; controllers never build error responses by hand.
- **No business logic in controllers or models.** Controllers parse → call service → shape response. Models hold schema + hooks only.

### 2.4 Response envelope (every endpoint)
Success:
```json
{ "data": <payload>, "error": null, "meta": { "requestId": "...", "pagination": { "page": 1, "limit": 20, "total": 137 } } }
```
Error:
```json
{ "data": null, "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": [ ... ] } }
```
- `meta.pagination` present only on list endpoints.
- `error.code` is a stable enum string (e.g. `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`).
- HTTP status still set correctly (400/401/403/404/409/500) — the envelope mirrors it, doesn't replace it.

### 2.5 Pagination / filtering / sorting (list convention)
- Query: `?page=1&limit=20&sort=-createdAt&<field>=<value>`.
- `limit` default 20, max 100. Always return `meta.pagination`.
- Filtering fields are declared per module (see each module's endpoint table). Reject unknown filter keys.

---

## 3. Cross-Cutting Foundations

### 3.1 Config / environment (`config/env.ts`)
Validate all env at boot with Zod; **fail fast** with a clear message if anything is missing/invalid. Minimum keys:
```
NODE_ENV, PORT,
MONGODB_URI            # includes ?replicaSet=...
JWT_SECRET, JWT_EXPIRES_IN (default "90d")
OTP_TTL_SECONDS (default 300), OTP_LENGTH (default 6), OTP_MAX_ATTEMPTS (default 5)
SMSONLINEGH_API_KEY, SMSONLINEGH_SENDER_ID, SMSONLINEGH_BASE_URL
CORS_ORIGINS
LOG_LEVEL (default "info")
```
Export a typed, frozen `env` object. Nothing else in the app reads `process.env` directly.

### 3.2 Database connection (`db/connection.ts`)
- Connect via Mongoose to the replica-set URI. Enable retry, sane pool size, and `serverSelectionTimeoutMS`.
- Expose a `/health` route (in `app.ts`) returning DB connectivity + uptime.
- Graceful shutdown on SIGTERM/SIGINT (drain, close connection).
- **Transactions:** services that write more than one document atomically (any audited write; see 3.5) must use a Mongoose session/transaction. The replica set makes this available — use it; do not fake atomicity.

### 3.3 Validation middleware (`middleware/validate.ts`)
`validate({ body?, params?, query? })` runs the given Zod schemas, replaces `req.*` with the parsed/typed result, and on failure throws `ApiError('VALIDATION_ERROR', 400, issues)`. Every write endpoint validates its body; list endpoints validate query.

### 3.4 Logging (`lib/logger.ts`, `middleware/requestLogger.ts`)
- Pino root logger, level from env, pretty transport in dev only.
- `pino-http` attaches a per-request child logger + `requestId` (also surfaced in `meta.requestId`).
- **Never log OTP codes, JWTs, or full phone numbers** (mask to last 3 digits).

### 3.5 RBAC, Audit trail, Soft-delete (cross-cutting — build before modules)

**Soft-delete plugin (`softDelete.plugin.ts`):** adds `deletedAt: Date | null` (default null) and `deletedBy: ObjectId | null`. Default query middleware (`find`, `findOne`, aggregate `$match` helper) excludes `deletedAt != null`. A `.withDeleted()` escape hatch for admin/audit reads. Deletes are updates that set `deletedAt`/`deletedBy` — **never hard-delete** (except OTPs and expired ephemeral data).

**Audit plugin (`audit.plugin.ts`):** on create/update/soft-delete, write an `AuditLog` entry `{ actor, action, resource, resourceId, before, after, at }`. The audit write and the data write happen **in the same transaction** — if the audit write fails, the data write rolls back. Because writes are audited, services (not models) own the transaction boundary; the plugin participates in the session passed by the service.

**RBAC middleware (`middleware/rbac.ts`):** `requirePermission('members:create')` etc. Reads `req.user.permissions` (resolved from roles at auth time or per-request). Throws `FORBIDDEN` if missing. See 3.6 for the model.

### 3.6 Roles & permissions — `ASSUMPTION` (proposal, override as needed)
Permission strings are `resource:action` (`members:read`, `members:create`, `reports:submit`, `complaints:assign`, ...). Roles are seeded documents holding a permission set; a user has one or more roles; effective permissions = union. Roles are data (assignable/reassignable per person, per the proposal's "delegated and reassigned easily").

Proposed seed roles:
| Role | Intent |
|---|---|
| `super_admin` | Full access, role assignment, audit access |
| `constituency_admin` | Constituency-wide manage across modules |
| `constituency_exec` | Portfolio officer; broad read + own-portfolio write |
| `branch_exec` | Manage own branch's members/events/reports |
| `ward_coordinator` | Read + coordinate within ward |
| `tein_exec` | Manage TEIN chapter registries |
| `member` | Member portal only (see 3.8 / Module portal) |

Scope note: several permissions are **branch/ward-scoped** — a `branch_exec` may only write records for their own branch. Encode scope in the service layer (compare `req.user.branch` to the target record), not just the permission string.

### 3.7 OpenAPI + Scalar (`lib/openapi.ts`)
- Build the OpenAPI 3.1 document incrementally: each module's `*.openapi.ts` registers its paths/schemas (derive response/request schemas from the module's Zod schemas via `zod-to-openapi` or equivalent).
- Mount Scalar UI at `/docs`, serve raw spec at `/openapi.json`.
- Every endpoint added must be registered — an unregistered endpoint is an incomplete task.

### 3.8 Member portal principle
Authenticated `member` role can read: their own membership record, general announcements, upcoming public events, government projects, and submit complaints/suggestions. Everything else (other members' contacts, donations, reports, election archives, executive directories) is **restricted**. Enforce at the service layer, not just the route.

---

## 4. Data Model

All schemas get: `timestamps: true` (createdAt/updatedAt), the soft-delete plugin, and the audit plugin (except `OtpRequest` and `AuditLog` itself). Reference other documents by `ObjectId` with `ref`. Indexes listed are the minimum.

### 4.1 Reference hierarchy
- **Branch** — `{ name, code (unique), ward (ref Ward), electoralArea?, contact? }`. Index: `code`.
- **Ward** — `{ name, code (unique) }`.
- **TeinChapter** — `{ name, institution, branch (ref Branch)? }` — a tertiary-institution chapter within the constituency.
- **Committee** — `{ name, description?, members: [{ name, portfolio?, contact? }], level: 'branch'|'constituency', branch? }`.

### 4.2 Roles / Users
- **Role** — `{ name (unique), description?, permissions: string[] }`.
- **User** — `{ name, phone (unique, normalized E.164-ish), roles: [ref Role], branch (ref Branch)?, ward (ref Ward)?, member (ref Member)?, isActive }`. Index: `phone`. `member` links a portal user to their membership record.

> A `User` is anyone who signs in (officers + members). A `Member` is a membership *record* (may exist without a login). When a member is given portal access, create/link a `User` with role `member` pointing at that `Member`.

### 4.3 Membership & TEIN (the counting core — read carefully)
- **Member** (the branch membership record — **this is what constituency totals count**):
  `{ name, membershipNumber (unique), branch (ref Branch, required), contact, registrationDate, status: 'active'|'inactive' }`.
  Index: `membershipNumber` (unique), `branch`.
  `ASSUMPTION`: `membershipNumber` is a client-defined unique string; only uniqueness is enforced.

- **TeinMember** (TEIN registry record):
  `{ name, contact, chapter (ref TeinChapter, required), teinType: 'local'|'visiting', status: 'active'|'graduated', member (ref Member)?, homeBranch (ref Branch)?, homeConstituency?: string }`.
  Index: `chapter`, `teinType`, `status`.

**Counting rules (BINDING):**
1. **Constituency total registered members = count of `Member` where `deletedAt == null`.** Nothing else contributes.
2. **Local TEIN member** (`teinType: 'local'`): registration also creates (or links) a `Member` branch record with their `homeBranch`. They therefore count **once**, via `Member`. `TeinMember.member` points to that record.
3. **Visiting TEIN member** (`teinType: 'visiting'`, from another constituency): recorded as **TEIN-only**. **No `Member` record is created.** `homeConstituency` is captured. They **do not** count toward constituency totals.
4. **Local and visiting TEIN are counted separately** — TEIN stats return `{ localActive, localGraduated, visitingActive, visitingGraduated }`, never merged into one figure, and never folded into the constituency total.
5. Registering a local TEIN member is a **two-document write** (Member + TeinMember) → transaction.

### 4.4 Leadership
- **Executive** — `{ name, portfolio, level: 'branch'|'constituency', branch (ref Branch)?, contact }`. (Branch executives require `branch`; constituency executives don't.) Managed **manually** — not derived from elections this phase.
- **WardCoordinator** — `{ name, ward (ref Ward), branch (ref Branch)?, contact }`.

### 4.5 Communications & Events
- **Communication** — `{ type: 'press_release'|'letter'|'memo'|'announcement'|'circular', title, body?, date, attachments: [FileRef], category?, audience? }`. Index: `type`, `date`.
- **Event** — `{ type: 'branch_meeting'|'constituency_meeting'|'outreach', title, date, venue, purpose, branch?, outcome?: string, followUp?: string }`. (Community outreach and stakeholder engagement are the single `outreach` category.) `outcome`/`followUp` are optional, completed after the event → running activity log. Index: `date`, `type`.
- **FileRef** (embedded, reused everywhere): `{ url, filename, mimeType, size, uploadedBy, uploadedAt }`. Storage handling: store metadata + object-store URL; actual upload mechanism is a small sub-task in 0.x/module tasks (presigned URL or multipart — pick one and keep it consistent).

### 4.6 Elections
- **Election** — `{ level: 'branch'|'constituency'|'regional'|'national'|'main', date, venue?, positions: [{ title, candidates: [{ name, votes? }], winner?: string }], documents: [FileRef], notes? }`.
  - Branch/constituency: full detail (positions, candidates, votes, winners).
  - Regional/national/main: **regional-level figures only** — coarser entry, `documents` attachable. Do not model station-level fields.
  Index: `level`, `date`.

### 4.7 Reports
- **Report** — `{ type: 'monthly_secretary'|'campaign'|'election', period: { from, to }, office?, status: 'draft'|'submitted', title, narrative?, autoData?: object, attachments: [FileRef], source: 'in_app'|'upload', author (ref User) }`. Index: `type`, `status`, `period.from`.
  - `source: 'in_app'` → written/generated in-platform (draft→submit).
  - `source: 'upload'` → externally produced report/presentation, categorized/filterable.
  - `autoData` holds the pre-filled aggregation snapshot (see Module Reports rules).

### 4.8 Documentation & Donations
- **Document** — `{ type: 'constitution'|'manifesto'|'policy'|'regulation', title, file: FileRef, version?, effectiveDate? }`. Reference library; uploaded once, read by authorized users.
- **Donation** — `{ date, item, recipient, community, occasion?, presentingOffice?, estimatedValue?: number, photos: [FileRef], linkedEvent (ref Event)? }`. Filter: community, year (from `date`), type/item. **This is a benevolence record of things given out — not money handling.** Index: `community`, `date`.

### 4.9 Government Projects
- **Project** — `{ name, community, sector, status: 'upcoming'|'ongoing'|'completed', timeline: { start?, end? }, description?, photos: [FileRef], notes?: [{ text, at, by }] }`. Filter: community, sector, status. Index: `community`, `sector`, `status`.

### 4.10 Complaints
- **Complaint** — `{ category, description, community?, branch?, photos: [FileRef], isAnonymous: boolean, submittedBy (ref User)?, status: 'new'|'under_review'|'resolved', assignedTo (ref User)?, resolution?: string, history: [{ status, at, by }] }`. Index: `status`, `assignedTo`. When `isAnonymous`, do not store/return `submittedBy`.

### 4.11 Auth / Audit (ephemeral + system)
- **OtpRequest** — `{ phone, codeHash, expiresAt, attempts, consumed }`. TTL index on `expiresAt`. **Hard-deleted/expired** — the one collection exempt from soft-delete. Never audited.
- **AuditLog** — `{ actor (ref User)?, action: 'create'|'update'|'delete', resource, resourceId, before?, after?, at }`. Append-only; never edited or soft-deleted. Index: `resource`, `resourceId`, `at`.

---

## 5. Authentication (WBS 2.1, 2.2)

**Flow (SMS OTP → stateless JWT):**
1. `POST /api/v1/auth/otp/request` `{ phone }` → normalize phone; generate `OTP_LENGTH`-digit code; store `codeHash` (hashed, never plaintext) with `expiresAt = now + OTP_TTL_SECONDS`; send via smsonlinegh. Respond `202` with no code. Rate-limit per phone.
2. `POST /api/v1/auth/otp/verify` `{ phone, code }` → find latest unconsumed, unexpired OtpRequest; check attempts < `OTP_MAX_ATTEMPTS`; compare hash; on success mark consumed, resolve/create `User`, issue JWT. On failure increment attempts.
3. JWT payload: `{ sub: userId, roles, permissions, branch?, ward? }`, `expiresIn = JWT_EXPIRES_IN` (**`ASSUMPTION` default 90d, configurable**).

**Revocation:** none — pure stateless JWT (decided). A lost device stays valid until expiry; documented tradeoff. No token-version, no deny-list this phase.

**`auth` middleware:** verify JWT, load fresh `isActive` check (reject inactive users), attach `req.user`.

---

## 6. Modules — Endpoints, Rules & Task Checklists

> All paths are under `/api/v1`. **Auth** column: role/permission required. All writes are audited + validated. All lists paginate/filter per Section 2.5. Sensitive endpoints are officer-only per Section 3.8.

### 6.1 Membership & Leadership Registry — WBS 5.1, 5.2, 5.3

**Members (5.1)**
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/members` | `members:create` (branch-scoped) | Create branch member |
| GET | `/members` | `members:read` | List/filter (branch, status, q) |
| GET | `/members/:id` | `members:read` | Detail |
| PATCH | `/members/:id` | `members:update` (branch-scoped) | Update |
| DELETE | `/members/:id` | `members:delete` | Soft-delete |
| GET | `/members/stats/total` | `members:read` | **Total registered = count Member where not deleted** |
| GET | `/members/stats/by-branch` | `members:read` | Counts grouped by branch (aggregation) |

Rules: total computed from `Member` only (4.3 rule 1). `by-branch` via aggregation pipeline; exclude soft-deleted in `$match`.

**TEIN (5.2)**
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/tein/members` | `tein:create` | Register TEIN member (local → also creates Member, in a transaction) |
| GET | `/tein/members` | `tein:read` | List/filter (chapter, teinType, status) |
| GET | `/tein/members/:id` | `tein:read` | Detail |
| PATCH | `/tein/members/:id` | `tein:update` | Update (incl. status active→graduated) |
| DELETE | `/tein/members/:id` | `tein:delete` | Soft-delete |
| GET | `/tein/stats` | `tein:read` | `{ localActive, localGraduated, visitingActive, visitingGraduated }` — never merged, never in constituency total |
| GET | `/tein/chapters` / POST | `tein:read` / `tein:manage` | Chapter registry |

Rules: enforce 4.3 rules 2–5. `local` registration = two-doc transaction (Member + TeinMember linked). `visiting` = TeinMember only, `homeConstituency` required, **no Member**.

**Leadership (5.3)** — Executives, Ward Coordinators, Committees. Standard CRUD each:
`/executives`, `/ward-coordinators`, `/committees` (POST/GET/GET:id/PATCH/DELETE). Executives managed manually (no election auto-populate). Branch execs require `branch`.

Checklist 5.1: [ ] Member model+indexes [ ] CRUD+validation [ ] branch-scope enforcement [ ] total + by-branch aggregation [ ] tests (counting correctness, soft-delete excluded from totals).
Checklist 5.2: [ ] TeinMember model [ ] local-registration transaction (Member+TeinMember) [ ] visiting excluded from Member [ ] separated stats [ ] tests (local counts once; visiting excluded; graduation).
Checklist 5.3: [ ] Executive/WardCoordinator/Committee CRUD [ ] scope rules [ ] tests.

### 6.2 Communication, Event & Activity Tracker — WBS 6.1

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST/GET/GET:id/PATCH/DELETE | `/communications` | `communications:*` | Archive of press releases/letters/memos/announcements/circulars — categorized, dated, searchable, attachments |
| POST/GET/GET:id/PATCH/DELETE | `/events` | `events:*` | Calendar entries: branch/constituency meetings + outreach (single category) |
| PATCH | `/events/:id/outcome` | `events:update` | Add outcome/follow-up post-event (activity log) |

Rules: outreach = single category (community outreach + stakeholder engagement). Events carry date/venue/purpose/type. Delivery of a communication triggers the notifier (6.8) per tier: push for general info, SMS/WhatsApp for events & critical.

Checklist 6.1: [ ] Communication + Event models [ ] search/filter (type, date range, q) [ ] outcome/follow-up [ ] notifier hook on publish [ ] tests.

### 6.3 Election Management & Schedules — WBS 6.2

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST/GET/GET:id/PATCH/DELETE | `/elections` | `elections:*` | Archive by level |

Rules: branch/constituency = full detail (positions, candidates, votes, winners, docs). regional/national/main = regional-level figures only + attachable docs (no station-level fields — that's excluded). Upcoming election *schedules* are `Event` entries, not `Election` records. Executives NOT auto-populated from results.

Checklist 6.2: [ ] Election model (level-conditional validation) [ ] CRUD + document attach [ ] filter by level/date [ ] tests (level-appropriate required fields).

### 6.4 Reports — WBS 6.3 (heaviest module)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/reports` | `reports:create` | Create draft (in-app) |
| GET/GET:id/PATCH | `/reports` | `reports:read`/`update` | List/detail/edit draft |
| POST | `/reports/:id/submit` | `reports:submit` | draft → submitted |
| POST | `/reports/generate` | `reports:create` | **Auto-generate**: pre-fill from records for a period/type |
| GET | `/reports/:id/export` | `reports:read` | Export to PDF/Word |
| POST | `/reports/upload` | `reports:create` | Upload externally-produced report/presentation |

Auto-generation rule: for `{ type, period }`, aggregate across collections — meetings held, members registered, communications issued, elections conducted in the period — into `autoData`. Author reviews, adds narrative, exports. Export produces standard PDF/Word (document generation is a discrete sub-task; keep the aggregation and the export separable).

Checklist 6.3: [ ] Report model + draft/submit workflow [ ] period aggregation service (reuse module aggregations) [ ] upload path [ ] export (PDF/Word) [ ] tests (aggregation correctness over a seeded period, draft→submit guardrails).

### 6.5 Documentation & Records — WBS 6.4

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST/GET/GET:id/PATCH/DELETE | `/documents` | `documents:*` | Reference library (constitution, manifestos, policies, regulations) |
| POST/GET/GET:id/PATCH/DELETE | `/donations` | `donations:*` | Benevolence registry (items given out) |

Rules: donations filterable by community, year, item/type; optional link to an outreach `Event`. **Not financial** — no money in/out, no accounting.

Checklist 6.4: [ ] Document + Donation models [ ] filters [ ] donation→event link [ ] tests.

### 6.6 Government Projects — WBS 6.5

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST/GET/GET:id/PATCH/DELETE | `/projects` | `projects:*` | Project registry |
| PATCH | `/projects/:id/status` | `projects:update` | Advance status (upcoming→ongoing→completed) |

Rules: filter by community, sector, status. Members (portal) can read projects.

Checklist 6.5: [ ] Project model [ ] status transitions [ ] filters [ ] tests.

### 6.7 Complaints & Suggestions — WBS 6.6

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/complaints` | `member`+ | Submit (anonymous option) |
| GET/GET:id | `/complaints` | `complaints:read` | Officer list/detail |
| PATCH | `/complaints/:id/assign` | `complaints:assign` | Assign handler |
| PATCH | `/complaints/:id/status` | `complaints:update` | new→under_review→resolved |

Rules: anonymous submissions store no `submittedBy` and never leak it. Status transitions recorded in `history`. Role-based handler assignment.

Checklist 6.6: [ ] Complaint model + history [ ] anonymous handling (no submitter stored/returned) [ ] assign + status workflow [ ] tests (anonymity, transitions).

### 6.8 Member Portal — WBS 6.7

Read-only member-facing endpoints enforcing Section 3.8:
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/portal/me` | `member` | Own membership record |
| GET | `/portal/announcements` | `member` | General announcements |
| GET | `/portal/events` | `member` | Upcoming public events |
| GET | `/portal/projects` | `member` | Government projects |
| POST | `/portal/complaints` | `member` | Submit complaint/suggestion |

Rule: absolutely no access to other members' contacts, donations, reports, election archives, or executive directories. Enforce in service, not just route.

Checklist 6.7: [ ] portal read endpoints [ ] strict scoping [ ] tests (member cannot reach restricted resources).

---

## 7. Notifications Abstraction — WBS 4.1

`NotificationChannel` interface: `send(to: string[], payload: NotificationPayload): Promise<Result>`.
`Notifier` facade selects channel(s) by tier:
- **General information** → push (web-push stub this phase).
- **Events & critical communications** → SMS (smsonlinegh, live) and/or WhatsApp (stub).

Adapters: `smsOnlineGh.adapter.ts` (live, real API), `whatsapp.adapter.ts` (stub — correct interface, no live send), `push.adapter.ts` (stub). Modules call the `Notifier` facade, never an adapter directly. Failures are logged and non-blocking (a failed broadcast must not fail the underlying write).

Checklist 4.1: [ ] channel interface [ ] Notifier tier routing [ ] smsonlinegh live adapter [ ] whatsapp/push stubs [ ] tests (routing + adapter contract, mocked HTTP).

---

## 8. Build Order (WBS) — dependency-sequenced

Matches the tracker. Do not start a task with unmet dependencies. Milestone tags: **M2** = core live (early Sept), **M3** = full delivery (by target).

| WBS | Task | Depends on | Milestone |
|---|---|---|---|
| 0.1 | Project setup, folder structure, config/env | — | pre-M2 |
| 0.2 | Mongo connection (replica set) + health | 0.1 | pre-M2 |
| 0.3 | Error handling, envelope, Pino | 0.1 | pre-M2 |
| 0.4 | OpenAPI + Scalar wiring | 0.1 | pre-M2 |
| 1.1 | Core schemas (Member/Branch/Ward/Committee/Executive) | 0.2 | pre-M2 |
| 1.2 | TEIN schemas + counting/hierarchy + indexes | 1.1 | pre-M2 |
| 1.3 | Remaining module schemas | 1.1 | pre-M2 |
| 2.1 | OTP request/verify (smsonlinegh) | 1.1, 0.3 | M2 |
| 2.2 | JWT issuance + auth middleware | 2.1 | M2 |
| 3.1 | RBAC middleware | 2.2 | M2 |
| 3.2 | Audit-trail + soft-delete plugins | 0.2, 3.1 | M2 |
| 4.1 | Notifications abstraction + smsonlinegh adapter + stubs | 0.3 | M2 |
| 5.1 | Member CRUD + branch aggregation | 1.1, 3.1, 3.2 | **M2** |
| 5.2 | TEIN registry endpoints | 1.2, 3.1, 3.2 | **M2** |
| 5.3 | Executives/wards/committees directories | 1.1, 3.1, 3.2 | **M2** |
| 6.1 | Communications & Events | 4.1, 3.* | M3 |
| 6.2 | Elections archive | 1.3, 3.* | M3 |
| 6.3 | Reports (in-app + auto-gen + export) | 5.*, 6.1, 6.2 | M3 |
| 6.4 | Documentation & Donations | 1.3, 3.* | M3 |
| 6.5 | Government Projects | 1.3, 3.* | M3 |
| 6.6 | Complaints & Suggestions | 1.3, 3.*, 2.2 | M3 |
| 6.7 | Member portal endpoints | 5.1, 6.1, 6.5, 6.6 | M3 |
| 7.1 | OpenAPI polish + full integration test pass | all | M3 |

Note: 6.3 (Reports) depends on the module aggregations it summarizes — build it after those modules exist, not before.

---

## 9. Testing Conventions — WBS 7.1 (and per-module)

- **Runner:** Vitest. Assertion API Jest-compatible.
- **DB:** `mongodb-memory-server` using **`MongoMemoryReplSet`** (not single-instance) — transactions must be exercised for real. `test/setup.ts` spins it up once, clears collections between tests.
- **Do NOT mock Mongo for the critical paths.** These get real integration tests against the replica set:
  1. **Audit atomicity** — a forced audit-write failure rolls back the data write (transaction).
  2. **Counting** — constituency total = Member count; local TEIN counts once; visiting TEIN excluded; soft-deleted excluded.
  3. **Soft-delete** — deleted records absent from normal reads, present via `.withDeleted()`, and excluded from all stats/aggregations.
  4. **RBAC/scoping** — branch_exec cannot write another branch's records; member cannot reach restricted resources.
- **HTTP:** integration tests hit the Express app (supertest or Vitest fetch) end-to-end for each module's happy path + auth failure + validation failure.
- **Mock only external HTTP** (smsonlinegh, WhatsApp/push) at the adapter boundary.
- **Coverage:** aim ≥ 80% on services; every business rule in Sections 4–7 has a named test.
- Every endpoint must appear in the OpenAPI spec (7.1 verifies).

---

## 10. Definition of Done (per task)
A WBS task is done when: models/endpoints implemented per spec · Zod validation on all inputs · RBAC + audit + soft-delete applied · OpenAPI registered · named tests for its business rules pass against the replica set · `recalc`-clean is N/A (that's the tracker) but `tsc --noEmit`, lint, and `vitest` all pass · conventional-commit history.

*End of specification. Flag any rule that looks wrong rather than working around it.*
