import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { branchStock, createBranch, createTransfer, financials, listBranches, listTransfers, updateBranch } from '../controllers/branchController.js'

const router = Router()
router.use(authenticate)
// Branch list is needed by order/purchase forms at every level.
router.get('/', allowRoles('ADMIN', 'MANAGER', 'CASHIER'), listBranches)
router.post('/', allowRoles('ADMIN'), createBranch)
router.get('/stock', allowRoles('ADMIN', 'MANAGER'), branchStock)
router.get('/financials', allowRoles('ADMIN', 'MANAGER'), financials)
router.post('/transfers', allowRoles('ADMIN', 'MANAGER'), createTransfer)
router.get('/transfers', allowRoles('ADMIN', 'MANAGER'), listTransfers)
router.patch('/:id', allowRoles('ADMIN'), updateBranch)
export default router
