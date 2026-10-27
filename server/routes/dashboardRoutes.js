import { Router } from 'express'
import { dashboardAnalytics, dashboardSummary } from '../controllers/dashboardController.js'
import { allowRoles, authenticate } from '../middleware/auth.js'

const router = Router()
router.get('/summary', authenticate, allowRoles('ADMIN', 'MANAGER', 'CASHIER'), dashboardSummary)
// Chart data contains company-wide profit — never exposed to cashiers.
router.get('/analytics', authenticate, allowRoles('ADMIN', 'MANAGER'), dashboardAnalytics)
export default router
