# Bakrey CRM — Enterprise Upgrade Notes (v2.0.0)

This document is the audit report + change log for the upgrade. The original
codebase was functional but **not production-safe**: it shipped live secrets,
had a stock-leak bug in order delivery, paid full monthly salary regardless
of absence, and had no Manager role or frontend route protection.

---

## 🚨 ACTION REQUIRED FIRST — rotate compromised secrets

The ZIP contained a real `.env` with a **live MongoDB Atlas password, the
production JWT secret, and a backup encryption key**, and `.gitignore` did
not exclude `.env`. Treat all three as compromised:

1. **Atlas** → Database Access → change the DB user's password → update `MONGODB_URI`.
2. Generate a **new `JWT_SECRET`** (≥ 32 random chars). This also logs everyone out — good.
3. Generate a **new `BACKUP_ENCRYPTION_KEY`**.
4. Delete `.env` from any shared copy/repo history (this package excludes it).

Seed credentials were also hard-coded (`Admin@123`, PINs `1234`…). The new
seed script takes credentials from `SEED_*` env vars and refuses weak values.

---

## Audit findings (what was wrong)

| # | Area | Finding | Severity |
|---|------|---------|----------|
| 1 | Secrets | Real `.env` in repo; `.gitignore` missing `.env`; `.env.example` malformed (two vars concatenated on one line) | **Critical** |
| 2 | Orders/Inventory | Delivery deducted stock item-by-item with no transaction/rollback — a short item left earlier items deducted and the order undelivered (stock leak, retry = more leak) | **Critical** |
| 3 | Auth | JWT valid for full 8h even after user deactivation/credential reset; no issuer/audience/algorithm pinning; no brute-force lockout | High |
| 4 | Payroll | Monthly salary paid in full regardless of absences; overtime was a free-typed amount unrelated to recorded hours; no "Late" status existed | High |
| 5 | Injection | `new RegExp(req.query.search)` in 8 controllers (ReDoS/regex injection); no Mongo-operator sanitisation of bodies | High |
| 6 | RBAC | Only ADMIN/CASHIER existed; frontend routes checked only "logged in" — any cashier could open /users, /salaries, /reports, /system URLs | High |
| 7 | Inventory | No expiry date on items at all; low-stock threshold existed but no alerts endpoint/UI | Medium |
| 8 | Orders | Same item listed twice on one order broke/mis-counted stock checks | Medium |
| 9 | Frontend | `api.js` logged API URL/errors to console, no 401 handling (dead sessions looked "logged in"); missing `@tailwindcss/vite` plugin in `vite.config.js`; no dev proxy | Medium |
| 10 | Seed | Hard-coded weak credentials in source | High |
| 11 | Users | Role checks like `role==='ADMIN'` scattered in controllers made adding a role error-prone | Medium |

What was already good and was **kept**: atomic guarded stock update
(`quantity: { $gte }`), cashier scoping (own orders, cost prices stripped,
shift-gated transactions), hashed PINs, activity logging, counter-based
human IDs, per-route rate limit on auth, Helmet/CORS allow-list.

---

## What changed

### Security & RBAC (priority 1)
- **`server/config/env.js`** — zod-validated environment, fail-fast at boot; refuses short JWT secrets in production.
- **`server/security/permissions.js`** — single RBAC matrix. Roles: **ADMIN** (all), **MANAGER** (new: runs shop, inventory, orders, attendance, reports; *cannot* manage users, pay/void salaries, void payments, change system settings/backups, lock closings), **CASHIER** (own shift, own orders, no costs/reports/payroll).
- **`server/middleware/auth.js`** — HS256 pinned, issuer/audience verified, user re-checked per request (`isActive` + `tokenVersion`). Deactivation/reset **revokes live sessions instantly**. `requirePermission()` added; `allowRoles()` kept compatible.
- **`server/controllers/authController.js`** — login extracted from the route; **account lockout** (5 fails → 15 min, PINs included), anti-enumeration (identical errors + dummy bcrypt compare), `lastLoginAt`, `POST /auth/logout` revokes by version bump. MANAGER logs in with a password; CASHIER with PIN.
- **`server/middleware/validate.js` + `server/validation/schemas.js`** — zod validation for auth/orders/inventory/attendance/salary-preview; `sanitizeBody` strips `$`-operator keys (NoSQL injection); `searchRegex()` escapes all user search text — applied to **every** controller that built RegExps from input.
- **`server/index.js`** — global rate limit, sanitiser, central error handler (no stack leaks), 404 handler, graceful shutdown, optional `TRUST_PROXY`.
- **Routes** — MANAGER added precisely per matrix (e.g. salaries: manager can *view*, only ADMIN can create/pay/void; payment void + refunds stay ADMIN-only).
- **Seed** — env-driven, refuses weak/default secrets, adds a MANAGER account, forces credential change on first login.

