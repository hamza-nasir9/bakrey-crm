/**
 * OPTIONAL integration test (not part of `npm test`):
 *   npm i -D mongodb-memory-server
 *   node server/tests/cookie-auth.e2e.mjs
 * Boots the real API against an in-memory MongoDB and verifies the full
 * cookie-auth lifecycle over HTTP.
 */
import { MongoMemoryServer } from 'mongodb-memory-server'

const mongo = await MongoMemoryServer.create()
process.env.MONGODB_URI = mongo.getUri('bakrey_e2e')
process.env.JWT_SECRET = 'e2e-test-secret-at-least-thirty-two-chars!!'
process.env.NODE_ENV = 'production'
process.env.PORT = '4599'
process.env.CLIENT_URL = 'http://localhost:5173'

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1) } console.log('PASS:', msg) }

await import('../index.js')

// wait for DB + listener
const mongoose = (await import('mongoose')).default
for (let i = 0; i < 40 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 250))
assert(mongoose.connection.readyState === 1, 'API connected to in-memory MongoDB')

const bcrypt = (await import('bcryptjs')).default
const User = (await import('../models/User.js')).default
await User.create({ username: 'admin', name: 'E2E Admin', role: 'ADMIN', passwordHash: await bcrypt.hash('StrongPass#1', 12) })

const base = 'http://127.0.0.1:4599/api'
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({ username: 'admin', password: 'StrongPass#1', role: 'ADMIN' }),
})
assert(login.status === 200, `login returns 200 (got ${login.status})`)
const setCookie = login.headers.get('set-cookie') || ''
assert(setCookie.includes('akb_session='), 'login sets the akb_session cookie')
assert(/httponly/i.test(setCookie), 'cookie is HttpOnly')
assert(/secure/i.test(setCookie), 'cookie is Secure (production)')
assert(/samesite=none/i.test(setCookie), 'cookie is SameSite=None (production cross-site)')
const body = await login.json()
assert(!('token' in body), 'login JSON body contains NO token')
assert(body.user?.role === 'ADMIN', 'login returns the user profile')

const cookieHeader = setCookie.split(';')[0]
const me = await fetch(`${base}/auth/me`, { headers: { Cookie: cookieHeader } })
assert(me.status === 200, '/auth/me with cookie -> 200')

const anon = await fetch(`${base}/auth/me`)
assert(anon.status === 401, '/auth/me without cookie -> 401')

// Raw HTTP for this check: fetch/undici manages the Origin header itself and
// would not faithfully send the attacker Origin we need to simulate.
const { request } = await import('node:http')
const csrfStatus = await new Promise((resolve, reject) => {
  const r = request({ host: '127.0.0.1', port: 4599, path: '/api/auth/logout', method: 'POST',
    headers: { Cookie: cookieHeader, Origin: 'https://evil.example.com', 'Content-Type': 'application/json' } },
    (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
  r.on('error', reject); r.end('{}')
})
assert(csrfStatus === 403, `mutating request from non-allowlisted Origin -> 403 (CSRF guard, got ${csrfStatus})`)

const logout = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: cookieHeader, Origin: 'http://localhost:5173' } })
assert(logout.status === 204, 'logout -> 204')
const clearCookie = logout.headers.get('set-cookie') || ''
assert(clearCookie.includes('akb_session=;') || /expires=thu, 01 jan 1970/i.test(clearCookie) || /max-age=0/i.test(clearCookie), 'logout clears the cookie')

const meAfter = await fetch(`${base}/auth/me`, { headers: { Cookie: cookieHeader } })
assert(meAfter.status === 401, 'old cookie is rejected after logout (token revoked)')

console.log('\nALL COOKIE-AUTH E2E CHECKS PASSED')
process.exit(0)
