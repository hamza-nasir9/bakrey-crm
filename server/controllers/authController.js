/**
 * Authentication controller (extracted from authRoutes.js).
 *
 * Security properties:
 *  - Password login for ADMIN and MANAGER; numeric-PIN login for CASHIER.
 *  - Brute-force lockout: 5 consecutive failures lock the account for
 *    15 minutes (applies to PINs too — a 4-digit PIN has only 10k combos).
 *  - Identical error for "no such user" and "wrong secret", plus a dummy
 *    bcrypt compare on the missing-user path, so responses don't reveal
 *    which usernames exist (user enumeration / timing).
 *  - Every successful login stamps lastLoginAt; credential resets bump
 *    tokenVersion, revoking all previously issued JWTs (see middleware/auth).
 *  - PINs must be 4–8 digits and are bcrypt-hashed exactly like passwords —
 *    never stored or logged in plain text.
 */
import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import { ActivityLog } from '../models/BusinessModels.js'
const audit = (data) => ActivityLog.create(data).catch(() => { /* auditing must never break login */ })
import { publicUser, signSessionToken } from '../middleware/auth.js'
import { clearSessionCookie, setSessionCookie } from '../middleware/sessionCookie.js'

const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15
// Pre-computed bcrypt hash used only to equalise response timing.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBk6MqQ3u0JAnEHBJMGwJcSNhHOqNG'

const usesPin = (role) => role === 'CASHIER'

export async function login(req, res, next) {
  try {
    const { username, password, pin, role } = req.body ?? {}
    if (!username || !role || !['ADMIN', 'MANAGER', 'CASHIER'].includes(role)) {
      return res.status(400).json({ message: 'Username and valid role are required.' })
    }
    if (usesPin(role)) {
      if (!pin || !/^\d{4,8}$/.test(String(pin))) {
        return res.status(400).json({ message: 'A 4–8 digit numeric PIN is required.' })
      }
    } else if (!password) {
      return res.status(400).json({ message: 'Password is required.' })
    }

    const user = await User.findOne({ username: String(username).trim().toLowerCase(), role, isActive: true })
      .select('+passwordHash +pinHash +tokenVersion +failedLoginAttempts +lockUntil')

    if (user?.lockUntil && user.lockUntil > new Date()) {
      return res.status(423).json({ message: 'Account temporarily locked after repeated failed attempts. Try again later.' })
    }

    const secret = usesPin(role) ? String(pin) : password
    const storedHash = user ? (usesPin(role) ? user.pinHash : user.passwordHash) : null
    const valid = await bcrypt.compare(secret ?? '', storedHash || DUMMY_HASH)

    if (!user || !valid || !storedHash) {
      if (user) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1
        if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000)
          user.failedLoginAttempts = 0
          await audit({ module: 'Auth', action: 'Account locked', description: `${user.username} (${user.role}) was locked for ${LOCK_MINUTES} minutes after repeated failed sign-in attempts.`, actor: user._id })
        }
        await user.save()
      }
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    user.failedLoginAttempts = 0
    user.lockUntil = undefined
    user.lastLoginAt = new Date()
    await user.save()
    await audit({ module: 'Auth', action: 'Login', description: `${user.username} (${user.role}) signed in.`, actor: user._id })

    // The JWT is delivered ONLY as an HttpOnly cookie — it is deliberately
    // NOT included in the JSON body, where page JavaScript could read it.
    setSessionCookie(res, signSessionToken(user))
    return res.json({ user: publicUser(user) })
  } catch (error) {
    return next(error)
  }
}

export async function me(req, res, next) {
  try {
    const user = await User.findById(req.auth.sub)
    if (!user || !user.isActive) return res.status(401).json({ message: 'Session is no longer valid.' })
    return res.json({ user: publicUser(user) })
  } catch (error) {
    return next(error)
  }
}

/** POST /api/auth/logout — stateless JWTs can't be deleted, so revoke by version bump. */
export async function logout(req, res, next) {
  try {
    await User.updateOne({ _id: req.auth.sub }, { $inc: { tokenVersion: 1 } })
    clearSessionCookie(res) // browser deletes the HttpOnly session cookie
    return res.status(204).end()
  } catch (error) {
    return next(error)
  }
}
