# CarrierPay

Role-based **transportation operations + payroll** application for a single trucking company. It manages drivers, dispatchers, equipment, and loads, then calculates weekly payroll — earnings, reimbursements, advances, and deductions — with exact integer-cent math, produces approval-ready batches, and publishes signed **PDF paystubs**.

Built to the `CarrierPay_Complete_PRD.docx` specification (all 9 phases), TypeScript-strict end to end, and packaged for local or single-VPS deployment.

---

## Features

- **Roles & permissions** — `SUPER_ACCOUNT_MANAGER`, `ASSISTANT_ACCOUNT_MANAGER`, `DISPATCHER`, `DRIVER` with a permission matrix enforced on every route.
- **Operations** — load booking with a state machine (Draft → Booked → Assigned → In transit → Delivered → Payroll locked), equipment tracking with one-active-assignment-per-unit rules, driver roster and lifecycle (suspend / terminate / role conversion).
- **Pay rules** — versioned, effective-dated rule sets with components: linehaul % of load gross, fixed per load, cents per loaded/total mile, flat weekly, commissions, weekly guarantees, per-active-driver bonuses.
- **Payroll engine** — weekly window (Sat→Fri, DST-safe), per-source-line `ROUND_HALF_UP`, recurring items, manual adjustments with audit reasons, blocking validation flags, idempotent recalculation, immutable approval totals hash.
- **Paystubs** — Playwright/Chromium PDFs with a company masthead, grouped line items, year-to-date table, SHA-256 checksum, settlement numbers, and versioned revisions (`-R2`, `-R3`, …).
- **Payments** — record how/when a paystub was actually paid.
- **System** — opaque server-side sessions (SHA-256 token hashes, HttpOnly SameSite=Strict cookie), CSRF double-submit, Argon2id password hashing, full audit trail, in-app notifications, CSV exports, role-aware dashboard, scheduled weekly calculations with startup catch-up.

### Golden fixture (PRD §17)

A seeded demo company with 7 delivered loads at 30% linehaul reproduces the PRD golden numbers exactly:

| | Amount |
|---|---|
| Gross revenue | **$13,225.40** |
| Earnings (30%) | **$3,967.62** |
| Reimbursements | **$87.90** |
| Deductions | **$250.00** |
| **Net pay** | **$3,805.52** |

The seed prints these numbers and exits non-zero if they ever drift.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite 5, React Router 6, TypeScript strict |
| Backend | Node.js ≥ 20, Express 4, TypeScript strict (ESM) |
| Data | SQLite via Prisma ORM (WAL, foreign keys, migrations) |
| Auth | Argon2id, opaque sessions, CSRF double-submit |
| PDF | Playwright Chromium |
| Scheduler | node-cron (weekly payroll window + startup reconciliation) |
| Testing | Vitest (unit), Supertest (integration), E2E golden-fixture checks |
| Logging | Pino / pino-http |

Monorepo (npm workspaces):

```
apps/
  api/          Express API + scheduler + paystub generator
  web/          React SPA
packages/
  shared/       shared enums, Zod schemas, money math, types
  prisma/       Prisma schema, migrations, seed
scripts/        setup / backup / restore / verify helpers
storage/        SQLite database, paystubs, logos, backups, Playwright browsers
```

---

## Quick start

```bash
# 1. Install + migrate + seed + install Playwright Chromium (one command)
npm run setup

# 2a. Development (API :4000 + web :5173, hot reload)
npm run dev
#     Open http://localhost:5173

# 2b. Production (single process, API serves the built SPA on :4000)
npm run build
npm start
#     Open http://localhost:4000
```

### Demo logins (seeded)

| Role | Username | Password |
|---|---|---|
| Super account manager | `admin` | `AdminPass123!` |
| Assistant account manager | `assistant` | `Assistant123!` |
| Dispatcher | `dispatcher` | `Dispatcher123!` |
| Driver | `driver` | `DriverPass123!` |

The seed creates a payroll period in **PENDING_APPROVAL** state with the golden-fixture numbers. Sign in as `admin`, open **Payroll**, and Approve → Publish to generate real PDF paystubs.

---

## Common commands

