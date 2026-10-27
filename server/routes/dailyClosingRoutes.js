import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { closingDetails, createClosing, listClosings, lockClosing, previewClosing, unlockClosing } from '../controllers/dailyClosingController.js'
const router=Router();router.use(authenticate,allowRoles('ADMIN'));router.get('/preview',previewClosing);router.get('/',listClosings);router.post('/',createClosing);router.get('/:id',closingDetails);router.post('/:id/lock',lockClosing);router.post('/:id/unlock',unlockClosing);export default router
