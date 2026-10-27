import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { attendanceOptions, bulkAttendance, createAttendance, deactivateAttendance, listAttendance, monthlySummary, updateAttendance } from '../controllers/attendanceController.js'

const router = Router()
router.use(authenticate)
router.get('/options', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), attendanceOptions)
router.post('/', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), createAttendance)
router.get('/summary', allowRoles('ADMIN', 'MANAGER'), monthlySummary)
router.get('/', allowRoles('ADMIN', 'MANAGER'), listAttendance)
router.post('/bulk', allowRoles('ADMIN', 'MANAGER'), bulkAttendance)
router.patch('/:id', allowRoles('ADMIN', 'MANAGER'), updateAttendance)
router.delete('/:id', allowRoles('ADMIN', 'MANAGER'), deactivateAttendance)
export default router
