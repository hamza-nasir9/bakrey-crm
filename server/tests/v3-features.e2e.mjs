/**
 * OPTIONAL v3 feature integration test (not part of `npm test`):
 *   npm i -D mongodb-memory-server
 *   node server/tests/v3-features.e2e.mjs
 * 55 assertions: loyalty earn/redeem, customer ledger, credit limits,
 * branches + transfers + branch stock/financials, recipes (BOM) deduction,
 * wastage loss valuation, notification logs, encrypted backup roundtrip, RBAC.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bakrey-backups-'))
const PORT = 4604
const env = {
  ...process.env, NODE_ENV: 'production', PORT: String(PORT),
  MONGODB_URI: mongo.getUri('bakrey_v3_e2e'),
  JWT_SECRET: 'v3-e2e-secret-at-least-thirty-two-chars-long!!',
  BACKUP_ENCRYPTION_KEY: 'v3-e2e-backup-encryption-key-0123456789',
  BACKUP_DIR: backupDir,
  CORS_ORIGINS: 'http://localhost:5173',
  SEED_ON_START: 'false',
}
const server = spawn('node', ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => { serverLog += d })
server.stderr.on('data', (d) => { serverLog += d })
const base = `http://127.0.0.1:${PORT}/api`
let passed = 0
const assert = (cond, label) => { if (!cond) { console.error('FAIL:', label); console.error(serverLog.slice(-1200)); process.exit(1) } passed++; console.log('PASS:', label) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitReady() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`${base}/health`); if (r.ok) return } catch {} await sleep(300) }
  throw new Error('server did not start\n' + serverLog)
}
async function login(username, secret, role) {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ username, role, ...secret }) })
  assert(res.status === 200, `login ${username} -> 200`)
  return (res.headers.get('set-cookie') || '').split(';')[0]
}
async function call(method, path, cookie, body) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

await waitReady()
const mongoose = (await import('mongoose')).default
await mongoose.connect(env.MONGODB_URI)
const M = await import(`${root}/server/models/BusinessModels.js`)
const P = await import(`${root}/server/models/PlatformModels.js`)
const { default: User } = await import(`${root}/server/models/User.js`)
const bcrypt = (await import('bcryptjs')).default
const pw = await bcrypt.hash('Passw0rd!234', 12)
const [adminUser] = await User.create([
  { username: 'admin1', name: 'Admin', role: 'ADMIN', passwordHash: pw },
  { username: 'manager1', name: 'Manager', role: 'MANAGER', passwordHash: pw },
  { username: 'cashier1', name: 'Cashier', role: 'CASHIER', passwordHash: pw, pinHash: await bcrypt.hash('4321', 12) },
])
const ADMIN = await login('admin1', { password: 'Passw0rd!234' }, 'ADMIN')
const MANAGER = await login('manager1', { password: 'Passw0rd!234' }, 'MANAGER')
const CASHIER = await login('cashier1', { pin: '4321' }, 'CASHIER')

/* fixtures */
const supRes = await call('POST', '/suppliers', ADMIN, { name: 'V3 Supplier', contactNumber: '03001112223', companyName: 'V3 Co' })
console.error('supplier call:', supRes.status, supRes.text.slice(0, 200))
const supplier = supRes.json.supplier
const itemA = (await call('POST', '/inventory/items', ADMIN, { itemName: 'V3 Chicken', category: 'Meat', quantity: 20, unit: 'Kg', lowStockThreshold: 5 })).json.item
const flour = (await call('POST', '/inventory/items', ADMIN, { itemName: 'V3 Flour', category: 'Raw', quantity: 50, unit: 'Kg', lowStockThreshold: 5 })).json.item
const sugar = (await call('POST', '/inventory/items', ADMIN, { itemName: 'V3 Sugar', category: 'Raw', quantity: 30, unit: 'Kg', lowStockThreshold: 5 })).json.item
const cake = (await call('POST', '/inventory/items', ADMIN, { itemName: 'V3 Cake', category: 'Bakery', quantity: 0, unit: 'Piece', lowStockThreshold: 2 })).json.item
if (!(supplier && itemA && flour && sugar && cake)) { const dbg = await call('POST', '/inventory/items', ADMIN, { itemName: 'Dbg', category: 'X', quantity: 1, unit: 'Kg' }); console.error('fixture debug — supplier:', !!supplier, 'itemA:', !!itemA, 'flour:', !!flour, 'sugar:', !!sugar, 'cake:', !!cake, 'extra item call:', dbg.status, dbg.text.slice(0,200)) }
assert(supplier && itemA && flour && sugar && cake, 'fixtures created')
/* NOTE: item creation intentionally starts at 0 in this app (opening stock
   arrives via purchases) — seed opening stock directly for the fixtures. */
