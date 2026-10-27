/**
 * Unit tests for the dashboard chart bucketing maths (pure — no DB).
 * Run: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/bakrey_test'
process.env.JWT_SECRET ||= 'test-secret-at-least-sixteen-chars'

const { bucketize } = await import('../services/analyticsSeriesService.js')

const maps = (obj) => ({
  sales: new Map(Object.entries(obj.sales || {})),
  revenue: new Map(Object.entries(obj.revenue || {})),
  purchases: new Map(Object.entries(obj.purchases || {})),
  salaries: new Map(Object.entries(obj.salaries || {})),
  expenses: new Map(Object.entries(obj.expenses || {})),
})
const NOW = new Date('2026-10-23T12:00:00') // a Friday

test('daily: 30 buckets, values land on the right day, profit = revenue - all costs', () => {
  const r = bucketize(maps({
    sales: { '2026-10-23': 5000 }, revenue: { '2026-10-23': 4000 },
    purchases: { '2026-10-23': 1500 }, salaries: { '2026-10-23': 500 }, expenses: { '2026-10-23': 200 },
  }), 'daily', NOW)
  assert.equal(r.buckets.length, 30)
  const today = r.buckets.at(-1)
  assert.equal(today.sales, 5000)
  assert.equal(today.netProfit, 4000 - 1500 - 500 - 200)
  assert.equal(r.totals.netProfit, 1800)
})

test('weekly: days group into ISO weeks (Mon-Sun)', () => {
  // Fri 2026-10-23 and Mon 2026-10-19 are the same ISO week; Sun 2026-10-18 is the previous week.
  const r = bucketize(maps({ sales: { '2026-10-23': 100, '2026-10-19': 50, '2026-10-18': 7 } }), 'weekly', NOW)
  assert.equal(r.buckets.length, 12)
  assert.equal(r.buckets.at(-1).sales, 150)
  assert.equal(r.buckets.at(-2).sales, 7)
})

test('monthly: 12 buckets with month labels, negative profit preserved', () => {
  const r = bucketize(maps({
    revenue: { '2026-10-05': 1000, '2026-09-15': 3000 },
    purchases: { '2026-10-20': 4000 },
  }), 'monthly', NOW)
  assert.equal(r.buckets.length, 12)
  assert.equal(r.buckets.at(-1).label, 'Oct 2026')
  assert.equal(r.buckets.at(-1).netProfit, -3000)
  assert.equal(r.buckets.at(-2).netProfit, 3000)
})

test('data outside the window is ignored, not misfiled', () => {
  const r = bucketize(maps({ sales: { '2020-01-01': 9999 } }), 'daily', NOW)
  assert.equal(r.totals.sales, 0)
})
