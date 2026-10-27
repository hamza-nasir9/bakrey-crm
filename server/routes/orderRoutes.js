import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createOrderSchema, updateOrderSchema } from '../validation/schemas.js'
import { cancelOrder, createOrder, listOrders, orderDetails, orderOptions, updateOrder } from '../controllers/orderController.js'

const router = Router()
router.use(authenticate)
router.post('/', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), validate('body', createOrderSchema), createOrder)
router.get('/options', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), orderOptions)
router.get('/', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), listOrders)
router.get('/:id', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), orderDetails)
router.patch('/:id', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), validate('body', updateOrderSchema), updateOrder)
router.post('/:id/cancel', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), cancelOrder)
export default router
