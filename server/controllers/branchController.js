/**
 * Branches, stock transfers, per-branch stock and branch financials (v3).
 */
import mongoose from 'mongoose'
import { ActivityLog, InventoryItem } from '../models/BusinessModels.js'
import { Branch, BranchStock, StockTransfer } from '../models/PlatformModels.js'
import { branchFinancials, ensureMainBranch, transferStock } from '../services/branchService.js'

const validId = (v) => mongoose.isValidObjectId(v)
const fail = (res, message) => res.status(400).json({ message })

export async function listBranches(req, res, next) {
  try {
    await ensureMainBranch() // the main branch always exists for selection lists
    const branches = await Branch.find({ isActive: true }).sort({ isMain: -1, name: 1 }).lean()
    res.json({ branches })
  } catch (error) { next(error) }
}

export async function createBranch(req, res, next) {
  try {
    const { code, name, type = 'BRANCH', address, phone } = req.body
    if (!code?.trim() || !name?.trim() || !['BRANCH', 'WAREHOUSE'].includes(type)) {
      return fail(res, 'Branch Code, Name, and a valid Type (BRANCH/WAREHOUSE) are required.')
    }
    const existing = await Branch.findOne({ code: code.trim().toUpperCase() })
    if (existing) return fail(res, `Branch code ${code.toUpperCase()} is already in use.`)
    const branch = await Branch.create({ code: code.trim().toUpperCase(), name: name.trim(), type, address: address?.trim(), phone: phone?.trim() })
    await ActivityLog.create({ module: 'System', action: 'Branch created', description: `${branch.code} · ${branch.name} (${branch.type}) was added.`, actor: req.auth.sub }).catch(() => {})
    res.status(201).json({ branch })
  } catch (error) { next(error) }
}

export async function updateBranch(req, res, next) {
  try {
    if (!validId(req.params.id)) return fail(res, 'Invalid branch.')
    const { name, type, address, phone, isActive } = req.body
    const branch = await Branch.findById(req.params.id)
    if (!branch) return res.status(404).json({ message: 'Branch not found.' })
    if (branch.isMain && isActive === false) return fail(res, 'The main branch cannot be deactivated.')
    if (name?.trim()) branch.name = name.trim()
    if (['BRANCH', 'WAREHOUSE'].includes(type)) branch.type = type
    if (address !== undefined) branch.address = address?.trim()
    if (phone !== undefined) branch.phone = phone?.trim()
    if (typeof isActive === 'boolean') branch.isActive = isActive
    await branch.save()
    res.json({ branch })
  } catch (error) { next(error) }
}

/** Stock position: every active item with its quantity at the given branch. */
export async function branchStock(req, res, next) {
  try {
    const main = await ensureMainBranch()
    const branch = validId(req.query.branch) ? await Branch.findById(req.query.branch) : main
    if (!branch) return res.status(404).json({ message: 'Branch not found.' })
    const items = await InventoryItem.find({ isActive: true }).select('itemId itemName category unit quantity').sort({ itemName: 1 }).lean()
    let rows = items
    if (String(branch._id) !== String(main._id)) {
      const stock = await BranchStock.find({ branch: branch._id }).lean()
      const byItem = new Map(stock.map((s) => [String(s.item), s.quantity]))
      rows = items.map((item) => ({ ...item, quantity: byItem.get(String(item._id)) || 0 }))
    }
    res.json({ branch: { id: branch._id, code: branch.code, name: branch.name, isMain: branch.isMain }, items: rows })
  } catch (error) { next(error) }
}

export async function createTransfer(req, res, next) {
  try {
    const { fromBranch, toBranch, item, quantity, note } = req.body
    if (!validId(fromBranch) || !validId(toBranch) || !validId(item)) return fail(res, 'From branch, To branch, and Item are required.')
    const transfer = await transferStock({ fromBranchId: fromBranch, toBranchId: toBranch, itemId: item, quantity, note, actor: req.auth.sub })
    res.status(201).json({ transfer })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message })
    next(error)
  }
}

export async function listTransfers(req, res, next) {
  try {
    const { page = 1, limit = 25 } = req.query
    const [transfers, total] = await Promise.all([
      StockTransfer.find({})
        .populate('fromBranch', 'code name').populate('toBranch', 'code name')
        .populate('item', 'itemId itemName unit').populate('createdBy', 'name')
        .sort({ createdAt: -1 }).skip((Number(page) - 1) * Number(limit)).limit(Number(limit)).lean(),
      StockTransfer.countDocuments({}),
    ])
    res.json({ transfers, total })
  } catch (error) { next(error) }
}

export async function financials(req, res, next) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : today.slice(0, 8) + '01'
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today
    res.json(await branchFinancials(from, to))
  } catch (error) { next(error) }
}

export default { listBranches, createBranch, updateBranch, branchStock, createTransfer, listTransfers, financials }
