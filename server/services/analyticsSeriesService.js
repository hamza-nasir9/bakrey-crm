/**
 * Sales & Net-Profit time series for the dashboard charts.
 *
 * Definitions follow the ones already used by the dashboard cards and the
 * Reports "Profit & Loss" analytics, so the graphs agree with the numbers
 * elsewhere in the app:
 *   Sales      = sum of Order.totalAmount (non-cancelled) by booking date
 *   Revenue    = money actually collected: Payments, refunds negative
 *   Costs      = Purchases + Salaries paid + Expenses
 *   Net Profit = Revenue − Purchases − Salaries − Expenses
 *
 * Implementation: each source is aggregated per calendar day in MongoDB,
 * then bucketed in JS (day / ISO week / month). Bucketing in JS keeps one
 * code path for all three ranges and makes the maths unit-testable
 * (see server/tests/analyticsSeries.test.mjs).
 */
import { Expense, Order, Payment, Purchase, Salary } from '../models/BusinessModels.js'

const DAY_MS = 86_400_000
// All bucketing is done on UTC calendar days. That matches MongoDB's
// $dateToString (UTC by default) used for the daily aggregates, so a day in
// the database is the same day in a bucket — mixing local midnights with UTC
// ISO keys would silently shift every bucket by one day in UTC+5 (PKT).
const startOfDay = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x }
const startOfMonth = (d) => { const x = startOfDay(d); x.setUTCDate(1); return x }
/** Monday of the ISO week containing `d` (UTC). */
const startOfWeek = (d) => { const x = startOfDay(d); const dow = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dow); return x }
const keyOf = (d) => startOfDay(d).toISOString().slice(0, 10)
const monthKeyOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
const fmtDay = (d) => new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d)
const fmtMonth = (d) => new Intl.DateTimeFormat('en-PK', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

export const RANGES = {
  daily: { buckets: 30, step: 'day' },
  weekly: { buckets: 12, step: 'week' },
  monthly: { buckets: 12, step: 'month' },
}

/**
 * Pure bucketing — exported for tests.
 * @param {{sales:Map<string,number>, revenue:Map<string,number>, purchases:Map<string,number>,
 *          salaries:Map<string,number>, expenses:Map<string,number>}} dailyMaps  keyed by YYYY-MM-DD
 * @param {'daily'|'weekly'|'monthly'} range
 * @param {Date} now
 */
export function bucketize(dailyMaps, range, now = new Date()) {
  const { buckets: count, step } = RANGES[range] || RANGES.daily
  const buckets = []

  // Build the bucket skeletons (oldest → newest), each knowing its day keys range.
  for (let i = count - 1; i >= 0; i--) {
    let start
    if (step === 'day') start = startOfDay(new Date(now.getTime() - i * DAY_MS))
    else if (step === 'week') start = startOfWeek(new Date(now.getTime() - i * 7 * DAY_MS))
    else { start = startOfMonth(now); start.setUTCMonth(start.getUTCMonth() - i) }

    let end
    if (step === 'day') end = start
    else if (step === 'week') end = new Date(start.getTime() + 6 * DAY_MS)
    else { end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)) }

    buckets.push({
      key: step === 'month' ? monthKeyOf(start) : keyOf(start),
      label: step === 'month' ? fmtMonth(start) : fmtDay(start),
      from: keyOf(start),
      to: keyOf(end),
      sales: 0, revenue: 0, purchases: 0, salaries: 0, expenses: 0, netProfit: 0,
    })
  }

  const bucketFor = (dateKey) => buckets.find((b) => dateKey >= b.from && dateKey <= b.to)
  for (const field of ['sales', 'revenue', 'purchases', 'salaries', 'expenses']) {
    for (const [dateKey, total] of dailyMaps[field] || []) {
      const bucket = bucketFor(dateKey)
      if (bucket) bucket[field] += total
    }
  }

  const totals = { sales: 0, revenue: 0, purchases: 0, salaries: 0, expenses: 0, netProfit: 0 }
  for (const b of buckets) {
    b.netProfit = round2(b.revenue - b.purchases - b.salaries - b.expenses)
    for (const f of ['sales', 'revenue', 'purchases', 'salaries', 'expenses']) {
      b[f] = round2(b[f])
      totals[f] += b[f]
    }
  }
  totals.netProfit = round2(totals.revenue - totals.purchases - totals.salaries - totals.expenses)
  for (const f of ['sales', 'revenue', 'purchases', 'salaries', 'expenses']) totals[f] = round2(totals[f])

  return { range, buckets, totals }
}

async function dailyTotals(model, dateField, match, value) {
  const rows = await model.aggregate([
    { $match: match },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` } }, total: { $sum: value } } },
  ])
  return new Map(rows.map((r) => [r._id, r.total]))
}

/** Full series for GET /api/dashboard/analytics?range=daily|weekly|monthly */
export async function getAnalyticsSeries(range = 'daily', now = new Date()) {
  const safeRange = RANGES[range] ? range : 'daily'
  const { step } = RANGES[safeRange]
  const windowStart =
    step === 'day' ? startOfDay(new Date(now.getTime() - 29 * DAY_MS))
    : step === 'week' ? startOfWeek(new Date(now.getTime() - 11 * 7 * DAY_MS))
    : (() => { const s = startOfMonth(now); s.setUTCMonth(s.getUTCMonth() - 11); return s })()
  const inWindow = (field) => ({ [field]: { $gte: windowStart, $lte: now } })

  const [sales, revenue, purchases, salaries, expenses] = await Promise.all([
    dailyTotals(Order, 'bookingDate', { status: { $ne: 'Cancelled' }, ...inWindow('bookingDate') }, '$totalAmount'),
    dailyTotals(Payment, 'date', { isVoided: false, ...inWindow('date') },
      { $cond: [{ $eq: ['$paymentType', 'Refund'] }, { $multiply: ['$amount', -1] }, '$amount'] }),
    dailyTotals(Purchase, 'date', inWindow('date'), { $ifNull: ['$totalPrice', 0] }),
    dailyTotals(Salary, 'salaryDate', { isVoided: false, ...inWindow('salaryDate') }, '$paidAmount'),
    dailyTotals(Expense, 'expenseDate', { status: 'Active', ...inWindow('expenseDate') }, '$amount'),
  ])

  return { ...bucketize({ sales, revenue, purchases, salaries, expenses }, safeRange, now), generatedAt: now.toISOString() }
}

export default getAnalyticsSeries
