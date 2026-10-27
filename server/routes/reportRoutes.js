import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { exportReport, reportAnalytics, reportData } from '../controllers/reportController.js'

const router = Router()
router.use(authenticate, allowRoles('ADMIN', 'MANAGER'))
router.get('/analytics', reportAnalytics)
router.get('/data', reportData)
router.get('/export', exportReport)
export default router
