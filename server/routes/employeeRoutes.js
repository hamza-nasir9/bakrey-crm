import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { createEmployee, deactivateEmployee, employeeProfile, listEmployees, updateEmployee } from '../controllers/employeeController.js'

const router = Router()
router.use(authenticate, allowRoles('ADMIN', 'MANAGER'))
router.get('/', listEmployees)
router.post('/', createEmployee)
router.get('/:id', employeeProfile)
router.patch('/:id', updateEmployee)
router.delete('/:id', deactivateEmployee)
export default router
