/**
 * Auth routes — logic lives in controllers/authController.js.
 * Login is rate-limited in server/index.js (per-route limiter) AND the
 * controller locks accounts after repeated failures.
 */
import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { loginSchema } from '../validation/schemas.js'
import { login, logout, me } from '../controllers/authController.js'

const router = Router()
router.post('/login', validate('body', loginSchema), login)
router.get('/me', authenticate, me)
router.post('/logout', authenticate, logout)
export default router