### Core business logic (priority 2)
- **Atomic sales/inventory** — `server/services/orderStockService.js`: delivery now runs in a **MongoDB transaction** on Atlas/replica sets; on standalone mongod it falls back to the same guarded updates **with compensating rollback**. Invariant: delivered ⇔ every line deducted exactly once. Duplicate order lines are merged at creation.
- **Alerts** — `InventoryItem` gains `expiryDate` + `batchNo`; `GET /api/inventory/alerts` returns low-stock / expiring-soon (default 30 days, `?days=`) / expired; `InventoryAlerts` panel shows them on the Dashboard; Inventory form gained Expiry/Batch fields.
- **Invoicing** — new `/orders/:id/invoice` page (`Invoice.jsx` + print CSS): **1-click A4 invoice and 80mm thermal receipt**, including payment history. The Orders detail modal now links to it instead of printing the whole page.
- **Attendance → Payroll** — `server/services/payrollService.js` (used by preview + create):
  - Attendance gains **Late** status (UI + API + schema).
  - **Monthly pay is pro-rated**: `monthlySalary × payableDays / periodDays` (was: full pay always).
  - Payable days: Present/Late = 1, Half Day = 0.5, Absent/Leave = 0; **every 3 lates deduct 1 day** (`LATE_TO_ABSENT_RATIO`).
  - **Overtime auto-computed**: `overtimeHours × (dailySalary/8) × OVERTIME_MULTIPLIER` unless explicitly overridden; the snapshot saved on each salary now records late days, payable days and period days for audit.
- **Frontend RBAC** — `src/lib/roles.js` + route `Guard` in `App.jsx`; login gains a Manager mode; `api.js` clears dead sessions on 401 and no longer logs internals; User Management can create Managers (password-based).
- **Config hygiene** — clean `.env.example`, `.env` git-ignored, `vite.config.js` fixed (Tailwind plugin + `/api` dev proxy), package renamed `bakrey-crm` v2.0.0, `zod` added.

### Deliberately NOT changed
Existing controller business logic, schemas (beyond additive fields),
human-readable ID counters, shift scheduling, daily closing, reports and
backups — they were sound. All schema changes are additive/backward-compatible;
existing data needs **no migration** (new fields default safely).

---

## Deploy / verify checklist

```bash
npm install
cp .env.example .env            # fill ROTATED secrets
SEED_ADMIN_PASSWORD=… SEED_MANAGER_PASSWORD=… SEED_CASHIER_PIN=… npm run seed:auth
npm run build                   # frontend
npm run server                  # API  → GET /api/health
npm test                        # payroll unit tests
```

- Atlas (replica set) gives you real transactions automatically; a standalone
  local mongod uses the rollback fallback — both paths are covered.
- Frontend on Vercel: set `VITE_API_URL=https://<your-api>/api` at build time.
- First login for seeded users forces a credential change.

## Known follow-ups (recommended, not in this drop)
- Add refresh-token rotation on top of the cookie session (theft detection
  via token-family reuse).
- Apply zod schemas to the remaining modules (pattern is established).
- A scheduled job to push expiry/low-stock alerts into the notifications table.
- Split the minified single-line controllers into formatted modules over time.

---

## v2.1.0 — HttpOnly cookie authentication (follow-up release)

The JWT no longer touches JavaScript or localStorage anywhere:

- **Login** (`authController`) sets the token as an **HttpOnly cookie**
  (`akb_session`): `Secure` in production, `SameSite=None` in production so
  a Vercel frontend can talk to an API on another domain (`Lax` in local dev;
  override with `COOKIE_SAMESITE` if your deployment is same-site). The JSON
  login response now contains **only the user profile — no token**.
- **Middleware** (`sessionCookie.js` + `auth.js`) extracts and verifies the
  JWT from `req.cookies` (cookie-parser, with a raw-header fallback).
  Bearer-header auth is off by default (`ALLOW_BEARER_AUTH=true` re-enables
  it for non-browser tooling only).
- **Logout** clears the cookie **and** bumps `tokenVersion`, so the old
  cookie value is dead even if copied. Session restore on page load uses
  `GET /auth/me`; the React app keeps auth state in memory only.
- **CORS** now uses `credentials: true` (safe because origins are an exact
  allow-list), and a **CSRF origin guard** rejects state-changing requests
  whose `Origin` is present but not allow-listed.
- **Frontend**: Axios runs with `withCredentials: true`; the Authorization
  interceptor and all `localStorage` token handling were removed.