```bash
npm run setup            # full local setup (install, migrate, seed, browsers)
npm run dev              # dev servers (api + web)
npm run build            # production build (shared → api → web)
npm start                # run production server (:4000)
npm run typecheck        # typecheck every workspace
npm test                 # unit tests (api)
npm run test:e2e         # integration + golden-fixture tests (api)
npm run db:migrate       # create/apply a Prisma migration
npm run db:seed          # re-seed golden fixture (idempotent)
npm run verify-install   # health check (env, builds, DB, golden numbers)
npm run backup           # snapshot DB + paystubs → storage/backups/
npm run restore -- storage/backups/<folder>   # restore a snapshot
```

---

## Environment

All settings have sane defaults (see `.env.example`). Copy it to `.env` and adjust if needed:

```bash
cp .env.example .env
```

Key variables: `NODE_ENV`, `HOST`, `PORT`, `APP_BASE_URL`, `SESSION_TTL_HOURS`, `SECURE_COOKIES`, `DATABASE_URL`, `STORAGE_ROOT`, `PLAYWRIGHT_BROWSERS_PATH`.

Business settings (timezone, week start, payroll cron, settlement numbering, …) are managed in the UI under **Company Settings** and stored in SQLite.

---

## Architecture notes

### Money & rounding

Every monetary value is an **integer number of cents**; percentages are **basis points** (30% = `3000`); mileage is **hundredths of a mile**. Each source line is rounded half-up to the nearest cent using exact `bigint` arithmetic, then lines are summed — percentages are never applied to batch totals.

```ts
// packages/shared/src/money/money.ts
percentOfCents(189200, 3000) === 56760   // 30% of $1,892.00
milesToCents(15000, 250)     === 37500   // 150.00 mi × 250¢
```

### Payroll lifecycle

```
DRAFT ──calculate──▶ CALCULATING ──▶ PENDING_APPROVAL ──approve──▶ APPROVED
                                                        └──publish──▶ GENERATING ──▶ PUBLISHED
CALCULATING ──▶ FAILED (on error)
PUBLISHED/VOID are terminal; corrections flow through paystub revisions.
```

- The engine selects eligible **delivered** loads in the window, the **effective** pay rule at each user's relevant date, recurring items due, and approved manual items.
- Idempotency is enforced at three levels: the period is unique by `scheduler_key`; recurring items by `(recurring_item, period)`; line items by `(entry, source_type, source_id, category)`.
- A per-process async mutex serializes calculations; the `DRAFT→CALCULATING` status is the DB-level guard.
- **Approval** records a SHA-256 hash of all entry totals — an immutable snapshot for later dispute.
- **Publishing** generates paystubs, then locks the delivered loads that fed the period (`PAYROLL_LOCKED`).

### Security

- Passwords hashed with **Argon2id**.
- Sessions: random 256-bit token → cookie (`HttpOnly`, `SameSite=Strict`); only its SHA-256 hash is stored server-side.
- CSRF: double-submit token in `X-CSRF-Token`, required on all unsafe requests.
- Password resets revoke all existing sessions.
- Audit log records actor, action, entity, before/after JSON, reason, request id, and IP for every material mutation.

### Data

- SQLite with `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout`.
- Migrations under `packages/prisma/migrations/` (`prisma migrate deploy`).
- Backups via `npm run backup` use the SQLite online-backup API when available (Node ≥ 22.5) for consistent snapshots.

---

## Testing

- **Unit (money + calculator)** — `npm test` runs Vitest across `packages/shared` (exact integer-cent math, `ROUND_HALF_UP`, the 7-load golden sum) and `apps/api` (driver/dispatcher/assistant calculators, guarantee top-ups, `summarizeLines` flags).
- **E2E / integration (Supertest)** — `npm run test:e2e` migrates + seeds a throwaway SQLite database (`storage/database/carrierpay-test.db`), boots the real Express app, and walks the golden path end-to-end: health → setup status → login/CSRF → `/me` permissions → role-aware dashboards → payroll review (driver entry asserts the exact PRD numbers) → idempotent recalculate → approve (SHA-256 totals hash) → audit trail, plus authorization negatives (driver denied period access, blocked double-approval).

---

## Deployment (single VPS)

```bash
# On the server
git clone <repo> && cd CarrierPay
npm run setup            # install, migrate, seed, browsers
npm run build
SECURE_COOKIES=true APP_BASE_URL=https://your.domain npm start
```

Put it behind nginx/Caddy with TLS. Everything (API + SPA + SQLite + PDFs) runs in one Node process, so a single VPS is enough. Back up with `npm run backup`.

---

## License / note

Built as a full-stack engineering deliverable against the CarrierPay product spec. Demo data is fictional.
# CarrierPay
