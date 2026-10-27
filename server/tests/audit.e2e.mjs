/**
 * OPTIONAL full-audit integration test (not part of `npm test`):
 *   npm i -D mongodb-memory-server
 *   node server/tests/audit.e2e.mjs
 * 88 assertions: order flow + atomic stock, cross-screen financial
 * consistency, inventory alerts, payroll maths, the full RBAC matrix,
 * and PIN lockout — against the real API on an in-memory replica set.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
process.env.MONGODB_URI = mongo.getUri('bakrey_audit')
process.env.JWT_SECRET = 'audit-test-secret-at-least-thirty-two-chars!'
process.env.NODE_ENV = 'production'
process.env.PORT = '4603'
process.env.CLIENT_URL = 'http://localhost:5173'

let passed = 0
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1) } passed++; console.log('PASS:', m) }
const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
await import(`${root}/server/index.js`)
const mongoose = (await import('mongoose')).default
for (let i = 0; i < 40 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 250))
assert(mongoose.connection.readyState === 1, 'API connected')

const bcrypt = (await import('bcryptjs')).default
const User = (await import(`${root}/server/models/User.js`)).default
const M = await import(`${root}/server/models/BusinessModels.js`)
const [adminUser] = await User.create([
  { username: 'admin', name: 'Audit Admin', role: 'ADMIN', passwordHash: await bcrypt.hash('StrongPass#1', 12) },
  { username: 'manager', name: 'Audit Manager', role: 'MANAGER', passwordHash: await bcrypt.hash('StrongPass#2', 12) },
  { username: 'cashier1', name: 'Audit Cashier', role: 'CASHIER', pinHash: await bcrypt.hash('4321', 12) },
])
const base = 'http://127.0.0.1:4603/api'
const login = async (body) => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify(body) })
  assert(r.status === 200, `login ${body.username} -> 200`)
  return (r.headers.get('set-cookie') || '').split(';')[0]
}
const ADMIN = await login({ username: 'admin', password: 'StrongPass#1', role: 'ADMIN' })
const MANAGER = await login({ username: 'manager', password: 'StrongPass#2', role: 'MANAGER' })
const CASHIER = await login({ username: 'cashier1', pin: '4321', role: 'CASHIER' })
const call = async (method, path, cookie, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let json = null; try { json = JSON.parse(text) } catch { /* csv/file */ }
  return { status: r.status, json, text }
}
const today = new Date(); const ymd = (d) => d.toISOString().slice(0, 10)
const todayStr = ymd(today)

/* ================= INVENTORY FIXTURES (via API) ================= */
const itemA = (await call('POST', '/inventory/items', ADMIN, { itemName: 'Audit Chicken', category: 'Poultry', unit: 'Kg', lowStockThreshold: 5, expiryDate: ymd(new Date(Date.now() + 10 * 864e5)), batchNo: 'B-10' })).json.item
assert(itemA?.itemId, 'item A created via API')
await M.InventoryItem.updateOne({ _id: itemA._id }, { $set: { quantity: 20 } })
const itemB = (await call('POST', '/inventory/items', ADMIN, { itemName: 'Audit Feed', category: 'Feed', unit: 'Bag', lowStockThreshold: 2, expiryDate: ymd(new Date(Date.now() - 864e5)) })).json.item
await M.InventoryItem.updateOne({ _id: itemB._id }, { $set: { quantity: 2 } })
const supplier = (await call('POST', '/suppliers', ADMIN, { name: 'Audit Supplier' })).json.supplier

/* ================= ORDERS FLOW ================= */
// duplicate lines for item A (2 + 3) must merge to 5; new customer created inline
const orderRes = await call('POST', '/orders', ADMIN, {
  bookingDate: todayStr, newCustomer: { name: 'Walk-in Ahmed', phone: '03009998887' },
  items: [
    { inventoryItem: itemA._id, quantity: 2, unitPrice: 1000 },
    { inventoryItem: itemA._id, quantity: 3, unitPrice: 1000 },
  ],
  advancePaid: 2000, paymentMethod: 'Cash', status: 'Pending',
})
assert(orderRes.status === 201, `order created (got ${orderRes.status}: ${orderRes.text.slice(0, 120)})`)
const order = orderRes.json.order
assert(order.items.length === 1 && order.items[0].quantity === 5, 'duplicate order lines merged (2+3 = 5)')
assert(order.totalAmount === 5000 && order.remainingAmount === 3000, 'order totals correct (5000 total, 3000 remaining)')
assert(orderRes.json.customer?.name === 'Walk-in Ahmed', 'inline customer created with correct name')
let stockNow = (await M.InventoryItem.findById(itemA._id)).quantity
assert(stockNow === 20, 'booking alone does NOT deduct stock')

