import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { createUser, listUsers, resetCredentials, updateUser, userOptions } from '../controllers/userController.js'
const router=Router();router.use(authenticate,allowRoles('ADMIN'));router.get('/',listUsers);router.get('/options',userOptions);router.post('/',createUser);router.patch('/:id',updateUser);router.post('/:id/reset-credentials',resetCredentials);export default router