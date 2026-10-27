import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { createSalary, listSalaries, paySalary, previewSalary, salaryDetails, salaryOptions, voidSalary } from '../controllers/salaryController.js'

// Managers may VIEW payroll; creating, paying and voiding stay ADMIN-only.
const router = Router()
router.use(authenticate)
router.get('/preview', allowRoles('ADMIN', 'MANAGER'), previewSalary)
router.get('/options', allowRoles('ADMIN', 'MANAGER'), salaryOptions)
router.get('/', allowRoles('ADMIN', 'MANAGER'), listSalaries)
router.post('/', allowRoles('ADMIN'), createSalary)
router.get('/:id', allowRoles('ADMIN', 'MANAGER'), salaryDetails)
router.post('/:id/pay', allowRoles('ADMIN'), paySalary)
router.delete('/:id', allowRoles('ADMIN'), voidSalary)
export default router
