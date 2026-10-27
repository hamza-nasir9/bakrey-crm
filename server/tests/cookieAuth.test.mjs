/**
 * Unit tests for the HttpOnly session-cookie helpers (no DB needed).
 * Run:  npm test
 * Env is set before importing because config/env.js validates at import time.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/bakrey_test'
process.env.JWT_SECRET ||= 'test-secret-at-least-sixteen-chars'
process.env.NODE_ENV = 'production'

const { getSessionToken, lifetimeMs, sessionCookieOptions, SESSION_COOKIE } =
  await import('../middleware/sessionCookie.js')

test('token is read from the parsed cookie (cookie-parser path)', () => {
  const req = { cookies: { [SESSION_COOKIE]: 'jwt-abc' }, headers: {} }
  assert.equal(getSessionToken(req), 'jwt-abc')
})

test('token falls back to the raw Cookie header', () => {
  const req = { headers: { cookie: `other=1; ${SESSION_COOKIE}=jwt-xyz; theme=dark` } }
  assert.equal(getSessionToken(req), 'jwt-xyz')
})

test('no cookie -> no token (Bearer is ignored by default)', () => {
  const req = { headers: { authorization: 'Bearer should-not-be-used' } }
  assert.equal(getSessionToken(req), null)
})

test('cookie options are HttpOnly, Secure and SameSite=None in production', () => {
  const opts = sessionCookieOptions()
  assert.equal(opts.httpOnly, true)
  assert.equal(opts.secure, true)
  assert.equal(opts.sameSite, 'none')
  assert.equal(opts.path, '/')
})

test('lifetime parsing matches JWT_EXPIRES_IN', () => {
  assert.equal(lifetimeMs('8h'), 8 * 3_600_000)
  assert.equal(lifetimeMs('30m'), 30 * 60_000)
  assert.equal(lifetimeMs('7d'), 7 * 86_400_000)
  assert.equal(lifetimeMs('nonsense'), 8 * 3_600_000) // safe default
})
