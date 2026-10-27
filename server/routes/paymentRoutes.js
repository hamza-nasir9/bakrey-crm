import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { createPayment, listPayments, paymentDetails, paymentOptions, voidPayment } from '../controllers/paymentController.js'

const router = Router()
router.use(authenticate)
router.get('/options', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), paymentOptions)
router.post('/', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), createPayment)
router.get('/', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), listPayments)
router.get('/:id', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), paymentDetails)
// Voiding money is ADMIN-only by design (see security/permissions.js).
router.delete('/:id', allowRoles('ADMIN'), voidPayment)
export default router
