import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { createCustomer, customerLedger, customerProfile, deactivateCustomer, listCustomers, updateCustomer } from '../controllers/customerController.js'

const router = Router()
router.use(authenticate)
router.get('/', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), listCustomers)
router.post('/', allowRoles('ADMIN', 'MANAGER'), createCustomer)
// v3: itemised udhar khata — management only (financial detail).
router.get('/:id/ledger', allowRoles('ADMIN', 'MANAGER'), customerLedger)
router.get('/:id', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), customerProfile)
router.patch('/:id', allowRoles('ADMIN', 'MANAGER'), updateCustomer)
router.delete('/:id', allowRoles('ADMIN', 'MANAGER'), deactivateCustomer)
export default router
