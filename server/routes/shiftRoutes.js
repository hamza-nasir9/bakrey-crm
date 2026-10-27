import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { cancelSchedule, closeShift, currentShift, listShifts, reopenShift, scheduleShift, shiftDetails, shiftReport, startShift, updateSchedule } from '../controllers/shiftController.js'
const router = Router()
router.use(authenticate)
router.get('/current', currentShift)
router.post('/start', allowRoles('ADMIN', 'CASHIER'), startShift)
router.post('/close', allowRoles('ADMIN', 'CASHIER'), closeShift)
router.get('/', allowRoles('ADMIN', 'CASHIER'), listShifts)
router.post('/schedule', allowRoles('ADMIN', 'MANAGER'), scheduleShift)
router.patch('/:id/schedule', allowRoles('ADMIN', 'MANAGER'), updateSchedule)
router.post('/:id/cancel-schedule', allowRoles('ADMIN', 'MANAGER'), cancelSchedule)
// Ownership check for CASHIER lives inside the controller — Admin can view any shift.
router.get('/:id/report', allowRoles('ADMIN', 'CASHIER'), shiftReport)
router.get('/:id', allowRoles('ADMIN', 'MANAGER'), shiftDetails)
router.post('/:id/reopen', allowRoles('ADMIN', 'MANAGER'), reopenShift)
export default router