Verified end-to-end against a real (in-memory) MongoDB + the real Express
app — script kept at `server/tests/cookie-auth.e2e.mjs`: login sets an
HttpOnly/Secure/SameSite=None cookie and leaks no token, cookie authenticates
`/auth/me`, no-cookie requests get 401, foreign-Origin mutations get 403,
logout clears the cookie and revokes the old token.

**Bug found by that E2E test (fixed in this release):** `sanitizeBody`
reassigned `req.query`, which is a getter-only property in Express 5 — it
would have thrown on live requests. Fixed by mutating the query object in
place (same fix applied to the zod `validate()` helper), and the CORS
origin callback no longer throws (blocked origins now get a clean response
instead of a 500).

---

## v2.2.0 — Dashboard graphs, Audit Logs page, friendly exports

- **Visual Sales & Profit graphs** — `GET /api/dashboard/analytics?range=daily|weekly|monthly`
  (Admin/Manager only) returns a proper time series; the Dashboard renders it
  with **Recharts** (Sales bars + Net Profit line) with a Daily / Weekly /
  Monthly toggle. Definitions match the rest of the app: Sales = order value,
  Net Profit = Revenue − Purchases − Salaries − Expenses. (Bucketing is done
  on UTC calendar days to match MongoDB's `$dateToString`; unit-tested.)
  Managers now get the management dashboard + menu on the frontend too
  (previously they fell through to the cashier view), and an **Audit Logs**
  entry was added to the sidebar.
- **Audit Logs (staff activity tracking)** — the ActivityLog trail the system
  already wrote is now fully browsable at `/audit-logs`: filter by staff
  member, module, date range, or free text; export the filtered trail to CSV.
  Coverage includes order create/update/**cancel**, stock purchases, usage and
  adjustments, item updates — which now record **exactly which fields changed
  (old → new)** — payments incl. voids/refunds, salaries, expenses, user
  management and report exports. **Logins and account lockouts** are now
  audited too (`module: Auth`). API: `GET /api/audit-logs` (+`/options`),
  Admin/Manager only — cashiers get 403.
- **Excel / CSV exports** — Sales (Orders), Expenses and Attendance exports
  now use shaped, human-readable rows (customer/employee names instead of
  ObjectIds, clear column headings) via `exportRows()` in reportService.
  The Expenses and Attendance screens gained server-side **CSV + Excel**
  buttons that export the *full* selected date range (falling back to the
  current month), replacing the old page-limited client-side CSV. Every
  export itself is written to the audit log.

---

## v2.3.0 — Full audit pass + frontend code-splitting

**Bugs found by the audit and fixed**
1. **Reports revenue ignored refunds** (excluded instead of netted), so after any
   refund the Reports page disagreed with the Dashboard and Daily Closing.
   Now every screen nets refunds identically.
2. **Reports + Dashboard profit CHARTS subtracted only expenses**, while their
   own summary cards subtracted purchases + salaries + expenses. Both charts
   now use the single definition: revenue − purchases − salaries − expenses.
   Verified: dashboard cards, reports summary, reports chart and the dashboard
   chart series all return the identical net profit on the same fixture.
3. **Reports day-series shifted by one day** in UTC+5: `daySeries` iterated
   local midnights but keyed by UTC ISO dates, so daily values landed on the
   wrong date. Now iterated in UTC (same class of fix as the chart bucketing).
4. **Stock usage / adjustments used read-check-save**: concurrent requests
   could oversell, and the usage record was written before the stock save
   (orphan records on failure). Both now deduct with an atomic guarded update
   first, record second, re-credit on failure — the same pattern as orders.
5. **Purchases** updated stock and supplier balance via read-modify-save;
   both are now atomic `$inc` writes.
6. **Orders could be created with status `Delivered`** via the API, bypassing
   stock deduction entirely. Creation is now restricted to
   Pending/Confirmed/Completed (matching the UI); delivery only via PATCH.

**Frontend optimisation**
- Every page component is `React.lazy`-loaded (route-level code splitting);
  the Recharts panel is lazy too — cashiers never download chart code.
- Vite `manualChunks` splits react / charts / utils vendor bundles.
- Result: initial JS dropped from a single 434 kB bundle to ~196 kB app +
  cacheable vendor chunks, and **the bundle-size warning is gone**.

**Verification** — `server/tests/audit.e2e.mjs`: 88 assertions over the real
API (order flow incl. duplicate-line merging, invoice data, atomic delivery
with zero partial deduction, cancel + customer balance, financial consistency
across four surfaces, low-stock/expiry alerts, payroll pro-rating + late
deductions + duplicate-period rejection, the complete Admin/Manager/Cashier
RBAC matrix incl. cost/balance hiding, and PIN lockout) — all passing,
alongside the cookie-auth and features suites and 13/13 unit tests.

---

## v3.0.0 — Loyalty & Ledger, Multi-Branch, Recipes/BOM, Notifications, Encrypted Backups

### 1. Customers: Loyalty Points + Ledger (Khata) + Credit Limit
- **Earn:** 1 point per Rs 100 actually PAID (env-tunable: `LOYALTY_STEP_PKR`,
  `LOYALTY_POINTS_PER_STEP`). Earned on payments, never on credit; voiding a
  payment reverses its points. **Redeem:** at order time, 1 point = Rs 1 off
  (`LOYALTY_POINT_VALUE_PKR`), via an atomic guarded decrement — points can
  never be double-spent or go negative. Cancelling an order refunds them.
- **Ledger:** every order/payment/refund/cancel writes an itemised
  `CustomerLedgerEntry` with a running balance — `GET /api/customers/:id/ledger`
  (Admin/Manager) and a Ledger view inside the customer profile, alongside
  the loyalty history.
- **Credit limit:** `Customer.creditLimit` (blank = unrestricted). Orders that
  would push total outstanding past the limit are rejected with the numbers
  spelled out; an Admin can override per-order (`allowCreditOverride`) or
  raise the limit. Set it from the Customers form.

### 2. Multi-Branch & Warehouses
- `Branch` (code/name/BRANCH|WAREHOUSE) + `BranchStock`. The MAIN branch
  keeps `InventoryItem.quantity` as its stock (zero migration for existing
  data); other branches keep their own stock rows. Orders, payments,
  purchases and expenses carry a branch tag; purchases stock the branch they
  were received at, branch orders deduct branch stock on delivery.
- Transfers (`POST /api/branches/transfers`) are atomic with compensation
  and a full history. `GET /api/branches/financials` gives per-branch
  sales/revenue/purchases/expenses/net plus a combined company P&L —
  salaries are company-wide and deducted only in the combined row (stated
  on the report, never hidden inside a branch number).
- UI: **Branches** page (list, transfers, stock by branch, P&L table),
  branch selector on the order form, branch name on invoices.

### 3. WhatsApp / SMS / Email notifications
- Every order creation generates a customer invoice message (WhatsApp) with
  the invoice link. Provider-pluggable service: `NOTIFY_PROVIDER=none`
  (default) records messages in `NotificationLog` as *skipped* — the trail
  exists from day one, nothing is fake-sent; `twilio` (WhatsApp+SMS) and
  `meta` (WhatsApp Cloud API) need only env credentials. Email via SMTP.
- Daily digest of low-stock/expiring/expired items to `ADMIN_ALERT_PHONE` /
  `ADMIN_ALERT_EMAIL` — run manually (`POST /api/system/alerts/digest`) or
  automatically (`ALERT_DIGEST_ENABLED=true`, in-process scheduler).
  Delivery history: `GET /api/system/notification-logs` (Admin).

### 4. Recipes (BOM) + Wastage
- One recipe per finished item with per-unit ingredient quantities and a
  deduction mode. On delivery, INGREDIENTS mode deducts raw materials only
  (made-to-order), BOTH deducts finished + ingredients — inside the same
  atomic delivery, so a short ingredient blocks the whole delivery with no
  partial deduction. Recipe food-cost per unit is computed live from each
  ingredient's latest purchase cost (`GET /api/recipes` returns `costPerUnit`).
- Wastage (`POST /api/inventory/wastage`): Expired/Damaged/Spoiled/Spillage
  write-offs deduct stock atomically and snapshot the unit cost, so the
  loss (Rs) is recorded permanently; the Inventory page shows this month's
  total loss and recent write-offs.

### 5. Automated encrypted backups
- `POST /api/system/backups/encrypted` (Admin) writes an AES-256-GCM
  encrypted snapshot of ALL collections to `BACKUP_DIR`, optionally
  uploading to S3 (`BACKUP_S3_*`, hand-rolled SigV4 — no SDK). Nightly via
  `AUTO_BACKUP_ENABLED=true`. Restore tooling:
  `BACKUP_ENCRYPTION_KEY=… node server/scripts/decrypt-backup.mjs in.enc out.json`
  (decryption verifies the GCM tag and a SHA-256 of the plaintext).
- Note: Google Drive upload is not built in — point `BACKUP_DIR` at a
  Drive-synced folder, or use S3. This is deliberate: Drive requires an
  OAuth/service-account setup that should be the operator's own.

**Verification** — `server/tests/v3-features.e2e.mjs`: 55 assertions over
the real API (loyalty earn/redeem/rejection, ledger trail, credit-limit
block, branch CRUD/transfers/branch-stock delivery, recipe costing Rs 130
fixture + BOM deduction quantities, wastage loss + atomic rejection, branch
financials, notification logging, encrypted-backup decrypt roundtrip, RBAC)
— all passing, with the full previous suites (13 unit + 88 audit + cookie
auth + features) still green.
