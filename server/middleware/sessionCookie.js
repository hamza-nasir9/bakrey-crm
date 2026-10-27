/**
 * HttpOnly session-cookie handling for the JWT.
 *
 * WHY COOKIES INSTEAD OF localStorage
 * -----------------------------------
 * A token in localStorage is readable by ANY JavaScript running on the page,
 * so one XSS flaw (or one malicious dependency) steals the session. An
 * HttpOnly cookie is invisible to page JavaScript — the browser stores it
 * and attaches it automatically, and an XSS bug can no longer exfiltrate it.
 *
 * Cookie flags used here:
 *  - HttpOnly        — not accessible to JS (the whole point).
 *  - Secure          — HTTPS only. Forced in production; off in local dev
 *                      so http://localhost keeps working.
 *  - SameSite        — 'None' in production because the Vercel frontend and
 *                      the API live on different sites (a 'Lax' cookie would
 *                      never be sent cross-site); 'None' requires Secure.
 *                      Local dev uses 'Lax' (same-site localhost ports).
 *                      Override with COOKIE_SAMESITE when your deployment
 *                      is same-site and you want the stricter default.
 *  - Path=/          — sent to the whole API.
 *  - Max-Age         — matches the JWT lifetime so cookie and token expire together.
 *
 * CSRF note: cookie auth re-opens the CSRF question that Bearer headers
 * avoided. Defences in place: (1) all state-changing endpoints require a
 * JSON body, which triggers a CORS preflight for cross-origin callers;
 * (2) CORS is an exact-origin allow-list with credentials; and
 * (3) `csrfOriginGuard` in server/index.js rejects mutating requests whose
 * Origin header is present and not allow-listed.
 */
import env from '../config/env.js'

export const SESSION_COOKIE = env.AUTH_COOKIE_NAME

/** Parse a "8h" / "30m" / "7d" style lifetime into milliseconds. */
export function lifetimeMs(spec = env.JWT_EXPIRES_IN) {
  const match = /^(\d+)\s*([smhd])$/i.exec(String(spec).trim())
  if (!match) return 8 * 60 * 60 * 1000 // safe default: 8 hours
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()]
  return Number(match[1]) * unit
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    maxAge: lifetimeMs(),
  }
}

/** Attach the session JWT as an HttpOnly cookie (login / token refresh). */
export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions())
}

/** Clear the session cookie (logout). Options must match the set call. */
export function clearSessionCookie(res) {
  const { maxAge, ...options } = sessionCookieOptions()
  res.clearCookie(SESSION_COOKIE, options)
}

/**
 * Extract the session JWT from a request.
 * Primary source: the HttpOnly cookie (parsed by cookie-parser into
 * req.cookies, with a manual Cookie-header fallback so this still works if
 * the parser middleware is ever reordered/removed).
 * Bearer-header auth is DISABLED by default and only honoured when
 * ALLOW_BEARER_AUTH=true — an escape hatch for non-browser API clients
 * (e.g. Postman during development), never needed by the web app.
 */
export function getSessionToken(req) {
  const fromParsed = req.cookies?.[SESSION_COOKIE]
  if (fromParsed) return fromParsed

  const cookieHeader = req.headers?.cookie
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=')
      if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) {
        try {
          return decodeURIComponent(part.slice(eq + 1).trim())
        } catch {
          return part.slice(eq + 1).trim()
        }
      }
    }
  }

  if (env.ALLOW_BEARER_AUTH) {
    const header = req.headers?.authorization || ''
    if (header.startsWith('Bearer ')) return header.slice(7).trim()
  }
  return null
}

export default setSessionCookie
