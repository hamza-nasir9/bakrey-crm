# AL KAUSAR BAKREY — Deployment Runbook

This document prepares the React/Vite frontend for Vercel, the Express/Mongoose API for Railway, and the production database for MongoDB Atlas.

## 1. Required production environment variables

### Railway / Express backend

Create these variables in Railway's service Variables page:

```env
NODE_ENV=production
PORT=4000
MONGODB_URI=mongodb+srv://<ATLAS_USER>:<ATLAS_PASSWORD>@<ATLAS_CLUSTER>.mongodb.net/al_kausar_bakrey?retryWrites=true&w=majority
JWT_SECRET=<generate-a-long-random-secret-of-at-least-32-characters>
JWT_EXPIRES_IN=8h
CLIENT_URL=https://<your-vercel-project>.vercel.app
UPLOAD_DIR=uploads
BACKUP_ENCRYPTION_KEY=<another-long-random-secret>
```

Notes:
- URL-encode special characters in the MongoDB Atlas password.
- `CLIENT_URL` may contain comma-separated origins if preview/staging frontends are needed.
- Never commit `.env` or production values to Git.

### Vercel / frontend

Create this variable in Vercel Project Settings → Environment Variables for **Production**:

```env
VITE_API_URL=https://<your-railway-service>.up.railway.app/api
```

Do not use `localhost` in Vercel. Vite environment variables are embedded at frontend build time, so redeploy Vercel after changing `VITE_API_URL`.

## 2. MongoDB Atlas setup

1. Sign in to MongoDB Atlas and create a Free Tier M0 cluster.
2. Create a database user with a strong password and `readWrite` access to `al_kausar_bakrey`.
3. Under Network Access, add Railway's outbound network range or temporarily allow `0.0.0.0/0` for initial verification. Restrict access after deployment.
4. Select **Connect → Drivers → Node.js** and copy the SRV connection string.
5. Replace `<ATLAS_USER>`, `<ATLAS_PASSWORD>`, and `<ATLAS_CLUSTER>` in `MONGODB_URI`.
6. Confirm the database name in the URI is `al_kausar_bakrey`.

## 3. Railway backend deployment

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Railway, choose **New Project → Deploy from Git Repo**.
3. Select the repository and set the root directory to the repository root.
4. Railway automatically detects Node.js. Use these commands:

```bash
Build Command: npm ci && npm run build
Start Command: npm run start
```

5. Add all Railway environment variables listed above.
6. Generate a public domain from Railway networking settings.
7. Update `CLIENT_URL` with the final Vercel production domain.
8. Redeploy Railway after environment-variable changes.

### Railway health check

After deployment, test from a terminal:

```bash
curl -i https://<your-railway-service>.up.railway.app/api/health
```

Expected status: `200 OK`

Expected JSON:

```json
{"status":"ok","database":"mongodb","apiConfigured":true}
```

If it returns an error:
- Check Railway deployment logs.
- Confirm `MONGODB_URI` is present and URL encoded.
- Confirm Atlas Network Access allows the backend connection.
- Confirm Atlas database user credentials are correct.

## 4. Seed the production authentication users

Run this only after Railway has the final production `MONGODB_URI`.

### Option A: Railway shell

Open the Railway service shell and run:

```bash
npm run seed:auth
```

### Option B: local command against the same production URI

Set production variables in a local, uncommitted `.env` file and run:

```bash
npm ci
npm run seed:auth
```

The seed script creates or updates these accounts:

| Role | Username | Password / PIN |
|---|---|---|
| Admin | `admin` | the `SEED_ADMIN_PASSWORD` you set when seeding |
| Cashier 1 | `cashier1` | the SEED_CASHIER_PIN you set |
| Cashier 2 | `cashier2` | `2345` |
| Cashier 3 | `cashier3` | `3456` |
| Cashier 4 | `cashier4` | `4567` |

Change these credentials immediately after the first successful production login using User Management.

## 5. Vercel frontend deployment

1. Import the same repository into Vercel.
2. Framework preset: **Vite**.
3. Build command:

```bash
npm run build
```

4. Output directory:

```text
dist
```

5. Add the final Railway API URL as `VITE_API_URL`.
6. Deploy production.
7. Copy the Vercel production origin and put it into Railway's `CLIENT_URL` exactly, without a trailing slash.
8. Redeploy Railway after the CORS value changes.
9. Redeploy Vercel after any `VITE_API_URL` change.

## 6. Direct API verification commands

Set a shell variable for the Railway API:

```bash
export API=https://<your-railway-service>.up.railway.app/api
```

### Health

```bash
curl -i "$API/health"
```

### Admin login

```bash
curl -i -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your SEED_ADMIN_PASSWORD>","role":"ADMIN"}'
```

Expected: `200 OK`, a `token`, and an Admin user object.

### Cashier login

```bash
curl -i -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cashier1","pin":"<SEED_CASHIER_PIN>","role":"CASHIER"}'
```

Expected: `200 OK`, a `token`, and a Cashier user object.

### JWT protected endpoint

Copy the Admin token returned above:

```bash
export TOKEN=<returned-token>
curl -i "$API/dashboard/summary?period=daily" \
  -b "akb_session=$TOKEN"  # session cookie from the login response (HttpOnly in browsers)
```

Expected: `200 OK` and dashboard JSON.

## 7. Browser verification checklist

After Vercel deployment:

- [ ] Open the Vercel production frontend in an incognito window.
- [ ] Open browser Developer Tools → Console. Confirm zero uncaught errors.
- [ ] Open Developer Tools → Network.
- [ ] Confirm login requests go to the Railway API, not `localhost:4000`.
- [ ] Admin login works using `admin / <your SEED_ADMIN_PASSWORD>`.
- [ ] Cashier login works using `cashier1 / <your SEED_CASHIER_PIN>`.
- [ ] Confirm a JWT is stored in local storage as `akb_token`.
- [ ] Confirm Admin can access Dashboard and User Management.
- [ ] Confirm Cashier cannot access Admin-only API routes.
- [ ] Confirm CORS response headers permit only the configured Vercel origin.
- [ ] Confirm `/api/health` returns database status `mongodb`.
- [ ] Confirm User Management lists the seeded users.
- [ ] Reset all seed credentials before business go-live.

## 8. Pre-handover validation commands

Run from repository root:

```bash
npm ci
npm run lint
npm run build
node --check server/index.js
node --check server/controllers/userController.js
node --check server/routes/userRoutes.js
```

All commands must exit successfully before release.

## 9. Production operations

- Use MongoDB Atlas backups in addition to the application backup export.
- Rotate `JWT_SECRET` only during a controlled maintenance window, because it invalidates active sessions.
- Monitor Railway deployment logs for failed MongoDB connections or uncaught API errors.
- Keep the Atlas database user password, JWT secret, and backup key in the hosting secret manager only.
- Use User Management for future Admin and Cashier accounts. Do not routinely re-run the seed script after initial setup.
