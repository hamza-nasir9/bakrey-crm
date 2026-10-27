import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createInventoryItemSchema } from '../validation/schemas.js'
import { createAdjustment, createItem, createPurchase, createUsage, createWastage, listWastage, history, inventoryAlerts, listItems, removeItem, updateItem } from '../controllers/inventoryController.js'

const router = Router()
router.use(authenticate)
router.get('/items', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), listItems)
// UPGRADE: low-stock / expiring / expired alerts for dashboard + notifications.
router.get('/alerts', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), inventoryAlerts)
router.post('/items', allowRoles('ADMIN', 'MANAGER'), validate('body', createInventoryItemSchema), createItem)
router.patch('/items/:id', allowRoles('ADMIN', 'MANAGER'), updateItem)
router.delete('/items/:id', allowRoles('ADMIN', 'MANAGER'), removeItem)
router.get('/items/:id/history', allowRoles('ADMIN', 'MANAGER'), history)
router.post('/purchases', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), createPurchase)
router.post('/usage', allowRoles('ADMIN', 'MANAGER'), createUsage)
router.post('/adjustments', allowRoles('ADMIN', 'MANAGER'), createAdjustment)
// v3: wastage & damage write-offs (loss valued at current unit cost).
router.post('/wastage', allowRoles('ADMIN', 'MANAGER'), createWastage)
router.get('/wastage', allowRoles('ADMIN', 'MANAGER'), listWastage)
export default router
