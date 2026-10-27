/**
 * Authentication + authorisation middleware.
 *
 * Upgrades over the original version:
 *  1. Algorithm pinned to HS256 and issuer/audience verified, so a token
 *     minted for another system (or `alg: none` tricks) fails.
 *  2. The user is re-loaded on every request and checked for `isActive` and
 *     `tokenVersion`. Deactivating a user or resetting credentials (which
 *     bumps tokenVersion) now kills existing sessions immediately —
 *     previously a JWT stayed valid for its full 8h even after lock-out.
 *  3. `allowRoles` is kept for backwards compatibility; new code should use
 *     `requirePermission(...)` from the central RBAC matrix.
 */
import jwt from 'jsonwebtoken'
import env from '../config/env.js'
import User from '../models/User.js'
import { roleHasPermission } from '../security/permissions.js'
import { getSessionToken } from './sessionCookie.js'

export async function authenticate(req, res, next) {
  try {
    // JWT now travels in an HttpOnly cookie (see middleware/sessionCookie.js) —
    // it is never exposed to frontend JavaScript or localStorage.
    const token = getSessionToken(req)
    if (!token) return res.status(401).json({ message: 'Authentication required.' })

    let payload
    try {
      payload = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      })
    } catch {
      return res.status(401).json({ message: 'Invalid or expired session.' })
    }

    const user = await User.findById(payload.sub).select('role isActive tokenVersion username name').lean()
    if (!user || !user.isActive) return res.status(401).json({ message: 'Session is no longer valid.' })
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ message: 'Session was revoked. Please sign in again.' })
    }

    // Keep the original `req.auth` shape ({ sub, role }) so existing controllers keep working.
    req.auth = { sub: user._id.toString(), role: user.role, username: user.username, name: user.name }
    req.user = user
    return next()
  } catch (error) {
    return next(error)
  }
}

/** Legacy role gate — still used by untouched route modules. */
export const allowRoles = (...roles) => (req, res, next) =>
  roles.includes(req.auth?.role)
    ? next()
    : res.status(403).json({ message: 'You do not have permission for this action.' })

/** Preferred gate: requirePermission('reports:view') */
export const requirePermission = (...permissions) => (req, res, next) =>
  permissions.every((p) => roleHasPermission(req.auth?.role, p))
    ? next()
    : res.status(403).json({ message: 'You do not have permission for this action.' })

/** Sign a session token. Always include tokenVersion (`tv`) for revocation. */
export function signSessionToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, tv: user.tokenVersion ?? 0 },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
  )
}

export const publicUser = (user) => ({
  id: user._id,
  username: user.username,
  name: user.name,
  role: user.role,
})
