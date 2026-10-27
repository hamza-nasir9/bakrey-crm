import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { addPayment, createSupplier, deactivateSupplier, listSuppliers, supplierProfile, updateSupplier } from '../controllers/supplierController.js'

const router = Router()
router.use(authenticate)
router.get('/', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), listSuppliers)
router.post('/', allowRoles('ADMIN', 'MANAGER'), createSupplier)
router.get('/:id', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), supplierProfile)
router.patch('/:id', allowRoles('ADMIN', 'MANAGER'), updateSupplier)
router.delete('/:id', allowRoles('ADMIN', 'MANAGER'), deactivateSupplier)
router.post('/:id/payments', allowRoles('ADMIN', 'MANAGER'), addPayment)
export default router
