/**
 * Multi-branch stock + financials.
 *
 * Stock model (deliberately conservative):
 *  - The MAIN branch's stock is InventoryItem.quantity — the number every
 *    pre-v3 flow already reads and writes — so nothing existing changes.
 *  - Every other branch/warehouse keeps its stock in BranchStock rows.
 *  - `stockOf` / `adjustStock` hide that split from callers.
 * All movements use guarded atomic updates (quantity can never go negative),
 * and transfers compensate if the credit leg fails.
 */
import mongoose from 'mongoose'
import { ActivityLog, Expense, InventoryItem, Order, Payment, Purchase, Salary } from '../models/BusinessModels.js'
import { Branch, BranchStock, StockTransfer } from '../models/PlatformModels.js'

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** Find (or lazily create) the main branch. Existing data belongs to it. */
export async function ensureMainBranch() {
  let main = await Branch.findOne({ isMain: true, isActive: true })
  if (!main) {
    main = await Branch.findOneAndUpdate(
      { code: 'MAIN' },
      { name: 'Main Branch', type: 'BRANCH', isMain: true, isActive: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }
  return main
}

export async function resolveBranch(branchId) {
  if (branchId && mongoose.isValidObjectId(branchId)) {
    const branch = await Branch.findOne({ _id: branchId, isActive: true })
    if (branch) return branch
  }
  return ensureMainBranch()
}

export const isMain = (branch, main) => String(branch?._id || branch) === String(main?._id || main)

/** Current stock of an item at a branch. */
export async function stockOf(itemId, branch, main) {
  if (isMain(branch, main)) {
    const item = await InventoryItem.findById(itemId).select('quantity').lean()
    return item?.quantity || 0
  }
  const row = await BranchStock.findOne({ branch: branch._id || branch, item: itemId }).lean()
  return row?.quantity || 0
}

/**
 * Atomically adjust stock at a branch by `delta` (negative = deduct).
 * Returns the new quantity, or null when a deduction exceeds stock.
 */
export async function adjustStock({ itemId, branch, main, delta }) {
  if (isMain(branch, main)) {
    const query = delta >= 0
      ? { _id: itemId, isActive: true }
      : { _id: itemId, isActive: true, quantity: { $gte: -delta } }
    const updated = await InventoryItem.findOneAndUpdate(query, { $inc: { quantity: delta } }, { new: true }).select('quantity')
    return updated ? updated.quantity : null
  }
  const branchId = branch._id || branch
  if (delta >= 0) {
    const row = await BranchStock.findOneAndUpdate(
      { branch: branchId, item: itemId },
      { $inc: { quantity: delta } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
    return row.quantity
  }
  const row = await BranchStock.findOneAndUpdate(
    { branch: branchId, item: itemId, quantity: { $gte: -delta } },
    { $inc: { quantity: delta } },
    { new: true },
  )
  return row ? row.quantity : null
}

/** Move stock between two branches with a full audit trail. */
export async function transferStock({ fromBranchId, toBranchId, itemId, quantity, note, actor }) {
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty <= 0) throw Object.assign(new Error('Transfer quantity must be positive.'), { status: 400 })
  if (String(fromBranchId) === String(toBranchId)) throw Object.assign(new Error('Source and destination branches must be different.'), { status: 400 })
  const [from, to, item, main] = await Promise.all([
    Branch.findOne({ _id: fromBranchId, isActive: true }),
    Branch.findOne({ _id: toBranchId, isActive: true }),
    InventoryItem.findOne({ _id: itemId, isActive: true }),
    ensureMainBranch(),
  ])
  if (!from || !to) throw Object.assign(new Error('Both branches must exist and be active.'), { status: 400 })
  if (!item) throw Object.assign(new Error('Inventory item not found.'), { status: 404 })

  const afterDebit = await adjustStock({ itemId, branch: from, main, delta: -qty })
  if (afterDebit == null) {
    throw Object.assign(new Error(`Insufficient stock at ${from.name}: ${await stockOf(itemId, from, main)} available.`), { status: 400 })
  }
  try {
    await adjustStock({ itemId, branch: to, main, delta: qty })
  } catch (error) {
    await adjustStock({ itemId, branch: from, main, delta: qty }) // compensate
    throw error
  }

  const transfer = await StockTransfer.create({
    fromBranch: from._id, toBranch: to._id, item: item._id, quantity: qty, note: note?.trim(), createdBy: actor,
  })
  await ActivityLog.create({
    module: 'Inventory', action: 'Stock transfer',
    description: `${transfer.transferId}: ${qty} ${item.unit} of ${item.itemName} moved from ${from.name} to ${to.name}.`,
    actor,
  }).catch(() => {})
  return transfer
}

/**
 * Branch-wise P&L for a date range.
 * Per branch: Sales (orders), Revenue (payments, refunds netted),
 * Purchases and Expenses tagged to that branch. Salaries are a company-wide
 * cost (staff are not branch-assigned), so they appear ONLY in the combined
 * row — shown explicitly so nobody thinks a branch number is hiding them.
 * Records with no branch (pre-v3 data) count towards the main branch.
 */
export async function branchFinancials(from, to) {
  const main = await ensureMainBranch()
  const branches = await Branch.find({ isActive: true }).sort({ isMain: -1, name: 1 }).lean()
  const range = (field) => ({ [field]: { $gte: new Date(`${from}T00:00:00`), $lte: new Date(`${to}T23:59:59.999Z`) } })
  const branchMatch = (branch) =>
    branch.isMain
      ? { $or: [{ branch: branch._id }, { branch: null }, { branch: { $exists: false } }] }
      : { branch: branch._id }

  const sum = async (model, field, match, value) => {
    const rows = await model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: value } } }])
    return rows[0]?.total || 0
  }

  const results = []
  for (const branch of branches) {
    const bm = branchMatch(branch)
    const [sales, revenue, purchases, expenses] = await Promise.all([
      sum(Order, 'totalAmount', { ...bm, ...range('bookingDate'), status: { $ne: 'Cancelled' } }, '$totalAmount'),
      sum(Payment, 'amount', { ...bm, ...range('date'), isVoided: false },
        { $cond: [{ $eq: ['$paymentType', 'Refund'] }, { $multiply: ['$amount', -1] }, '$amount'] }),
      sum(Purchase, 'totalPrice', { ...bm, ...range('date') }, { $ifNull: ['$totalPrice', 0] }),
      sum(Expense, 'amount', { ...bm, ...range('expenseDate'), status: 'Active' }, '$amount'),
    ])
    results.push({
      branch: { id: branch._id, code: branch.code, name: branch.name, type: branch.type, isMain: branch.isMain },
      sales: round2(sales), revenue: round2(revenue), purchases: round2(purchases), expenses: round2(expenses),
      netProfit: round2(revenue - purchases - expenses), // salaries excluded — see note above
    })
  }

  const salaries = await sum(Salary, 'paidAmount', { ...range('salaryDate'), isVoided: false }, '$paidAmount')
  const combined = results.reduce(
    (acc, r) => ({
      sales: round2(acc.sales + r.sales), revenue: round2(acc.revenue + r.revenue),
      purchases: round2(acc.purchases + r.purchases), expenses: round2(acc.expenses + r.expenses),
    }),
    { sales: 0, revenue: 0, purchases: 0, expenses: 0 },
  )
  combined.salaries = round2(salaries)
  combined.netProfit = round2(combined.revenue - combined.purchases - combined.expenses - combined.salaries)

  return { from, to, branches: results, combined }
}

export default { ensureMainBranch, resolveBranch, stockOf, adjustStock, transferStock, branchFinancials }
