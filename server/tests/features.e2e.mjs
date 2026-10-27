/**
 * OPTIONAL integration test (not part of `npm test`):
 *   npm i -D mongodb-memory-server
 *   node server/tests/features.e2e.mjs
 * Boots the real API against an in-memory MongoDB and verifies the v2.2
 * features over HTTP: analytics series, audit logs, shaped exports.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
process.env.MONGODB_URI = mongo.getUri('bakrey_feat')
process.env.JWT_SECRET = 'e2e-test-secret-at-least-thirty-two-chars!!'
process.env.NODE_ENV = 'production'
process.env.PORT = '4601'
process.env.CLIENT_URL = 'http://localhost:5173'

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1) } console.log('PASS:', m) }
const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
await import(`${root}/server/index.js`)
const mongoose = (await import('mongoose')).default
for (let i = 0; i < 40 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 250))
assert(mongoose.connection.readyState === 1, 'API connected')

const bcrypt = (await import('bcryptjs')).default
const User = (await import(`${root}/server/models/User.js`)).default
const M = await import(`${root}/server/models/BusinessModels.js`)
const today = new Date(); const ymd = (d) => d.toISOString().slice(0, 10)
const admin = await User.create({ username: 'admin', name: 'E2E Admin', role: 'ADMIN', passwordHash: await bcrypt.hash('StrongPass#1', 12) })
const cashier = await User.create({ username: 'cashier1', name: 'E2E Cashier', role: 'CASHIER', pinHash: await bcrypt.hash('4321', 12) })
const customer = await M.Customer.create({ name: 'Test Customer', phone: '03001234567' })
const item = await M.InventoryItem.create({ itemName: 'Desi Chicken', category: 'Poultry', quantity: 50, unit: 'Kg', lowStockThreshold: 5 })
const employee = await M.Employee.create({ name: 'Staff One', joiningDate: today, position: 'Helper', dailySalary: 1500 })
const order = await M.Order.create({ bookingDate: today, customer: customer._id, items: [{ inventoryItem: item._id, itemId: item.itemId, itemName: item.itemName, quantity: 2, unitPrice: 2500 }], totalAmount: 5000, advancePaid: 5000, remainingAmount: 0, paymentStatus: 'Paid', paymentMethod: 'Cash', status: 'Delivered', createdBy: cashier._id })
await M.Payment.create({ customer: customer._id, order: order._id, amount: 5000, paymentMethod: 'Cash', paymentType: 'Final', date: today, remainingBalance: 0, paymentStatus: 'Paid', receivedBy: cashier._id })
await M.Purchase.create({ date: today, item: item._id, quantity: 10, purchasePrice: 900, totalPrice: 2000, supplier: (await M.Supplier.create({ name: 'Supplier One' }))._id })
await M.Expense.create({ expenseDate: today, category: 'Fuel', title: 'Petrol', amount: 300, paymentMethod: 'Cash', status: 'Active' })
await M.Attendance.create({ employee: employee._id, attendanceDate: today, status: 'Present', workingHours: 8 })
await M.ActivityLog.create([
  { module: 'Orders', action: 'Order cancelled', description: 'AKO-000001 cancelled by test.', actor: cashier._id, occurredAt: today },
  { module: 'Inventory', action: 'Item updated', description: 'AKI-000001 price changed.', actor: admin._id, occurredAt: today },
])

const base = 'http://127.0.0.1:4601/api'
const login = async (body) => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify(body) })
  return (r.headers.get('set-cookie') || '').split(';')[0]
}
const adminCookie = await login({ username: 'admin', password: 'StrongPass#1', role: 'ADMIN' })
const cashierCookie = await login({ username: 'cashier1', pin: '4321', role: 'CASHIER' })
assert(adminCookie && cashierCookie, 'both users logged in (cookies issued)')

const get = (path, cookie) => fetch(`${base}${path}`, { headers: { Cookie: cookie } })

// --- analytics ---
for (const range of ['daily', 'weekly', 'monthly']) {
  const r = await get(`/dashboard/analytics?range=${range}`, adminCookie)
  const d = await r.json()
  assert(r.status === 200 && Array.isArray(d.buckets), `analytics ${range} -> 200 with buckets`)
  if (range === 'daily') {
    assert(d.buckets.length === 30, 'daily has 30 buckets')
    assert(d.totals.sales === 5000, `daily totals.sales = 5000 (got ${d.totals.sales})`)
    assert(d.totals.netProfit === 5000 - 2000 - 300, `daily netProfit = revenue 5000 - purchases 2000 - expenses 300 = 2700 (got ${d.totals.netProfit})`)
  }
  if (range === 'monthly') assert(d.buckets.length === 12, 'monthly has 12 buckets')
}
const cashierAnalytics = await get('/dashboard/analytics?range=daily', cashierCookie)
assert(cashierAnalytics.status === 403, 'cashier blocked from analytics (403)')

// --- audit logs ---
const logsRes = await get('/audit-logs', adminCookie)
const logs = await logsRes.json()
assert(logsRes.status === 200 && logs.total >= 3, `audit logs list (total ${logs.total} incl. login events)`)
assert(logs.logs.some(l => l.action === 'Order cancelled' && l.actor?.role === 'CASHIER'), 'audit log names the cashier who cancelled')
const filtered = await (await get('/audit-logs?module=Inventory', adminCookie)).json()
assert(filtered.logs.every(l => l.module === 'Inventory') && filtered.total >= 1, 'audit module filter works')
const opts = await (await get('/audit-logs/options', adminCookie)).json()
assert(opts.modules.includes('Orders') && opts.actors.length >= 2, 'audit options (modules + actors)')
const csvRes = await get('/audit-logs?format=csv', adminCookie)
assert(csvRes.status === 200 && (await csvRes.text()).includes('Order cancelled'), 'audit CSV export works')
const cashierLogs = await get('/audit-logs', cashierCookie)
assert(cashierLogs.status === 403, 'cashier blocked from audit logs (403)')

// --- shaped exports ---
const from = ymd(new Date(today.getTime() - 86400000)), to = ymd(new Date(today.getTime() + 86400000))
const salesCsv = await get(`/reports/export?type=Orders&format=csv&from=${from}&to=${to}`, adminCookie)
const salesText = await salesCsv.text()
assert(salesCsv.status === 200 && salesText.includes('Test Customer') && salesText.includes('Order ID'), 'sales (Orders) CSV export has customer + friendly columns')
const expXlsx = await get(`/reports/export?type=Expenses&format=xlsx&from=${from}&to=${to}`, adminCookie)
const buf = Buffer.from(await expXlsx.arrayBuffer())
assert(expXlsx.status === 200 && buf.subarray(0, 2).toString() === 'PK', 'expenses XLSX export is a real Excel file')
const attCsv = await get(`/reports/export?type=Attendance&format=csv&from=${from}&to=${to}`, adminCookie)
const attText = await attCsv.text()
assert(attCsv.status === 200 && attText.includes('Staff One') && attText.includes('Present'), 'attendance CSV export has employee names + status')

console.log('\nALL FEATURE E2E CHECKS PASSED')
process.exit(0)