const detail = await call('GET', `/orders/${order._id}`, ADMIN)
assert(detail.json.order.customer?.name === 'Walk-in Ahmed' && detail.json.order.items[0].itemName === 'Audit Chicken', 'invoice data: customer + item names present')
assert(detail.json.paymentHistory?.length === 1 && detail.json.paymentHistory[0].amount === 2000, 'invoice data: advance payment in history')

const deliver = await call('PATCH', `/orders/${order._id}`, ADMIN, { status: 'Delivered' })
assert(deliver.status === 200 && deliver.json.order.inventoryDeducted === true, 'order delivered')
stockNow = (await M.InventoryItem.findById(itemA._id)).quantity
assert(stockNow === 15, `stock deducted exactly once: 20 -> 15 (got ${stockNow})`)
const redeliver = await call('PATCH', `/orders/${order._id}`, ADMIN, { status: 'Delivered' })
assert(redeliver.status === 400, 're-delivering a delivered order is rejected')
stockNow = (await M.InventoryItem.findById(itemA._id)).quantity
assert(stockNow === 15, 'stock unchanged after rejected re-delivery')

// insufficient stock on ONE line must deduct NOTHING (atomicity)
const order2 = (await call('POST', '/orders', ADMIN, {
  bookingDate: todayStr, customer: order.customer,
  items: [
    { inventoryItem: itemA._id, quantity: 4, unitPrice: 1000 },
    { inventoryItem: itemB._id, quantity: 99, unitPrice: 500 },
  ],
  advancePaid: 0, paymentMethod: 'Cash', status: 'Pending',
})).json.order
const deliver2 = await call('PATCH', `/orders/${order2._id}`, ADMIN, { status: 'Delivered' })
assert(deliver2.status === 400, 'delivery with insufficient stock rejected')
const [sA, sB] = await Promise.all([M.InventoryItem.findById(itemA._id), M.InventoryItem.findById(itemB._id)])
assert(sA.quantity === 15 && sB.quantity === 2, `NO partial deduction (A=${sA.quantity}, B=${sB.quantity})`)

// cancel: no stock effect, customer balance excludes cancelled order
const cancel = await call('POST', `/orders/${order2._id}/cancel`, ADMIN)
assert(cancel.status === 200 && cancel.json.order.status === 'Cancelled', 'order cancelled')
const cust = await M.Customer.findById(order.customer)
assert(cust.pendingBalance === 3000, `customer pendingBalance = 3000 after cancel (got ${cust.pendingBalance})`)

// cannot create an order already 'Delivered' (stock-bypass hole)
const bypass = await call('POST', '/orders', ADMIN, { bookingDate: todayStr, customer: order.customer, items: [{ inventoryItem: itemA._id, quantity: 1, unitPrice: 100 }], advancePaid: 0, paymentMethod: 'Cash', status: 'Delivered' })
assert(bypass.status === 400, 'creating an order as Delivered is rejected (400)')

/* ================= FINANCIAL CONSISTENCY ================= */
// Add: a refund (500), a purchase (2000), a paid salary (3000), an expense (700) — all today.
await call('POST', '/payments', ADMIN, { order: order._id, paymentDate: todayStr, amount: 500, paymentMethod: 'Cash', paymentType: 'Refund' })
await M.Purchase.create({ date: today, item: itemA._id, quantityPieces: 10, totalPrice: 2000, supplier: supplier._id })
await M.Salary.create({ employee: (await M.Employee.create({ name: 'Pay Staff', joiningDate: today, position: 'Helper', dailySalary: 1000 }))._id, salaryDate: today, period: 'Monthly', periodStart: today, periodEnd: today, dailySalaryRate: 1000, grossSalary: 3000, netSalary: 3000, paymentMethod: 'Cash', paymentStatus: 'Paid', paidAmount: 3000 })
await call('POST', '/expenses', ADMIN, { expenseDate: todayStr, category: 'Fuel', title: 'Audit fuel', amount: 700, paymentMethod: 'Cash' })
// Revenue: advance 2000 + (order fully paid? no) — payments on order: advance 2000, refund -500 => revenue 1500
const dash = await call('GET', '/dashboard/summary?period=daily', ADMIN)
const expectedProfit = 1500 - 2000 - 3000 - 700
assert(dash.json.cards.totalRevenue === 1500, `dashboard revenue nets refund: 1500 (got ${dash.json.cards.totalRevenue})`)
assert(dash.json.cards.netProfit === expectedProfit, `dashboard netProfit = ${expectedProfit} (got ${dash.json.cards.netProfit})`)
const rep = await call('GET', `/reports/analytics?from=${todayStr}&to=${todayStr}`, ADMIN)
assert(rep.json.summary.revenue === 1500, `reports revenue matches dashboard: 1500 (got ${rep.json.summary.revenue})`)
assert(rep.json.summary.netProfit === expectedProfit, `reports netProfit matches dashboard: ${expectedProfit} (got ${rep.json.summary.netProfit})`)
const repProfitToday = rep.json.charts.profit.find(x => x.date === todayStr)
assert(repProfitToday?.value === expectedProfit, `reports profit CHART matches summary: ${expectedProfit} (got ${repProfitToday?.value})`)
const series = await call('GET', '/dashboard/analytics?range=daily', ADMIN)
assert(series.json.totals.netProfit === expectedProfit, `chart series netProfit matches: ${expectedProfit} (got ${series.json.totals.netProfit})`)
assert(series.json.totals.sales === 5000, `series sales = 5000 (cancelled order excluded, got ${series.json.totals.sales})`)