await M.InventoryItem.updateOne({ _id: itemA._id }, { $set: { quantity: 20 } })
await M.InventoryItem.updateOne({ _id: flour._id }, { $set: { quantity: 50 } })
await M.InventoryItem.updateOne({ _id: sugar._id }, { $set: { quantity: 30 } })
const todayStr = new Date().toISOString().slice(0, 10)

/* ================= LOYALTY: earn on payment ================= */
const o1 = await call('POST', '/orders', ADMIN, { bookingDate: todayStr, items: [{ inventoryItem: itemA._id, quantity: 2, unitPrice: 2500 }], paymentMethod: 'Cash', advancePaid: 0, newCustomer: { name: 'Loyal Customer', phone: '03005556667', whatsapp: '03005556667' } })
assert(o1.status === 201, `order1 created (${o1.status}: ${o1.text.slice(0,160)})`)
const custId = o1.json.order.customer
const pay1 = await call('POST', '/payments', ADMIN, { order: o1.json.order._id, paymentDate: todayStr, amount: 5000, paymentMethod: 'Cash', paymentType: 'Final' })
assert(pay1.status === 201, `full payment ok (${pay1.status}: ${pay1.text.slice(0,160)})`)
let cust = await M.Customer.findById(custId)
assert(cust.loyaltyPoints === 50, `loyalty earned: 5000 paid -> 50 points (got ${cust.loyaltyPoints})`)
const earnTxn = await P.LoyaltyTransaction.findOne({ customer: custId, type: 'EARN' })
assert(earnTxn && earnTxn.points === 50 && earnTxn.balanceAfter === 50, 'earn transaction recorded with balance')

/* ledger after order1 + payment */
const ledger1 = await call('GET', `/customers/${custId}/ledger`, ADMIN)
assert(ledger1.status === 200 && ledger1.json.entries.length >= 2, 'ledger endpoint returns entries')
const ledgerTypes = ledger1.json.entries.map((e) => e.type)
assert(ledgerTypes.includes('ORDER_CHARGE') && ledgerTypes.includes('PAYMENT'), 'ledger has charge + payment entries')
assert(ledger1.json.customer.pendingBalance === 0, 'ledger customer balance = 0 after full payment')

/* ================= LOYALTY: redeem on next order ================= */
const o2 = await call('POST', '/orders', ADMIN, { bookingDate: todayStr, customer: custId, items: [{ inventoryItem: itemA._id, quantity: 1, unitPrice: 1000 }], paymentMethod: 'Cash', advancePaid: 0, loyaltyRedeemPoints: 20 })
assert(o2.status === 201, `order2 with redemption created (${o2.status}: ${o2.text.slice(0, 120)})`)
assert(o2.json.order.loyaltyDiscount === 20 && o2.json.order.remainingAmount === 980, `redemption applied: discount 20, remaining 980 (got ${o2.json.order.loyaltyDiscount}/${o2.json.order.remainingAmount})`)
cust = await M.Customer.findById(custId)
assert(cust.loyaltyPoints === 30, `points after redeem = 30 (got ${cust.loyaltyPoints})`)
const oBad = await call('POST', '/orders', ADMIN, { bookingDate: todayStr, customer: custId, items: [{ inventoryItem: itemA._id, quantity: 1, unitPrice: 100 }], paymentMethod: 'Cash', advancePaid: 0, loyaltyRedeemPoints: 999 })
assert(oBad.status === 400, 'redeeming more points than balance is rejected')
cust = await M.Customer.findById(custId)
assert(cust.loyaltyPoints === 30, 'points unchanged after rejected redemption')

/* ================= CREDIT LIMIT ================= */
await call('PATCH', `/customers/${custId}`, ADMIN, { name: 'Loyal Customer', creditLimit: 1000 })
const oCredit = await call('POST', '/orders', MANAGER, { bookingDate: todayStr, customer: custId, items: [{ inventoryItem: itemA._id, quantity: 1, unitPrice: 500 }], paymentMethod: 'Cash', advancePaid: 0 })
assert(oCredit.status === 400, `credit limit blocks order (outstanding 980 + 500 > 1000) for manager (got ${oCredit.status})`)
const oOverride = await call('POST', '/orders', ADMIN, { bookingDate: todayStr, customer: custId, items: [{ inventoryItem: itemA._id, quantity: 1, unitPrice: 500 }], paymentMethod: 'Cash', advancePaid: 500 })
assert(oOverride.status === 201, 'admin order within limit after full advance succeeds (remaining 0)')
await call('PATCH', `/customers/${custId}`, ADMIN, { name: 'Loyal Customer', creditLimit: '' })
cust = await M.Customer.findById(custId)
assert(cust.creditLimit === null, 'credit limit cleared back to unrestricted')

