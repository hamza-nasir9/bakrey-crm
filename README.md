# AL KAUSAR BAKREY — Production Guide (v2.0.0)

> **Upgraded to enterprise grade — see `UPGRADE_NOTES.md` for the full audit,
> the RBAC matrix (Admin / Manager / Cashier), and the deploy checklist.**
> ⚠️ If you are upgrading from the old ZIP: rotate the Atlas password,
> JWT secret and backup key first — they were exposed in the old `.env`.

## Project structure
- `src/` — React JavaScript frontend, routes, reusable module components, API client, responsive CSS.
- `server/config/` — MongoDB connection configuration.
- `server/models/` — Mongoose schemas and business collections.
- `server/controllers/` — REST request validation and module logic.
- `server/services/` — dashboard, reporting, shift, and daily-closing calculations.
- `server/routes/` — authenticated REST API routes.
- `server/middleware/` — JWT authentication and role authorization.
- `server/scripts/` — authentication user seeding.
- `public/` — static frontend assets.

## MongoDB collections
`users`, `counters`, `suppliers`, `supplierpayments`, `customers`, `inventoryitems`, `purchases`, `stockusages`, `stockadjustments`, `orders`, `payments`, `employees`, `attendances`, `salaries`, `expenses`, `shifts`, `dailyclosings`, `activitylogs`, `settings`, `notifications`, and `backups`.

## REST API documentation
All business APIs require a signed-in session: the JWT is carried in an **HttpOnly cookie** (`akb_session`) set by `POST /api/auth/login` — browsers send it automatically, and API clients must pass the cookie. (Bearer-header auth is disabled by default; see `ALLOW_BEARER_AUTH` in `.env.example`.)

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` (revokes the session)
- `GET /api/dashboard/analytics?range=daily|weekly|monthly` — Sales & Net Profit series for the dashboard charts (Admin/Manager)
- `GET /api/audit-logs` — staff activity trail with filters + CSV export (Admin/Manager)
- `GET /api/inventory/alerts` — low-stock / expiring-soon / expired items (`?days=30`)
- `GET /api/dashboard/summary`
- `GET|POST /api/inventory/items`, `PATCH|DELETE /api/inventory/items/:id`, `POST /api/inventory/purchases|usage|adjustments`
- `GET|POST /api/suppliers`, `GET|PATCH|DELETE /api/suppliers/:id`, `POST /api/suppliers/:id/payments`
- `GET|POST /api/customers`, `GET|PATCH|DELETE /api/customers/:id`
- `GET|POST /api/orders`, `GET|PATCH /api/orders/:id`, `POST /api/orders/:id/cancel`
- `GET|POST /api/payments`, `GET /api/payments/:id`, `DELETE /api/payments/:id`
- `GET|POST /api/employees`, `GET|PATCH|DELETE /api/employees/:id`
- `GET|POST /api/attendance`, `POST /api/attendance/bulk`, `PATCH|DELETE /api/attendance/:id`
- `GET|POST /api/salaries`, `GET /api/salaries/:id`, `POST /api/salaries/:id/pay`, `DELETE /api/salaries/:id`
- `GET|POST /api/expenses`, `GET|PATCH|DELETE /api/expenses/:id`
- `GET /api/shifts`, `GET /api/shifts/current`, `POST /api/shifts/start|close|:id/reopen`
- `GET|POST /api/daily-closings`, `GET /api/daily-closings/preview`, `POST /api/daily-closings/:id/lock|unlock`
- `GET /api/reports/analytics|data|export`
- `GET /api/system/notifications|settings|backups`, `PATCH /api/system/notifications/:id|credentials`, `PUT /api/system/settings`, `POST /api/system/backups`, `GET /api/system/backups/:id/export`

## Environment variables
Copy `.env.example` to `.env`.
- `MONGODB_URI` — MongoDB Atlas database connection string.
- `JWT_SECRET` — long random production secret.
- `JWT_EXPIRES_IN` — JWT lifetime, default `8h`.
- `CLIENT_URL` — comma-separated frontend origins. This must include the exact deployed Vercel origin, for example `https://your-project.vercel.app`.
- `VITE_API_URL` — frontend build-time API URL, for example `https://your-backend-domain/api`. Set this in Vercel before deploying; a Vercel frontend cannot use `localhost:4000` in a visitor's browser.
- `PORT` — API port.
- `UPLOAD_DIR` — future Multer attachment destination.
- `BACKUP_ENCRYPTION_KEY` — reserved backup encryption secret.

## Installation
1. Install Node.js 20+ and create a MongoDB Atlas Free Tier cluster.
2. Configure Atlas network access and database user.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and fill secure production values.
5. Seed required users with `npm run seed:auth`.
6. Run frontend: `npm run dev`; run API: `npm run server`.
7. Verify with `npm run build` and `GET /api/health`.

## Deployment
- Deploy frontend to Vercel with `VITE_API_URL=https://your-api-domain/api`.
- Deploy API to Railway or a VPS with `npm run server`.
- Add all server environment variables in the hosting dashboard. Use a secure Atlas URI, non-default JWT secret, and exact Vercel `CLIENT_URL`.
- After the backend has its production `MONGODB_URI`, run `npm run seed:auth` once in that same backend environment. Seeding a local database does not seed the Atlas database used by production.
- Restrict Atlas network access to production infrastructure, enable database backups, TLS, and monitoring.

## Demo credentials
Change these immediately after seeding:
- Admin: `admin` / the `SEED_ADMIN_PASSWORD` you set when seeding
- Cashier 1: `cashier1` / the `SEED_CASHIER_PIN` you set when seeding
- Cashier 2: `cashier2` / PIN `2345`
- Cashier 3: `cashier3` / PIN `3456`
- Cashier 4: `cashier4` / PIN `4567`

## Testing and production readiness report
- Frontend production build: passed.
- Backend JavaScript syntax checks: passed across controllers, routes, models and services.
- Role authorization: Admin-only management routes plus cashier order/payment/shift restrictions.
- Input validation: required values, MongoDB IDs, date ranges, positive amounts, enum fields, duplicate-day attendance, duplicate salary periods, stock checks, payment balance checks, and active-shift checks.
- Security: Helmet, CORS, login rate limits, JWT sessions, bcrypt hashes, server-side validation and Activity Logs.
- Database integrity: generated IDs, unique indexes, soft void/deactivation records, foreign references, server-side balances and totals.
- Responsive testing target: desktop, tablet, mobile CSS breakpoints across module screens.
- Cross-browser target: current Chrome, Edge, Firefox, and Safari; verify final hosted API environment before go-live.

## Final system review
Dashboard, reports, daily closing, profit and all module calculations consume MongoDB data. Transactional data remains centralized: purchases feed inventory/supplier totals; order payments feed orders/customers/revenue; salary data uses attendance snapshots; expenses exclude salary and purchase duplication; shifts link cashier order/payment actions; closing stores only final report snapshots. No business calculation is intentionally performed as a frontend source of truth.
