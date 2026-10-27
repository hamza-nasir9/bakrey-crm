import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { auditLogOptions, listAuditLogs } from '../controllers/auditLogController.js'

// The audit trail is management-only: it names individual staff actions.
const router = Router()
router.use(authenticate, allowRoles('ADMIN', 'MANAGER'))
router.get('/options', auditLogOptions)
router.get('/', listAuditLogs)
export default router
