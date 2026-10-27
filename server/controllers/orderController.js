import mongoose from 'mongoose'
import { ActivityLog, Customer, InventoryItem, Order, Payment } from '../models/BusinessModels.js'
import { operationalShift } from '../services/shiftService.js'
import { searchRegex } from '../middleware/validate.js'
import { deliverOrderAtomically, mergeOrderLines } from '../services/orderStockService.js'
import { earnOnPayment, redeemPoints, refundRedeemedPoints } from '../services/loyaltyService.js'
import { ledgerRunner } from '../services/ledgerService.js'
import { resolveBranch } from '../services/branchService.js'
import { notifyInvoiceCreated } from '../services/notificationService.js'
const id=x=>mongoose.isValidObjectId(x);const fail=(res,message)=>res.status(400).json({message});const num=x=>Number(x);const methods=['Cash','Bank','JazzCash','EasyPaisa','Other'];const statuses=['Pending','Confirmed','Completed','Delivered','Cancelled'];const log=(data,actor)=>ActivityLog.create({...data,actor})
const paymentState=(total,advance)=>advance>=total?'Paid':advance>0?'Partial':'Pending'
async function refreshCustomer(customerId){const orders=await Order.find({customer:customerId,status:{$ne:'Cancelled'}}).select('remainingAmount');const pendingBalance=orders.reduce((sum,o)=>sum+o.remainingAmount,0);return Customer.findByIdAndUpdate(customerId,{pendingBalance},{new:true})}
// Lets an order be booked for either an existing customer (by id, unchanged
// path) or a brand-new customer entered right there on the New Order screen.
// When creating new, we dedupe on phone number against active customers
// first so the same walk-in booker doesn't end up with a duplicate profile
// every time a cashier takes their order.
async function resolveOrderCustomer(body,actor){
  const {customer,newCustomer}=body
  if(id(customer))return {client:await Customer.findOne({_id:customer,isActive:true}),created:false}
  const name=newCustomer?.name?.trim()
  if(!name)return {client:null,created:false}
  const phone=newCustomer?.phone?.trim()
  if(phone){const existing=await Customer.findOne({phone,isActive:true});if(existing)return {client:existing,created:false}}
  const client=await Customer.create({name,phone,whatsapp:newCustomer?.whatsapp?.trim(),address:newCustomer?.address?.trim(),city:newCustomer?.city?.trim()})
  await log({module:'Customers',action:'Customer created',description:`${client.customerId} · ${client.name} was added while booking an order.`},actor)
  return {client,created:true}
}
export async function orderOptions(req,res,next){try{const [customers,items]=await Promise.all([Customer.find({isActive:true}).select('customerId name phone loyaltyPoints creditLimit').sort({name:1}).lean(),InventoryItem.find({isActive:true,quantity:{$gt:0}}).select('itemId itemName category quantity unit goatDetails').sort({itemName:1}).lean()]);
  // Cashiers get selling price (needed to book an order) but never purchase cost.
  const visibleItems=req.auth.role!=='CASHIER'?items:items.map(item=>item.goatDetails?{...item,goatDetails:{...item.goatDetails,purchasePrice:undefined}}:item)
  res.json({customers,items:visibleItems})}catch(error){next(error)}}
export async function listOrders(req,res,next){try{const {search='',status='',customer='',fromDate='',toDate='',page=1,limit=25}=req.query;const filter={};if(search)filter.$or=['orderId','orderNumber'].map(f=>({[f]:searchRegex(search)}));if(status)filter.status=status;if(id(customer))filter.customer=customer;if(fromDate||toDate)filter.bookingDate={...(fromDate&&{$gte:new Date(fromDate)}),...(toDate&&{$lte:new Date(`${toDate}T23:59:59.999Z`)})};
  // Cashiers only ever see orders they themselves booked, regardless of what filters they send.
  if(req.auth.role==='CASHIER')filter.createdBy=req.auth.sub
  const [orders,total]=await Promise.all([Order.find(filter).populate('customer','customerId name phone').sort({bookingDate:-1,createdAt:-1}).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean(),Order.countDocuments(filter)]);res.json({orders,total,page:Number(page),limit:Number(limit)})}catch(error){next(error)}}
