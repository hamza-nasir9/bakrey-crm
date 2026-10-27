/**
 * Recipes / Bill of Materials (v3).
 * One active recipe per output item. Costing uses each ingredient's current
 * unit cost (services/costService) so a recipe's food-cost updates as
 * purchase prices move; the per-unit cost is returned with every recipe.
 */
import mongoose from 'mongoose'
import { ActivityLog, InventoryItem } from '../models/BusinessModels.js'
import { Recipe } from '../models/PlatformModels.js'
import { unitCostOf } from '../services/costService.js'

const validId = (v) => mongoose.isValidObjectId(v)
const fail = (res, message) => res.status(400).json({ message })
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

async function withCost(recipe) {
  const obj = recipe.toObject ? recipe.toObject() : recipe
  let total = 0
  const ingredients = []
  for (const ing of obj.ingredients || []) {
    const itemDoc = ing.item && typeof ing.item === 'object' ? ing.item : await InventoryItem.findById(ing.item).lean()
    const unitCost = itemDoc ? await unitCostOf(itemDoc) : 0
    const lineCost = round2(unitCost * ing.quantity)
    total += lineCost
    ingredients.push({ ...ing, item: itemDoc, unitCost, lineCost })
  }
  return { ...obj, ingredients, costPerUnit: round2(total) }
}

function validateInput(body) {
  const { name, outputItem, deductMode = 'INGREDIENTS', ingredients } = body
  if (!name?.trim()) return 'Recipe Name is required.'
  if (!validId(outputItem)) return 'A valid Output Item (the finished product) is required.'
  if (!['INGREDIENTS', 'BOTH', 'FINISHED'].includes(deductMode)) return 'Invalid deduct mode.'
  if (!Array.isArray(ingredients) || !ingredients.length) return 'At least one ingredient is required.'
  if (ingredients.some((i) => !validId(i.item) || !(Number(i.quantity) > 0))) return 'Every ingredient needs a valid item and a positive quantity per unit.'
  if (ingredients.some((i) => String(i.item) === String(outputItem))) return 'An item cannot be its own ingredient.'
  return null
}

export async function listRecipes(req, res, next) {
  try {
    const recipes = await Recipe.find({}).populate('outputItem', 'itemId itemName unit').populate('ingredients.item', 'itemId itemName unit').sort({ name: 1 })
    res.json({ recipes: await Promise.all(recipes.map(withCost)) })
  } catch (error) { next(error) }
}

export async function createRecipe(req, res, next) {
  try {
    const error = validateInput(req.body)
    if (error) return fail(res, error)
    const { name, outputItem, deductMode = 'INGREDIENTS', ingredients, notes } = req.body
    const output = await InventoryItem.findOne({ _id: outputItem, isActive: true })
    if (!output) return res.status(404).json({ message: 'Output item not found.' })
    if (await Recipe.findOne({ outputItem })) return fail(res, `${output.itemName} already has a recipe. Edit that recipe instead.`)
    const recipe = await Recipe.create({
      name: name.trim(), outputItem, deductMode, notes: notes?.trim(), createdBy: req.auth.sub,
      ingredients: ingredients.map((i) => ({ item: i.item, quantity: Number(i.quantity) })),
    })
    await ActivityLog.create({ module: 'Inventory', action: 'Recipe created', description: `Recipe "${recipe.name}" for ${output.itemName} (${deductMode}) with ${ingredients.length} ingredients.`, actor: req.auth.sub }).catch(() => {})
    res.status(201).json({ recipe: await withCost(await recipe.populate('outputItem', 'itemId itemName unit')) })
  } catch (error) { next(error) }
}

export async function updateRecipe(req, res, next) {
  try {
    if (!validId(req.params.id)) return fail(res, 'Invalid recipe.')
    const error = validateInput(req.body)
    if (error) return fail(res, error)
    const { name, outputItem, deductMode = 'INGREDIENTS', ingredients, notes, isActive } = req.body
    const clash = await Recipe.findOne({ outputItem, _id: { $ne: req.params.id } })
    if (clash) return fail(res, 'Another recipe already exists for that output item.')
    const recipe = await Recipe.findByIdAndUpdate(req.params.id, {
      name: name.trim(), outputItem, deductMode, notes: notes?.trim(),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
      ingredients: ingredients.map((i) => ({ item: i.item, quantity: Number(i.quantity) })),
    }, { new: true, runValidators: true })
    if (!recipe) return res.status(404).json({ message: 'Recipe not found.' })
    res.json({ recipe: await withCost(recipe) })
  } catch (error) { next(error) }
}

export async function deleteRecipe(req, res, next) {
  try {
    if (!validId(req.params.id)) return fail(res, 'Invalid recipe.')
    const recipe = await Recipe.findByIdAndDelete(req.params.id)
    if (!recipe) return res.status(404).json({ message: 'Recipe not found.' })
    await ActivityLog.create({ module: 'Inventory', action: 'Recipe deleted', description: `Recipe "${recipe.name}" was deleted.`, actor: req.auth.sub }).catch(() => {})
    res.status(204).end()
  } catch (error) { next(error) }
}

export default { listRecipes, createRecipe, updateRecipe, deleteRecipe }
