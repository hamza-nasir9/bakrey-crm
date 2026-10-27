import { Router } from 'express'
import { authenticate, allowRoles } from '../middleware/auth.js'
import { createRecipe, deleteRecipe, listRecipes, updateRecipe } from '../controllers/recipeController.js'

const router = Router()
router.use(authenticate, allowRoles('ADMIN', 'MANAGER')) // recipes & food cost are management data
router.get('/', listRecipes)
router.post('/', createRecipe)
router.patch('/:id', updateRecipe)
router.delete('/:id', deleteRecipe)
export default router