/* ================= BRANCHES + TRANSFERS ================= */
const branchRes = await call('POST', '/branches', ADMIN, { code: 'BR2', name: 'Gulberg Branch', type: 'BRANCH' })
assert(branchRes.status === 201, `branch created (${branchRes.status})`)
const br2 = branchRes.json.branch
const branches = await call('GET', '/branches', CASHIER)
assert(branches.json.branches.some((b) => b.isMain) && branches.json.branches.some((b) => b.code === 'BR2'), 'branch list includes MAIN + BR2 (cashier can read)')
const transfer = await call('POST', '/branches/transfers', MANAGER, { fromBranch: branches.json.branches.find((b) => b.isMain)._id, toBranch: br2._id, item: itemA._id, quantity: 6 })
assert(transfer.status === 201, `transfer main -> BR2 ok (${transfer.status}: ${transfer.text.slice(0, 100)})`)
assert((await M.InventoryItem.findById(itemA._id)).quantity === 14, 'main stock 20 -> 14 after transfer out')
const br2Stock = await call('GET', `/branches/stock?branch=${br2._id}`, ADMIN)
assert(br2Stock.json.items.find((i) => i._id === itemA._id)?.quantity === 6, 'BR2 stock shows 6')
const badTransfer = await call('POST', '/branches/transfers', ADMIN, { fromBranch: br2._id, toBranch: branches.json.branches.find((b) => b.isMain)._id, item: itemA._id, quantity: 99 })
assert(badTransfer.status === 400, 'over-transfer rejected')

/* branch order: sell from BR2, delivery deducts BR2 stock only */
const oBranch = await call('POST', '/orders', ADMIN, { bookingDate: todayStr, branch: br2._id, customer: custId, items: [{ inventoryItem: itemA._id, quantity: 2, unitPrice: 1000 }], paymentMethod: 'Cash', advancePaid: 2000 })
assert(oBranch.status === 201 && String(oBranch.json.order.branch) === String(br2._id), 'branch order tagged BR2')
const deliverBranch = await call('PATCH', `/orders/${oBranch.json.order._id}`, ADMIN, { status: 'Delivered' })
assert(deliverBranch.status === 200, `branch order delivered (${deliverBranch.status}: ${deliverBranch.text.slice(0, 100)})`)
const br2Stock2 = await call('GET', `/branches/stock?branch=${br2._id}`, ADMIN)
assert(br2Stock2.json.items.find((i) => i._id === itemA._id)?.quantity === 4, 'BR2 stock 6 -> 4 after branch delivery')
assert((await M.InventoryItem.findById(itemA._id)).quantity === 14, 'main stock untouched by branch delivery')

/* ================= RECIPES / BOM ================= */
/* buy flour so it has a unit cost: 50kg already in stock; purchase adds cost basis */
await call('POST', '/inventory/purchases', ADMIN, { date: todayStr, item: flour._id, quantityKg: 10, supplier: supplier._id, totalPrice: 2000 })
await call('POST', '/inventory/purchases', ADMIN, { date: todayStr, item: sugar._id, quantityKg: 10, supplier: supplier._id, totalPrice: 1500 })
const recipe = await call('POST', '/recipes', MANAGER, { name: 'Choco Cake Recipe', outputItem: cake._id, deductMode: 'INGREDIENTS', ingredients: [{ item: flour._id, quantity: 0.5 }, { item: sugar._id, quantity: 0.2 }] })
assert(recipe.status === 201, `recipe created (${recipe.status}: ${recipe.text.slice(0, 120)})`)
/* flour cost: latest purchase 2000/10 = 200/kg -> 0.5*200=100 ; sugar 150/kg -> 0.2*150=30 ; total 130 */
assert(recipe.json.recipe.costPerUnit === 130, `recipe cost per cake = Rs 130 (got ${recipe.json.recipe.costPerUnit})`)
const flourBefore = (await M.InventoryItem.findById(flour._id)).quantity // 50+10=60
const sugarBefore = (await M.InventoryItem.findById(sugar._id)).quantity // 30+10=40
const oCake = await call('POST', '/orders', ADMIN, { bookingDate: todayStr, customer: custId, items: [{ inventoryItem: cake._id, quantity: 4, unitPrice: 800 }], paymentMethod: 'Cash', advancePaid: 3200 })
assert(oCake.status === 201, 'cake order created')
const deliverCake = await call('PATCH', `/orders/${oCake.json.order._id}`, ADMIN, { status: 'Delivered' })
assert(deliverCake.status === 200, `cake order delivered (${deliverCake.status}: ${deliverCake.text.slice(0, 120)})`)
assert((await M.InventoryItem.findById(flour._id)).quantity === flourBefore - 2, `BOM: flour deducted 4 x 0.5 = 2kg (got ${(await M.InventoryItem.findById(flour._id)).quantity})`)
assert(Math.abs((await M.InventoryItem.findById(sugar._id)).quantity - (sugarBefore - 0.8)) < 1e-9, 'BOM: sugar deducted 4 x 0.2 = 0.8kg')
assert((await M.InventoryItem.findById(cake._id)).quantity === 0, 'BOM: finished cake stock NOT deducted in INGREDIENTS mode')

