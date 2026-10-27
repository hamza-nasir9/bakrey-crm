/**
 * Low-stock & expiry alerts.
 *
 * The original code had a `lowStockThreshold` field and (in the dashboard
 * snapshot) a low-stock *count*, but no alert list anywhere, and inventory
 * items had no expiry date at all — so nothing could warn before stock ran
 * out or expired. This service computes all three alert classes in one
 * query and backs `GET /api/inventory/alerts`; the dashboard panel and the
 * notification job can both consume it.
 */
import env from '../config/env.js'
import { InventoryItem } from '../models/BusinessModels.js'

/**
 * @param {{ expiryDays?: number }} opts days-ahead window for "expiring soon"
 * @returns {{ generatedAt:string, summary:object, lowStock:Array, expiringSoon:Array, expired:Array }}
 */
export async function getInventoryAlerts({ expiryDays = env.EXPIRY_WARNING_DAYS } = {}) {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + expiryDays * 86_400_000)

  const items = await InventoryItem.find({ isActive: true })
    .select('itemId itemName category quantity unit lowStockThreshold expiryDate batchNo')
    .sort({ itemName: 1 })
    .lean()

  const lowStock = []
  const expiringSoon = []
  const expired = []

  for (const item of items) {
    // Low stock: at/below the item's own threshold. Items with no threshold
    // set (0) only alert when completely out of stock.
    const threshold = item.lowStockThreshold || 0
    if (item.quantity <= threshold) {
      lowStock.push({ ...item, severity: item.quantity === 0 ? 'critical' : 'warning', unitsRemaining: item.quantity })
    }
    if (item.expiryDate) {
      const expiry = new Date(item.expiryDate)
      const daysToExpiry = Math.ceil((expiry - now) / 86_400_000)
      if (expiry < now) expired.push({ ...item, daysToExpiry, severity: 'critical' })
      else if (expiry <= windowEnd) expiringSoon.push({ ...item, daysToExpiry, severity: daysToExpiry <= 7 ? 'critical' : 'warning' })
    }
  }

  expiringSoon.sort((a, b) => a.daysToExpiry - b.daysToExpiry)
  expired.sort((a, b) => a.daysToExpiry - b.daysToExpiry)

  return {
    generatedAt: now.toISOString(),
    expiryWarningDays: expiryDays,
    summary: { lowStock: lowStock.length, expiringSoon: expiringSoon.length, expired: expired.length, total: lowStock.length + expiringSoon.length + expired.length },
    lowStock,
    expiringSoon,
    expired,
  }
}

export default getInventoryAlerts
