import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { createExpense, expenseDetails, listExpenses, updateExpense, voidExpense } from '../controllers/expenseController.js'

const router = Router()
router.use(authenticate, allowRoles('ADMIN', 'MANAGER'))
router.get('/', listExpenses)
router.post('/', createExpense)
router.get('/:id', expenseDetails)
router.patch('/:id', updateExpense)
router.delete('/:id', voidExpense)
export default router
