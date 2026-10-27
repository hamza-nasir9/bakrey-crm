/**
 * Atomic stock deduction for order delivery.
 *
 * THE BUG THIS FIXES
 * ------------------
 * The original `updateOrder` deducted stock item-by-item in a plain loop:
 *
 *   for (const row of order.items) {
 *     const item = await InventoryItem.findOneAndUpdate({ quantity: { $gte: row.quantity } },
 *                                                        { $inc: { quantity: -row.quantity } })
 *     if (!item) return fail(res, 'Insufficient stock…')   // <-- earlier rows ALREADY deducted
 *   }
 *
 * If item 3 of 5 was short, items 1–2 stayed deducted, the order was never
 * marked delivered, and inventory silently leaked on every retry.
 *
 * THE FIX
 * -------
 * 1. On replica sets / Atlas (production) the whole deduction + order save
 *    runs inside a MongoDB transaction — all or nothing.
 * 2. On a standalone local mongod (no transactions) we keep the same
 *    guarded atomic update per item (`quantity: { $gte }` prevents the
 *    race/oversell) and *compensate*: any item already deducted is
 *    re-credited if a later item fails.
 * Either way the invariant holds: an order is marked delivered if and only
 * if every line was deducted exactly once.
 *
 * v3 EXTENSIONS
 * -------------
 * - Branch-aware: an order sold from a non-main branch deducts that
 *   branch's BranchStock; the main branch keeps using InventoryItem.quantity.
 * - Recipe (BOM) aware: when a sold item has an active Recipe, delivery
 *   expands the line into its raw-material ingredients (mode INGREDIENTS),
 *   or deducts both the finished item and its ingredients (mode BOTH).
 *   Expansion happens BEFORE the atomic deduction, and duplicate targets
 *   are merged, so the all-or-nothing guarantee covers ingredients too.
 */
import mongoose from 'mongoose'
import { InventoryItem } from '../models/BusinessModels.js'
import { BranchStock, Recipe } from '../models/PlatformModels.js'
import { ensureMainBranch } from './branchService.js'

export class InsufficientStockError extends Error {
  constructor(itemName) {
    super(`Insufficient stock to deliver ${itemName}.`)
    this.name = 'InsufficientStockError'
    this.status = 400
    this.itemName = itemName
  }
}

const isTransactionUnsupported = (error) =>
  /Transaction numbers are only allowed|transactions are not supported|replica set/i.test(error?.message || '') ||
  error?.code === 20 ||
  error?.codeName === 'IllegalOperation'

/**
 * Expand an order's lines into the concrete stock deductions for delivery:
 * finished items and/or recipe ingredients, merged by item.
 */
export async function expandDeliveryLines(order) {
  const lines = []
  for (const row of order.items) {
    const recipe = await Recipe.findOne({ outputItem: row.inventoryItem, isActive: true })
      .populate('ingredients.item', 'itemName')
      .lean()
    if (!recipe || recipe.deductMode === 'FINISHED') {
      lines.push({ inventoryItem: row.inventoryItem, quantity: row.quantity, itemName: row.itemName })
      continue
    }
    if (recipe.deductMode === 'BOTH') {
      lines.push({ inventoryItem: row.inventoryItem, quantity: row.quantity, itemName: row.itemName })
    }
    for (const ing of recipe.ingredients) {
      lines.push({
        inventoryItem: ing.item?._id || ing.item,
        quantity: row.quantity * ing.quantity,
        itemName: `${ing.item?.itemName || 'Ingredient'} (for ${row.itemName})`,
      })
    }
  }
  return mergeOrderLines(lines)
}

/** Deduct one line with an atomic guard, from the branch's stock store. */
async function deductOne(row, session, branchId) {
  let query
  if (!branchId) {
    query = InventoryItem.findOneAndUpdate(
      { _id: row.inventoryItem, isActive: true, quantity: { $gte: row.quantity } },
      { $inc: { quantity: -row.quantity } },
      { new: true },
    )
  } else {
    query = BranchStock.findOneAndUpdate(
      { branch: branchId, item: row.inventoryItem, quantity: { $gte: row.quantity } },
      { $inc: { quantity: -row.quantity } },
      { new: true },
    )
  }
  if (session) query.session(session)
  return query
}

async function creditOne(row, branchId) {
  if (!branchId) {
    await InventoryItem.updateOne({ _id: row.inventoryItem }, { $inc: { quantity: row.quantity } })
  } else {
    await BranchStock.findOneAndUpdate(
      { branch: branchId, item: row.inventoryItem },
      { $inc: { quantity: row.quantity } },
      { upsert: true, setDefaultsOnInsert: true },
    )
  }
}

async function deductAll(lines, session, branchId) {
  const deducted = []
  try {
    for (const row of lines) {
      const item = await deductOne(row, session, branchId)
      if (!item) throw new InsufficientStockError(row.itemName)
      deducted.push(row)
    }
    return deducted
  } catch (error) {
    // Compensating rollback for the non-transactional path. Inside a real
    // transaction MongoDB discards these writes on abort anyway; the extra
    // re-credit must NOT run there, hence the session check.
    if (!session) {
      for (const row of deducted) await creditOne(row, branchId)
    }
    throw error
  }
}

/**
 * Mark `order` delivered and deduct its (expanded) stock atomically.
 * Mutates and returns the saved order. Throws InsufficientStockError (400).
 */
export async function deliverOrderAtomically(order) {
  if (order.inventoryDeducted) {
    throw Object.assign(new Error('Stock has already been issued for this order.'), { status: 400 })
  }

  const main = await ensureMainBranch()
  const branchId = order.branch && String(order.branch) !== String(main._id) ? order.branch : null
  const lines = await expandDeliveryLines(order)

  const session = await mongoose.startSession()
  try {
    let transactionUsed = true
    try {
      await session.withTransaction(async () => {
        await deductAll(lines, session, branchId)
        order.inventoryDeducted = true
        order.status = 'Delivered'
        await order.save({ session })
      })
    } catch (error) {
      if (!isTransactionUnsupported(error)) throw error
      transactionUsed = false
    }

    if (!transactionUsed) {
      // Fallback: guarded deductions + compensation, then save the order.
      // If the save itself fails, re-credit everything so stock and order
      // can never disagree.
      const deducted = await deductAll(lines, null, branchId)
      order.inventoryDeducted = true
      order.status = 'Delivered'
      try {
        await order.save()
      } catch (error) {
        for (const row of deducted) await creditOne(row, branchId)
        order.inventoryDeducted = false
        throw error
      }
    }
    return order
  } finally {
    await session.endSession()
  }
}

/**
 * Merge duplicate inventory lines in a create-order request.
 * The original code rejected (or mis-counted) an order that listed the
 * same item twice; merging also keeps the stock guard correct.
 */
export function mergeOrderLines(requested) {
  const byItem = new Map()
  for (const row of requested) {
    const key = String(row.inventoryItem)
    const existing = byItem.get(key)
    if (existing) existing.quantity += row.quantity
    else byItem.set(key, { ...row })
  }
  return [...byItem.values()]
}

export default deliverOrderAtomically