/* ================= INVENTORY ALERTS / USAGE / ADJUSTMENT ================= */
const alerts = await call('GET', '/inventory/alerts', ADMIN)
assert(alerts.json.lowStock.some(x => x.itemName === 'Audit Feed'), 'low-stock alert: Feed at threshold (2 <= 2)')
assert(alerts.json.expiringSoon.some(x => x.itemName === 'Audit Chicken'), 'expiry alert: Chicken expires in 10 days')
assert(alerts.json.expired.some(x => x.itemName === 'Audit Feed'), 'expired alert: Feed expired yesterday')

const usageBefore = await M.StockUsage.countDocuments()
const badUsage = await call('POST', '/inventory/usage', ADMIN, { date: todayStr, item: itemB._id, quantityUsed: 50, purpose: 'Audit overuse' })
assert(badUsage.status === 400, 'usage beyond stock rejected')
assert((await M.InventoryItem.findById(itemB._id)).quantity === 2, 'stock unchanged after rejected usage')
assert((await M.StockUsage.countDocuments()) === usageBefore, 'no orphan usage record after rejected usage')
const okUsage = await call('POST', '/inventory/usage', ADMIN, { date: todayStr, item: itemB._id, quantityUsed: 1, purpose: 'Kitchen' })
assert(okUsage.status === 201 && (await M.InventoryItem.findById(itemB._id)).quantity === 1, 'valid usage deducts stock')
const badAdj = await call('POST', '/inventory/adjustments', ADMIN, { date: todayStr, item: itemB._id, adjustmentType: 'Decrease', quantity: 99, reason: 'Audit' })
assert(badAdj.status === 400 && (await M.InventoryItem.findById(itemB._id)).quantity === 1, 'adjustment decrease beyond stock rejected atomically')

/* ================= PAYROLL ================= */
const emp = await M.Employee.create({ name: 'Monthly Staff', joiningDate: new Date('2026-09-01'), position: 'Baker', dailySalary: 1000, monthlySalary: 30000 })
const oct = (d, status, overtimeHours = 0) => M.Attendance.create({ employee: emp._id, attendanceDate: new Date(`2026-10-${String(d).padStart(2, '0')}`), status, overtimeHours })
for (let d = 1; d <= 15; d++) await oct(d, 'Present', d === 1 ? 4 : 0) // 15 present, 4 OT hours on day 1
await oct(16, 'Late'); await oct(17, 'Late'); await oct(18, 'Late')   // 3 lates -> -1 day
await oct(19, 'Half Day'); await oct(20, 'Absent')
// payable = 15 + 3 + 0.5 - 1 = 17.5 ; base = 30000 * 17.5/31 = 16935.48 ; OT = 4 * (1000/8) = 500
const preview = await call('GET', `/salaries/preview?employee=${emp._id}&period=Monthly&periodStart=2026-10-01&periodEnd=2026-10-31`, ADMIN)
assert(preview.status === 200, `salary preview ok (${preview.status})`)
assert(Math.abs(preview.json.grossSalary - (16935.48 + 500)) < 0.02, `payroll maths: gross = pro-rated 16935.48 + auto overtime 500 (got ${preview.json.grossSalary})`)
assert(preview.json.attendanceSummary.payableDays === 17.5, `payable days = 17.5 (got ${preview.json.attendanceSummary.payableDays})`)
const sal = await call('POST', '/salaries', ADMIN, { employee: emp._id, salaryDate: '2026-10-31', period: 'Monthly', periodStart: '2026-10-01', periodEnd: '2026-10-31', paymentMethod: 'Cash', paymentStatus: 'Unpaid', paidAmount: 0 })
assert(sal.status === 201 && sal.json.salary.attendanceSnapshot.lateDeductionDays === 1, `salary created with late-deduction snapshot (${sal.status}: ${sal.text.slice(0,140)})`)
const dup = await call('POST', '/salaries', ADMIN, { employee: emp._id, salaryDate: '2026-10-31', period: 'Monthly', periodStart: '2026-10-01', periodEnd: '2026-10-31', paymentMethod: 'Cash', paymentStatus: 'Unpaid', paidAmount: 0 })
assert(dup.status === 400, `duplicate salary for same period rejected (got ${dup.status}: ${dup.text.slice(0,140)})`)

