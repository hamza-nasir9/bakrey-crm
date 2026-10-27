import { Attendance, Customer, DailyClosing, Employee, Expense, InventoryItem, Order, Payment, Purchase, Salary, Shift, StockUsage, Supplier } from '../models/BusinessModels.js'
const period=(from,to)=>({$gte:new Date(`${from}T00:00:00`),$lte:new Date(`${to}T23:59:59.999Z`)});const total=(rows)=>rows[0]?.total||0;const sum=(model,field,match)=>model.aggregate([{$match:match},{$group:{_id:null,total:{$sum:`$${field}`}}}]);const daySeries=(rows,from,to)=>{const map=new Map(rows.map(x=>[x._id,x.total]));const out=[];for(let d=new Date(`${from}T00:00:00.000Z`);d<=new Date(`${to}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+1)) /* AUDIT FIX: iterate in UTC — local midnights shifted every chart key one day back in UTC+5, so daily values silently landed on the wrong date */{const key=d.toISOString().slice(0,10);out.push({date:key,value:map.get(key)||0})}return out};const dated=(model,dateField,valueField,match)=>model.aggregate([{$match:match},{$group:{_id:{$dateToString:{format:'%Y-%m-%d',date:`$${dateField}`}},total:{$sum:`$${valueField}`}}},{$sort:{_id:1}}])
export async function analytics(from,to){const p=period(from,to);const [revenueRows,expenseRows,purchaseRows,salaryRows,orders,payments,expenses,purchases,salaries,revenueDates,expenseDates,orderDates,usageDates,attendance,lowStock,topCustomers,topSuppliers,bestItems,shiftPerformance]=await Promise.all([Payment.aggregate([{$match:{date:p,isVoided:false}},{$group:{_id:null,total:{$sum:{$cond:[{$eq:['$paymentType','Refund']},{$multiply:['$amount',-1]},'$amount']}}}}]) /* AUDIT FIX: refunds netted, matching dashboard + daily closing */,sum(Expense,'amount',{expenseDate:p,status:'Active'}),sum(Purchase,'totalPrice',{date:p}),sum(Salary,'paidAmount',{salaryDate:p,isVoided:false}),Order.countDocuments({bookingDate:p}),Payment.countDocuments({date:p,isVoided:false}),Expense.aggregate([{$match:{expenseDate:p,status:'Active'}},{$group:{_id:'$category',total:{$sum:'$amount'}}},{$sort:{total:-1}}]),Purchase.aggregate([{$match:{date:p}},{$group:{_id:null,total:{$sum:'$totalPrice'}}}]),Salary.aggregate([{$match:{salaryDate:p,isVoided:false}},{$group:{_id:null,total:{$sum:'$paidAmount'}}}]),Payment.aggregate([{$match:{date:p,isVoided:false}},{$group:{_id:{$dateToString:{format:'%Y-%m-%d',date:'$date'}},total:{$sum:{$cond:[{$eq:['$paymentType','Refund']},{$multiply:['$amount',-1]},'$amount']}}}},{$sort:{_id:1}}]) /* AUDIT FIX: net-of-refund daily revenue */,dated(Expense,'expenseDate','amount',{expenseDate:p,status:'Active'}),dated(Order,'bookingDate','totalAmount',{bookingDate:p,status:{$ne:'Cancelled'}}),dated(StockUsage,'date','quantityUsed',{date:p}),Attendance.aggregate([{$match:{attendanceDate:p,isActive:true}},{$group:{_id:'$status',count:{$sum:1}}}]),InventoryItem.countDocuments({isActive:true,$expr:{$lte:['$quantity','$lowStockThreshold']}}),Order.aggregate([{$match:{bookingDate:p,status:{$ne:'Cancelled'}}},{$group:{_id:'$customer',total:{$sum:'$totalAmount'},orders:{$sum:1}}},{$sort:{total:-1}},{$limit:5},{$lookup:{from:'customers',localField:'_id',foreignField:'_id',as:'customer'}},{$unwind:'$customer'},{$project:{name:'$customer.name',total:1,orders:1}}]),Purchase.aggregate([{$match:{date:p}},{$group:{_id:'$supplier',total:{$sum:'$totalPrice'}}},{$sort:{total:-1}},{$limit:5},{$lookup:{from:'suppliers',localField:'_id',foreignField:'_id',as:'supplier'}},{$unwind:'$supplier'},{$project:{name:'$supplier.name',total:1}}]),Order.aggregate([{$match:{bookingDate:p,status:{$ne:'Cancelled'}}},{$unwind:'$items'},{$group:{_id:'$items.itemName',quantity:{$sum:'$items.quantity'},total:{$sum:{$multiply:['$items.quantity','$items.unitPrice']}}}},{$sort:{quantity:-1}},{$limit:5}]),Shift.aggregate([{$match:{shiftStartTime:p}},{$group:{_id:'$cashier',orders:{$sum:'$totalOrders'},payments:{$sum:'$totalPayments'},difference:{$sum:'$cashDifference'}}},{$lookup:{from:'users',localField:'_id',foreignField:'_id',as:'cashier'}},{$unwind:{path:'$cashier',preserveNullAndEmptyArrays:true}},{$project:{name:'$cashier.name',orders:1,payments:1,difference:1}}])]);const revenue=total(revenueRows),otherExpenses=total(expenseRows),purchaseCost=total(purchaseRows),salaryCost=total(salaryRows);const revenueSeries=daySeries(revenueDates,from,to);/* AUDIT FIX: the profit chart previously subtracted ONLY expenses, so it disagreed with the summary netProfit on the same page. Fetch purchase/salary day series and subtract every cost — one definition everywhere: revenue - purchases - salaries - expenses. */const [purchaseDates,salaryDates]=await Promise.all([dated(Purchase,'date','totalPrice',{date:p}),dated(Salary,'salaryDate','paidAmount',{salaryDate:p,isVoided:false})]);const byDate=(rows)=>new Map(daySeries(rows,from,to).map(x=>[x.date,x.value]));const expByDate=byDate(expenseDates),purByDate=byDate(purchaseDates),salByDate=byDate(salaryDates);return {summary:{revenue,purchaseCost,salaryCost,otherExpenses,netProfit:revenue-purchaseCost-salaryCost-otherExpenses,totalOrders:orders,totalPayments:payments,lowStock},charts:{revenue:revenueSeries,expenses:daySeries(expenseDates,from,to),profit:revenueSeries.map(x=>({...x,value:x.value-(expByDate.get(x.date)||0)-(purByDate.get(x.date)||0)-(salByDate.get(x.date)||0)})),orders:daySeries(orderDates,from,to),inventoryUsage:daySeries(usageDates,from,to)},breakdowns:{expenseCategories:expenses,attendance,topCustomers,topSuppliers,bestItems,shiftPerformance}}}
const collections={Inventory:InventoryItem,Suppliers:Supplier,Customers:Customer,Orders:Order,Payments:Payment,Employees:Employee,Attendance,Salary,Expenses:Expense,Shifts:Shift,'Daily Closing':DailyClosing}
export async function reportRows(type,from,to){const p=period(from,to);if(type==='Profit & Loss'||type==='Monthly Business Summary'||type==='Yearly Business Summary')return [await analytics(from,to)];if(type==='Inventory')return InventoryItem.find().lean();if(type==='Suppliers')return Supplier.find().lean();if(type==='Customers')return Customer.find().lean();if(type==='Daily Closing')return DailyClosing.find({closingDate:p}).lean();const model=collections[type];if(!model)throw new Error('Invalid report type.');const dateField={Orders:'bookingDate',Payments:'date',Attendance:'attendanceDate',Salary:'salaryDate',Expenses:'expenseDate',Shifts:'shiftStartTime'}[type];return model.find(dateField?{[dateField]:p}:{}).lean()}

/**
 * File-ready export rows for the three most-requested downloads.
 * reportRows() returns raw Mongoose documents (ObjectIds, nested items,
 * internal fields) because the Reports screen renders them; exports need
 * flat, human-readable rows instead, so shaping happens here, only for files.
 * Falls back to the raw rows for every other report type.
 */
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')
export async function exportRows(type, from, to) {
  const p = period(from, to)
  if (type === 'Orders') { // Sales report
    const orders = await Order.find({ bookingDate: p, status: { $ne: 'Cancelled' } })
      .populate('customer', 'name phone').sort({ bookingDate: 1 }).lean()
    return orders.map((o) => ({
      'Order ID': o.orderId, Date: ymd(o.bookingDate), 'Delivery Date': ymd(o.deliveryDate),
      Customer: o.customer?.name || '', Phone: o.customer?.phone || '',
      Items: (o.items || []).map((i) => `${i.itemName} x${i.quantity}`).join('; '),
      'Total Amount': o.totalAmount, 'Advance Paid': o.advancePaid, 'Remaining': o.remainingAmount,
      'Payment Status': o.paymentStatus, 'Payment Method': o.paymentMethod, Status: o.status,
    }))
  }
  if (type === 'Expenses') {
    const rows = await Expense.find({ expenseDate: p, status: 'Active' }).sort({ expenseDate: 1 }).lean()
    return rows.map((e) => ({
      'Expense ID': e.expenseId, Date: ymd(e.expenseDate), Category: e.category, Title: e.title,
      Description: e.description || '', Amount: e.amount, 'Payment Method': e.paymentMethod || '', Notes: e.notes || '',
    }))
  }
  if (type === 'Attendance') {
    const rows = await Attendance.find({ attendanceDate: p, isActive: true })
      .populate('employee', 'name employeeId position').sort({ attendanceDate: 1 }).lean()
    return rows.map((a) => ({
      'Attendance ID': a.attendanceId, Date: ymd(a.attendanceDate),
      'Employee ID': a.employee?.employeeId || '', Employee: a.employee?.name || '', Position: a.employee?.position || '',
      Status: a.status, 'Check In': a.checkInTime || '', 'Check Out': a.checkOutTime || '',
      'Working Hours': a.workingHours || 0, 'Overtime Hours': a.overtimeHours || 0, Notes: a.attendanceNotes || '',
    }))
  }
  return reportRows(type, from, to)
}
