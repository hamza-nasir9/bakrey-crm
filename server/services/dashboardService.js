import { ActivityLog, Employee, Expense, InventoryItem, Order, Payment, Purchase, Salary, Supplier } from '../models/BusinessModels.js'
import { activeShift, calculateShift, isWithinWindow } from './shiftService.js'
const amount = (rows, field = 'amount') => rows[0]?.total || 0
const startOfDay = date => { const result = new Date(date); result.setHours(0,0,0,0); return result }
const endOfDay = date => { const result = new Date(date); result.setHours(23,59,59,999); return result }
const range = days => ({ $gte: startOfDay(new Date(Date.now() - (days - 1) * 86400000)), $lte: new Date() })
const totals = model => model.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
const dateTotals = (model, dateField, valueField, days, extraMatch = {}) => model.aggregate([{ $match: { [dateField]: range(days), ...extraMatch } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` } }, total: { $sum: `$${valueField}` } } }, { $sort: { _id: 1 } }])
const series = (rows, days) => { const byDay = new Map(rows.map(x => [x._id, x.total])); return Array.from({ length: days }, (_, index) => { const date = startOfDay(new Date(Date.now() - (days - 1 - index) * 86400000)); const key = date.toISOString().slice(0, 10); return { date: key, label: new Intl.DateTimeFormat('en', { month:'short', day:'numeric' }).format(date), value: byDay.get(key) || 0 } }) }
export async function getDashboardData(period = 'daily') {
  const days = period === 'monthly' ? 30 : period === 'weekly' ? 7 : 1
  const [salesRows, revenueRows, expenseRows, purchaseRows, salaryRows, pendingRows, totalOrders, completedOrders, pendingOrders, employees, suppliers, inventory, lowStock, recentActivities, revenueChartRows, expenseChartRows] = await Promise.all([
    Order.aggregate([{ $match:{status:{$ne:'Cancelled'}} }, { $group:{_id:null,total:{$sum:'$totalAmount'}} }]), Payment.aggregate([{$match:{isVoided:false}},{$group:{_id:null,total:{$sum:{$cond:[{$eq:['$paymentType','Refund']},{$multiply:['$amount',-1]},'$amount']}}}}]), Expense.aggregate([{$match:{status:'Active'}},{$group:{_id:null,total:{$sum:'$amount'}}}]), Purchase.aggregate([{ $group:{_id:null,total:{$sum:'$totalPrice'}} }]), Salary.aggregate([{$match:{isVoided:false}},{$group:{_id:null,total:{$sum:'$paidAmount'}}}]), Order.aggregate([{ $match:{status:{$ne:'Cancelled'}} },{$group:{_id:null,total:{$sum:'$remainingAmount'}}}]), Order.countDocuments(), Order.countDocuments({status:'Completed'}), Order.countDocuments({status:'Pending'}), Employee.countDocuments({status:'Active'}), Supplier.countDocuments({isActive:true}), InventoryItem.aggregate([{ $group:{_id:null,total:{$sum:'$quantity'}} }]), InventoryItem.countDocuments({ $expr: { $lte:['$quantity','$lowStockThreshold'] }, isActive:true }), ActivityLog.find().sort({occurredAt:-1}).limit(8).populate('actor','name').lean(), Payment.aggregate([{$match:{date:range(days),isVoided:false}},{$group:{_id:{$dateToString:{format:'%Y-%m-%d',date:'$date'}},total:{$sum:{$cond:[{$eq:['$paymentType','Refund']},{$multiply:['$amount',-1]},'$amount']}}}},{$sort:{_id:1}}]), Expense.aggregate([{$match:{status:'Active',expenseDate:range(days)}},{$group:{_id:{$dateToString:{format:'%Y-%m-%d',date:'$expenseDate'}},total:{$sum:'$amount'}}},{$sort:{_id:1}}])
  ])
  const revenue = amount(revenueRows), expenses = amount(expenseRows), purchases = amount(purchaseRows,'total'), salaries = amount(salaryRows,'total'), pendingPayments = amount(pendingRows,'total')
  const revenueSeries = series(revenueChartRows, days), expenseSeries = series(expenseChartRows, days); /* AUDIT FIX: mini profit chart previously subtracted only expenses while the cards subtract purchases + salaries + expenses. Align them. */const [purchaseChartRows, salaryChartRows] = await Promise.all([dateTotals(Purchase, 'date', 'totalPrice', days), dateTotals(Salary, 'salaryDate', 'paidAmount', days, { isVoided: false })]); const purchaseByDate = new Map(series(purchaseChartRows, days).map(x=>[x.date,x.value])), salaryByDate = new Map(series(salaryChartRows, days).map(x=>[x.date,x.value])), expensesByDate = new Map(expenseSeries.map(x=>[x.date,x.value])); const profitSeries = revenueSeries.map(x=>({...x,value:x.value-(expensesByDate.get(x.date)||0)-(purchaseByDate.get(x.date)||0)-(salaryByDate.get(x.date)||0)}))
  return { role:'ADMIN', period, cards:{ totalSales:amount(salesRows), totalRevenue:revenue, totalExpenses:expenses, totalPurchase:purchases, totalSalary:salaries, netProfit:revenue-purchases-salaries-expenses, pendingPayments, totalOrders, completedOrders, pendingOrders, totalEmployees:employees, totalSuppliers:suppliers, currentInventory:amount(inventory,'total'), lowStockItems:lowStock }, charts:{ revenue:revenueSeries, expenses:expenseSeries, profit:profitSeries, orders:await dateTotals(Order,'bookingDate','totalAmount',days).then(r=>series(r,days)) }, recentActivities:recentActivities.map(item=>({ id:item._id, module:item.module, action:item.action, description:item.description, amount:item.amount || 0, actor:item.actor?.name || 'System', occurredAt:item.occurredAt })) }
}

// Cashier-scoped dashboard: only the cashier's own operational data for today.
// Deliberately excludes company profit, expenses, salaries, and any other
// owner-level financial totals — those live only in getDashboardData (ADMIN).
export async function getCashierDashboardData(cashierId) {
  const today = { $gte: startOfDay(new Date()), $lte: endOfDay(new Date()) }
  const [shift, todayOrders, todayOrderValueRows, todayCollectionRows, pendingOrders, lowStockItems, recentActivities] = await Promise.all([
    activeShift(cashierId),
    Order.countDocuments({ createdBy: cashierId, bookingDate: today, status: { $ne: 'Cancelled' } }),
    Order.aggregate([{ $match: { createdBy: cashierId, bookingDate: today, status: { $ne: 'Cancelled' } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Payment.aggregate([{ $match: { receivedBy: cashierId, date: today, isVoided: false } }, { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$paymentType', 'Refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } }]),
    Order.countDocuments({ createdBy: cashierId, status: 'Pending' }),
    InventoryItem.countDocuments({ $expr: { $lte: ['$quantity', '$lowStockThreshold'] }, isActive: true }),
    ActivityLog.find({ actor: cashierId }).sort({ occurredAt: -1 }).limit(8).lean(),
  ])
  const shiftLive = shift ? await calculateShift(shift) : null
  return {
    role: 'CASHIER',
    shift: shift ? {
      id: shift._id,
      shiftId: shift.shiftId,
      shiftNumber: shift.shiftNumber,
      status: shift.status,
      startedAt: shift.shiftStartTime,
      openingCash: shift.openingCash,
      totalOrders: shiftLive.totalOrders,
      cashCollected: shiftLive.systemCashCollection,
      expectedCash: shiftLive.expectedCash,
      windowClosed: !isWithinWindow(shift),
    } : null,
    cards: {
      todayOrders,
      todayOrdersValue: amount(todayOrderValueRows),
      todayCollections: amount(todayCollectionRows),
      pendingOrders,
      lowStockItems,
    },
    recentActivities: recentActivities.map(item => ({
      id: item._id,
      module: item.module,
      action: item.action,
      description: item.description,
      amount: item.amount || 0,
      occurredAt: item.occurredAt,
    })),
  }
}
