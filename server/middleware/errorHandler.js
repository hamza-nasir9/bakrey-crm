/**
 * Central error handling + async wrapper.
 * - Known client errors (validation, bad ids, duplicates) get honest 4xx codes.
 * - Everything else is logged server-side and returned as a generic 500 —
 *   stack traces and Mongo internals are never leaked to the client.
 */
import mongoose from 'mongoose'
import env from '../config/env.js'

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

export function notFound(_req, res) {
  return res.status(404).json({ message: 'Route not found.' })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, _req, res, _next) {
  if (error?.name === 'ValidationError') {
    const message = Object.values(error.errors || {})[0]?.message || 'Validation failed.'
    return res.status(400).json({ message })
  }
  if (error instanceof mongoose.Error.CastError) {
    return res.status(400).json({ message: 'Invalid identifier.' })
  }
  if (error?.code === 11000) {
    return res.status(409).json({ message: 'A record with the same unique value already exists.' })
  }
  if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Invalid or expired session.' })
  }
  console.error('[api] Unhandled error:', error)
  return res.status(500).json({
    message: 'An unexpected server error occurred.',
    ...(env.isDev && error?.message ? { detail: error.message } : {}),
  })
}
