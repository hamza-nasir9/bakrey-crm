/**
 * Input validation & sanitisation helpers.
 *
 * The original controllers validated by hand (inconsistently) and built
 * Mongo queries / RegExps straight from user input, e.g.
 * `new RegExp(req.query.search, 'i')` — a ReDoS / regex-injection hole —
 * and object-shaped JSON bodies could smuggle Mongo operators
 * (`{ "username": { "$gt": "" } }`) into queries (NoSQL injection).
 * These three helpers close all three classes of bug.
 */
import { z } from 'zod'

/**
 * Validate req[part] against a zod schema. On success the *parsed* value
 * (trimmed, coerced, unknown keys stripped) replaces the raw input, so
 * controllers only ever see clean data.
 *   router.post('/', validate('body', createOrderSchema), createOrder)
 */
export const validate =
  (part, schema) =>
  (req, res, next) => {
    const result = schema.safeParse(req[part])
    if (!result.success) {
      const first = result.error.issues[0]
      return res.status(400).json({
        message: first ? `${first.path.join('.') || part}: ${first.message}` : 'Invalid input.',
        errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      })
    }
    if (part === 'query') {
      // Express 5: req.query is a getter-only property — reassigning it throws.
      // Mutate the existing object in place instead.
      for (const key of Object.keys(req.query)) delete req.query[key]
      Object.assign(req.query, result.data)
    } else {
      req[part] = result.data
    }
    return next()
  }

/** Escape every regex metacharacter — use for ALL user search strings. */
export const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Safe case-insensitive "contains" regex from raw user input. */
export const searchRegex = (value = '') => new RegExp(escapeRegExp(String(value).slice(0, 100)), 'i')

/**
 * Recursively strip Mongo operator keys ($…) and dotted keys from an
 * object. Apply to req.body/query before anything reaches Mongoose.
 */
export function stripMongoOperators(value) {
  if (Array.isArray(value)) return value.map(stripMongoOperators)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const clean = {}
    for (const [key, val] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.')) continue
      clean[key] = stripMongoOperators(val)
    }
    return clean
  }
  return value
}

export const sanitizeBody = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') req.body = stripMongoOperators(req.body)
  if (req.query && typeof req.query === 'object') {
    // Express 5: req.query has only a getter, so `req.query = …` throws a
    // TypeError (this bug made every request 500 — caught by the cookie-auth
    // end-to-end test). Strip operator keys by mutating the object in place.
    const clean = stripMongoOperators(req.query)
    for (const key of Object.keys(req.query)) delete req.query[key]
    Object.assign(req.query, clean)
  }
  return next()
}

/** Common zod fragments reused by the route schemas. */
export const zodId = z.string().regex(/^[a-f\d]{24}$/i, 'must be a valid id')
export const zodMoney = z.coerce.number().finite().min(0, 'must be zero or greater')
export const zodPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export { z }