/* ================= WASTAGE ================= */
const waste = await call('POST', '/inventory/wastage', MANAGER, { date: todayStr, item: itemA._id, quantity: 2, reason: 'Expired' })
assert(waste.status === 201, `wastage recorded (${waste.status}: ${waste.text.slice(0, 120)})`)
assert((await M.InventoryItem.findById(itemA._id)).quantity === 12, 'stock reduced by wastage (14 -> 12)')
const wasteList = await call('GET', '/inventory/wastage', ADMIN)
assert(wasteList.json.summary.totalLoss === waste.json.wastage.lossAmount && waste.json.wastage.lossAmount >= 0, 'wastage loss valued + summarised')
const badWaste = await call('POST', '/inventory/wastage', ADMIN, { date: todayStr, item: itemA._id, quantity: 999, reason: 'Damaged' })
assert(badWaste.status === 400 && (await M.InventoryItem.findById(itemA._id)).quantity === 12, 'over-wastage rejected atomically')

/* ================= BRANCH FINANCIALS ================= */
const fin = await call('GET', `/branches/financials?from=${todayStr}&to=${todayStr}`, ADMIN)
assert(fin.status === 200, 'branch financials ok')
const br2Fin = fin.json.branches.find((b) => b.branch.code === 'BR2')
assert(br2Fin && br2Fin.sales === 2000 && br2Fin.revenue === 2000, `BR2 financials: sales/revenue 2000 (got ${br2Fin?.sales}/${br2Fin?.revenue})`)
assert(fin.json.combined.sales >= 2000 && typeof fin.json.combined.netProfit === 'number', 'combined P&L present with salaries line')

/* ================= NOTIFICATIONS ================= */
const notifLogs = await call('GET', '/system/notification-logs', ADMIN)
assert(notifLogs.status === 200 && notifLogs.json.logs.some((l) => l.template === 'invoice'), 'invoice WhatsApp notification was logged on order creation')
assert(notifLogs.json.logs.find((l) => l.template === 'invoice').status === 'skipped', 'notification status = skipped while provider=none (trail exists, nothing fake-sent)')
const digest = await call('POST', '/system/alerts/digest', ADMIN)
assert(digest.status === 200, `alert digest run ok (${digest.status})`)

/* ================= ENCRYPTED BACKUP ================= */
const backup = await call('POST', '/system/backups/encrypted', ADMIN)
assert(backup.status === 201 && backup.json.backup.filename.endsWith('.json.enc'), `encrypted backup created (${backup.status}: ${backup.text.slice(0, 100)})`)
const files = fs.readdirSync(backupDir)
assert(files.length === 1, 'backup file written to BACKUP_DIR')
process.env.MONGODB_URI = env.MONGODB_URI; process.env.JWT_SECRET = env.JWT_SECRET // env.js validates on import inside THIS process too
const { decryptEnvelope } = await import(`${root}/server/services/backupService.js`)
const snapshot = decryptEnvelope(fs.readFileSync(path.join(backupDir, files[0])), 'v3-e2e-backup-encryption-key-0123456789')
assert(Array.isArray(snapshot.Customer) && snapshot.Customer.length >= 1 && Array.isArray(snapshot.Recipe), 'backup decrypts and contains customers + recipes (roundtrip)')

/* ================= RBAC spot checks ================= */
assert((await call('POST', '/branches', MANAGER, { code: 'X1', name: 'Nope' })).status === 403, 'manager cannot create branches (403)')
assert((await call('GET', '/recipes', CASHIER)).status === 403, 'cashier cannot view recipes (403)')
assert((await call('GET', `/customers/${custId}/ledger`, CASHIER)).status === 403, 'cashier cannot view customer ledger (403)')
assert((await call('POST', '/inventory/wastage', CASHIER, { date: todayStr, item: itemA._id, quantity: 1, reason: 'Other' })).status === 403, 'cashier cannot record wastage (403)')
assert((await call('POST', '/system/backups/encrypted', MANAGER)).status === 403, 'manager cannot run backups (403)')
assert((await call('GET', '/branches/financials', CASHIER)).status === 403, 'cashier cannot view branch financials (403)')

console.log(`\nALL V3 E2E CHECKS PASSED (${passed} assertions)`)
server.kill(); await mongo.stop(); process.exit(0)
