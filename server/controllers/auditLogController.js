/**
 * Audit log API — staff activity tracking.
 *
 * ActivityLog rows are written by the business controllers (orders,
 * inventory, payments, salaries, users, auth, reports…). Until now they
 * were only visible as "8 recent activities" on the dashboard; this API
 * makes the full, filterable trail available to Admin/Manager so questions
 * like "who changed this stock / price, who cancelled this bill, and when"
 * always have an answer.
 *
 * Access: ADMIN and MANAGER (route-enforced). Cashiers never see the trail.
 */
import { ActivityLog } from '../models/BusinessModels.js'
import User from '../models/User.js'
import { searchRegex } from '../middleware/validate.js'

const csvCell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`

function buildFilter({ module, actor, search, from, to }) {
  const filter = {}
  if (module) filter.module = module
  if (actor) filter.actor = actor
  if (search) filter.$or = [{ action: searchRegex(search) }, { description: searchRegex(search) }]
  if (from || to) {
    filter.occurredAt = {
      ...(from && { $gte: new Date(`${from}T00:00:00`) }),
      ...(to && { $lte: new Date(`${to}T23:59:59.999Z`) }),
    }
  }
  return filter
}

/** GET /api/audit-logs?module&actor&search&from&to&page&limit&format=json|csv */
export async function listAuditLogs(req, res, next) {
  try {
    const filter = buildFilter(req.query)
    const format = req.query.format === 'csv' ? 'csv' : 'json'

    if (format === 'csv') {
      const rows = await ActivityLog.find(filter).sort({ occurredAt: -1 }).limit(5000)
        .populate('actor', 'name username role').lean()
      const header = ['When', 'Staff', 'Username', 'Role', 'Module', 'Action', 'Description', 'Amount']
      const csv = [header.join(','), ...rows.map((r) => [
        new Date(r.occurredAt).toISOString(),
        r.actor?.name || 'System', r.actor?.username || '', r.actor?.role || '',
        r.module, r.action, r.description, r.amount ?? '',
      ].map(csvCell).join(','))].join('\n')
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"')
      return res.send(csv)
    }

    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25))
    const [logs, total] = await Promise.all([
      ActivityLog.find(filter).sort({ occurredAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('actor', 'name username role').lean(),
      ActivityLog.countDocuments(filter),
    ])
    return res.json({
      logs: logs.map((r) => ({
        id: r._id,
        module: r.module,
        action: r.action,
        description: r.description,
        amount: r.amount ?? null,
        occurredAt: r.occurredAt,
        actor: r.actor ? { id: r.actor._id, name: r.actor.name, username: r.actor.username, role: r.actor.role } : null,
      })),
      total, page, limit,
    })
  } catch (error) {
    return next(error)
  }
}

/** GET /api/audit-logs/options — filter dropdown data. */
export async function auditLogOptions(_req, res, next) {
  try {
    const [modules, actorIds] = await Promise.all([
      ActivityLog.distinct('module'),
      ActivityLog.distinct('actor'),
    ])
    const actors = await User.find({ _id: { $in: actorIds.filter(Boolean) } })
      .select('name username role').sort({ name: 1 }).lean()
    return res.json({ modules: modules.sort(), actors })
  } catch (error) {
    return next(error)
  }
}
