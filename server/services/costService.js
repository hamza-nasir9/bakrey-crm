/**
 * Unit-cost resolution for inventory items.
 * Source of truth, in order:
 *  1. The most recent Purchase of the item: totalPrice / purchased quantity
 *     (using whichever unit the purchase recorded — kg, pieces, or legacy qty).
 *  2. The item's own goatDetails.purchasePrice (livestock bought per head).
 *  3. 0 (unknown — cost-based figures then read as 0 rather than inventing data).
 * Used by recipe costing and wastage loss valuation so both agree.
 */
import { Purchase } from '../models/BusinessModels.js'

export async function unitCostOf(item) {
  if (!item) return 0
  const itemId = item._id || item
  const last = await Purchase.findOne({ item: itemId }).sort({ date: -1, createdAt: -1 }).lean()
  if (last && last.totalPrice > 0) {
    const qty = last.quantityKg || last.quantityPieces || last.quantity || 0
    if (qty > 0) return Math.round((last.totalPrice / qty + Number.EPSILON) * 100) / 100
  }
  const doc = item.goatDetails ? item : null
  if (doc?.goatDetails?.purchasePrice) return doc.goatDetails.purchasePrice
  return 0
}

export default unitCostOf