export async function createOrder(req,res,next){try{const {bookingDate,deliveryDate,items,advancePaid=0,paymentMethod,notes,status='Pending',branch,loyaltyRedeemPoints=0,allowCreditOverride=false}=req.body;const shift=req.auth.role==='CASHIER'?await operationalShift(req.auth.sub):null;if(req.auth.role==='CASHIER'&&!shift)return fail(res,'You need an open shift within your assigned schedule window before creating an order.');if(!bookingDate||!Array.isArray(items)||!items.length||!methods.includes(paymentMethod)||!statuses.includes(status)||!Number.isFinite(num(advancePaid))||num(advancePaid)<0)return fail(res,'Booking Date, one or more items, valid Payment Method, and a valid Advance Payment are required.');const {client,created}=await resolveOrderCustomer(req.body,req.auth.sub);if(!client)return fail(res,'Select an existing customer or enter a new customer Name.');const customer=client._id;const startBalance=client.pendingBalance||0;const sellingBranch=await resolveBranch(branch);const requested=mergeOrderLines(items.map(row=>({inventoryItem:row.inventoryItem,quantity:num(row.quantity),unitPrice:num(row.unitPrice)})));if(requested.some(row=>!id(row.inventoryItem)||!Number.isFinite(row.quantity)||row.quantity<=0||!Number.isFinite(row.unitPrice)||row.unitPrice<0))return fail(res,'Every selected goat/item needs a positive Quantity and valid Unit Price.');const stock=await InventoryItem.find({_id:{$in:requested.map(x=>x.inventoryItem)},isActive:true});if(stock.length!==requested.length)return fail(res,'One or more selected inventory items are unavailable.');const orderItems=requested.map(row=>{const inventory=stock.find(s=>s._id.toString()===row.inventoryItem);return {inventoryItem:inventory._id,itemId:inventory.itemId,itemName:inventory.itemName,goatDetails:inventory.goatDetails,quantity:row.quantity,unitPrice:row.unitPrice}});const totalAmount=orderItems.reduce((sum,row)=>sum+row.quantity*row.unitPrice,0);if(num(advancePaid)>totalAmount)return fail(res,'Advance Payment cannot exceed Total Amount.');
// v3 LOYALTY: redeem points first (atomic guarded decrement — points can
// never be double-spent). Any later failure in this function refunds them.
let redeemed=null;if(num(loyaltyRedeemPoints)>0){try{redeemed=await redeemPoints({customerId:customer,points:num(loyaltyRedeemPoints),actor:req.auth.sub})}catch(error){return fail(res,error.message)}}
const loyaltyDiscount=redeemed?.discount||0;
if(num(advancePaid)+loyaltyDiscount>totalAmount){if(redeemed)await refundRedeemedPoints({customerId:customer,points:redeemed.points,actor:req.auth.sub,reason:'Redemption refunded — order total exceeded'});return fail(res,'Advance Payment plus loyalty discount cannot exceed Total Amount.')}
const remainingAmount=totalAmount-num(advancePaid)-loyaltyDiscount;
// v3 CREDIT LIMIT: a set limit caps the customer's TOTAL outstanding.
// Admins may explicitly override (allowCreditOverride) — the order and its
// ledger trail still record exactly what happened.
if(client.creditLimit!=null){const projected=startBalance+remainingAmount;const override=req.auth.role==='ADMIN'&&allowCreditOverride===true;if(projected>client.creditLimit&&!override){if(redeemed)await refundRedeemedPoints({customerId:customer,points:redeemed.points,actor:req.auth.sub,reason:'Redemption refunded — credit limit blocked the order'});return fail(res,`Credit limit exceeded for ${client.name}: limit Rs ${client.creditLimit}, current outstanding Rs ${startBalance}, this order adds Rs ${remainingAmount}. Raise the limit on the customer profile or take more advance.`)}}
let order;try{order=await Order.create({bookingDate,deliveryDate:deliveryDate||undefined,customer,items:orderItems,totalAmount,advancePaid:num(advancePaid),remainingAmount,paymentStatus:paymentState(totalAmount,num(advancePaid)+loyaltyDiscount),paymentMethod,status,notes:notes?.trim(),shift:shift?shift._id:undefined,branch:sellingBranch._id,loyaltyPointsRedeemed:redeemed?.points||0,loyaltyDiscount,createdBy:req.auth.sub})}catch(error){if(redeemed)await refundRedeemedPoints({customerId:customer,points:redeemed.points,actor:req.auth.sub,reason:'Redemption refunded — order creation failed'});throw error}/* order created above (v3 block) */let advancePayment=null;if(num(advancePaid)>0){advancePayment=await Payment.create({customer,order:order._id,branch:sellingBranch._id,shift:shift?shift._id:undefined,amount:num(advancePaid),paymentMethod,paymentType:'Advance',date:bookingDate,remainingBalance:order.remainingAmount,paymentStatus:order.paymentStatus,receivedBy:req.auth.sub,paymentNotes:`Advance payment for ${order.orderId}`});await log({module:'Payments',action:'Advance payment received',description:`Advance payment recorded for ${order.orderId}.`,amount:num(advancePaid)},req.auth.sub);await earnOnPayment({customerId:customer,amount:num(advancePaid),orderId:order._id,paymentId:advancePayment._id,actor:req.auth.sub})}
await refreshCustomer(customer);
// v3 LEDGER: itemised khata entries with a running balance for this order.
{const ledger=ledgerRunner(startBalance);await ledger.add(customer,{type:'ORDER_CHARGE',amount:totalAmount,order:order._id,actor:req.auth.sub,note:`Order ${order.orderId}`});if(loyaltyDiscount>0)await ledger.add(customer,{type:'ADJUSTMENT',amount:-loyaltyDiscount,order:order._id,actor:req.auth.sub,note:`Loyalty redemption: ${redeemed.points} points`});if(advancePayment)await ledger.add(customer,{type:'PAYMENT',amount:-num(advancePaid),order:order._id,payment:advancePayment._id,actor:req.auth.sub,note:'Advance payment'})}
// v3 NOTIFICATION: digital invoice on the customer's WhatsApp (logged even
// when no provider is configured yet — see NotificationLog).
notifyInvoiceCreated({order,customer:client}).catch(()=>{});await log({module:'Orders',action:'Order created',description:`${order.orderId} booked for ${client.name}${created?' (new customer)':''}.`,amount:totalAmount},req.auth.sub);res.status(201).json({order,customer:client})}catch(error){next(error)}}
const ownsOrder=(order,req)=>req.auth.role!=='CASHIER'||order.createdBy?.toString()===req.auth.sub
export async function orderDetails(req,res,next){try{if(!id(req.params.id))return fail(res,'Invalid order.');const order=await Order.findById(req.params.id).populate('customer','customerId name phone address city').populate('branch','code name').lean();if(!order)return res.status(404).json({message:'Order not found.'});if(!ownsOrder(order,req))return res.status(403).json({message:'You can only view your own orders.'});const paymentHistory=await Payment.find({order:order._id,isVoided:false}).sort({date:1,createdAt:1}).lean();res.json({order,paymentHistory})}catch(error){next(error)}}
export async function updateOrder(req,res,next){try{if(!id(req.params.id))return fail(res,'Invalid order.');const order=await Order.findById(req.params.id);if(!order)return res.status(404).json({message:'Order not found.'});if(!ownsOrder(order,req))return res.status(403).json({message:'You can only update your own orders.'});if(order.inventoryDeducted)return fail(res,'Delivered orders cannot be edited.');const {deliveryDate,notes,status,paymentMethod}=req.body;if(status&&!statuses.includes(status))return fail(res,'Invalid order status.');if(paymentMethod&&!methods.includes(paymentMethod))return fail(res,'Invalid payment method.');order.deliveryDate=deliveryDate||order.deliveryDate;order.notes=notes?.trim()??order.notes;order.paymentMethod=paymentMethod||order.paymentMethod;const previous=order.status;if(status==='Delivered'){try{await deliverOrderAtomically(order)}catch(stockError){return fail(res,stockError.message)}}else{order.status=status||order.status;await order.save()}await refreshCustomer(order.customer);if(previous!==order.status)await log({module:'Orders',action:'Order status changed',description:`${order.orderId} changed from ${previous} to ${order.status}.`,amount:order.totalAmount},req.auth.sub);else await log({module:'Orders',action:'Order updated',description:`${order.orderId} was updated.`},req.auth.sub);res.json({order})}catch(error){next(error)}}
export async function cancelOrder(req,res,next){try{if(!id(req.params.id))return fail(res,'Invalid order.');const order=await Order.findById(req.params.id);if(!order)return res.status(404).json({message:'Order not found.'});if(!ownsOrder(order,req))return res.status(403).json({message:'You can only cancel your own orders.'});if(order.inventoryDeducted)return fail(res,'Delivered orders cannot be cancelled because stock has already been issued.');if(order.status==='Cancelled')return fail(res,'Order is already cancelled.');const previous=order.status;const outstandingBefore=order.remainingAmount;order.status='Cancelled';await order.save();const refreshed=await refreshCustomer(order.customer);
await appendLedgerOnCancel(order,refreshed,outstandingBefore,req.auth.sub);
if(order.loyaltyPointsRedeemed>0)await refundRedeemedPoints({customerId:order.customer,points:order.loyaltyPointsRedeemed,orderId:order._id,actor:req.auth.sub,reason:`Order ${order.orderId} cancelled — redeemed points refunded`});await log({module:'Orders',action:'Order cancelled',description:`${order.orderId} changed from ${previous} to Cancelled.`,amount:order.totalAmount},req.auth.sub);res.json({order})}catch(error){next(error)}}

/** v3: record the cancellation in the customer's ledger (khata). */
import { appendLedgerEntry } from '../services/ledgerService.js'
async function appendLedgerOnCancel(order, refreshedCustomer, outstandingBefore, actor) {
  if (!(outstandingBefore > 0)) return
  await appendLedgerEntry(order.customer, {
    type: 'CANCEL_REVERSAL', amount: -outstandingBefore,
    balanceAfter: refreshedCustomer?.pendingBalance ?? 0,
    order: order._id, actor, note: `Order ${order.orderId} cancelled`,
  })
}