/* ================= RBAC MATRIX ================= */
const R = { a: ADMIN, m: MANAGER, c: CASHIER }
const matrix = [
  ['GET', '/users', null, { a: 200, m: 403, c: 403 }],
  ['GET', '/salaries', null, { a: 200, m: 200, c: 403 }],
  ['POST', '/salaries', {}, { m: 403, c: 403 }],
  ['GET', `/reports/analytics?from=${todayStr}&to=${todayStr}`, null, { a: 200, m: 200, c: 403 }],
  ['GET', '/audit-logs', null, { a: 200, m: 200, c: 403 }],
  ['GET', '/dashboard/analytics?range=daily', null, { a: 200, m: 200, c: 403 }],
  ['GET', '/system/settings', null, { a: 200, m: 403, c: 403 }],
  ['GET', '/daily-closings', null, { a: 200, m: 403, c: 403 }],
  ['GET', '/employees', null, { a: 200, m: 200, c: 403 }],
  ['GET', '/expenses', null, { a: 200, m: 200, c: 403 }],
  ['GET', '/attendance', null, { a: 200, m: 200, c: 403 }],
  ['GET', '/orders', null, { a: 200, m: 200, c: 200 }],
  ['GET', '/inventory/items', null, { a: 200, m: 200, c: 200 }],
  ['POST', '/inventory/items', { itemName: 'Mgr Item', category: 'Test', unit: 'Piece' }, { m: 201, c: 403 }],
  ['POST', '/orders', { bookingDate: todayStr, items: [{ inventoryItem: itemA._id, quantity: 1, unitPrice: 10 }], paymentMethod: 'Cash', newCustomer: { name: 'X' } }, { c: 400 }], // cashier: shift gate (business 400), NOT a permission 403
]
for (const [method, path, body, expect] of matrix) {
  for (const [role, cookie] of Object.entries(R)) {
    if (!(role in expect)) continue
    const res = await call(method, path, cookie, body)
    assert(res.status === expect[role], `RBAC ${method} ${path.split('?')[0]} as ${role.toUpperCase()} -> ${expect[role]} (got ${res.status})`)
  }
}
// payment void: manager forbidden, admin allowed
const payToVoid = await M.Payment.create({ customer: order.customer, order: order._id, amount: 100, paymentMethod: 'Cash', paymentType: 'Partial', date: today, remainingBalance: 2900, paymentStatus: 'Partial', receivedBy: adminUser._id })
const mgrVoid = await call('DELETE', `/payments/${payToVoid._id}`, MANAGER)
assert(mgrVoid.status === 403, 'manager cannot void payments (403)')
// supplier financials hidden from cashier
const supCashier = await call('GET', `/suppliers/${supplier._id}`, CASHIER)
assert(supCashier.json.supplier && !('outstandingBalance' in supCashier.json.supplier), 'cashier cannot see supplier outstanding balance')
const supAdmin = await call('GET', `/suppliers/${supplier._id}`, ADMIN)
assert('outstandingBalance' in (supAdmin.json.supplier || {}), 'admin CAN see supplier balance')
// order options: purchase cost stripped for cashier
await M.InventoryItem.updateOne({ _id: itemA._id }, { $set: { goatDetails: { tagNumber: 'T-1', purchasePrice: 777, sellingPrice: 1000 } } })
const optCashier = await call('GET', '/orders/options', CASHIER)
const optItem = optCashier.json.items.find(x => x._id === String(itemA._id))
assert(optItem && optItem.goatDetails && !('purchasePrice' in optItem.goatDetails), 'cashier order options hide purchase cost')
const optAdmin = await call('GET', '/orders/options', ADMIN)
assert(optAdmin.json.items.find(x => x._id === String(itemA._id))?.goatDetails?.purchasePrice === 777, 'admin order options include purchase cost')

/* ================= AUTH LOCKOUT ================= */
await User.create({ username: 'lockme', name: 'Lock Test', role: 'CASHIER', pinHash: await bcrypt.hash('9999', 12) })
for (let i = 0; i < 5; i++) {
  await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ username: 'lockme', pin: '0000', role: 'CASHIER' }) })
}
const locked = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ username: 'lockme', pin: '9999', role: 'CASHIER' }) })
assert(locked.status === 423, `correct PIN during lockout -> 423 (got ${locked.status})`)

console.log(`\nALL AUDIT E2E CHECKS PASSED (${passed} assertions)`)
process.exit(0)
