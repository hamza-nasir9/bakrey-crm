import mongoose from 'mongoose'
import { searchRegex, escapeRegExp } from '../middleware/validate.js'
import { ActivityLog, Customer, Order, Payment } from '../models/BusinessModels.js'
const validId=value=>mongoose.isValidObjectId(value);const fail=(res,message)=>res.status(400).json({message});const values=body=>({name:body.name?.trim(),phone:body.phone?.trim(),whatsapp:body.whatsapp?.trim(),address:body.address?.trim(),city:body.city?.trim(),notes:body.notes?.trim(),isActive:body.isActive!==false,/* v3: udhar limit — empty/null clears it (unrestricted); a number caps outstanding. */creditLimit:body.creditLimit===''||body.creditLimit==null?null:(Number.isFinite(Number(body.creditLimit))&&Number(body.creditLimit)>=0?Number(body.creditLimit):null)});const log=(data,actor)=>ActivityLog.create({...data,actor})
export async function listCustomers(req,res,next){try{const {search='',status='',city='',page=1,limit=25}=req.query;const filter={};if(search)filter.$or=['customerId','name','phone','whatsapp','city'].map(field=>({[field]:searchRegex(search)}));if(status==='active')filter.isActive=true;if(status==='inactive')filter.isActive=false;if(city)filter.city=new RegExp(`^${escapeRegExp(city)}$`,'i');const [customers,total]=await Promise.all([Customer.find(filter).sort({updatedAt:-1}).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean(),Customer.countDocuments(filter)]);res.json({customers,total,page:Number(page),limit:Number(limit)})}catch(error){next(error)}}
export async function createCustomer(req,res,next){try{const input=values(req.body);if(!input.name)return fail(res,'Customer Name is required.');const customer=await Customer.create(input);await log({module:'Customers',action:'Customer created',description:`${customer.customerId} · ${customer.name} was added.`},req.auth.sub);res.status(201).json({customer})}catch(error){next(error)}}
export async function updateCustomer(req,res,next){try{if(!validId(req.params.id))return fail(res,'Invalid customer.');const input=values(req.body);if(!input.name)return fail(res,'Customer Name is required.');const customer=await Customer.findByIdAndUpdate(req.params.id,input,{new:true,runValidators:true});if(!customer)return res.status(404).json({message:'Customer not found.'});await log({module:'Customers',action:'Customer updated',description:`${customer.customerId} · ${customer.name} profile was updated.`},req.auth.sub);res.json({customer})}catch(error){next(error)}}
export async function deactivateCustomer(req,res,next){try{if(!validId(req.params.id))return fail(res,'Invalid customer.');const customer=await Customer.findByIdAndUpdate(req.params.id,{isActive:false},{new:true});if(!customer)return res.status(404).json({message:'Customer not found.'});await log({module:'Customers',action:'Customer deactivated',description:`${customer.customerId} · ${customer.name} was deactivated.`},req.auth.sub);res.status(204).end()}catch(error){next(error)}}
export async function customerProfile(req,res,next){try{if(!validId(req.params.id))return fail(res,'Invalid customer.');const customer=await Customer.findById(req.params.id).lean();if(!customer)return res.status(404).json({message:'Customer not found.'});const [orders,payments]=await Promise.all([Order.find({customer:customer._id}).sort({bookingDate:-1}).lean(),Payment.find({customer:customer._id}).sort({date:-1}).lean()]);const pendingBalance=orders.filter(order=>order.status!=='Cancelled').reduce((sum,order)=>sum+order.remainingAmount,0);if(customer.pendingBalance!==pendingBalance)await Customer.findByIdAndUpdate(customer._id,{pendingBalance});res.json({customer:{...customer,pendingBalance},orderHistory:orders,paymentHistory:payments,summary:{orderTotal:orders.filter(x=>x.status!=='Cancelled').reduce((sum,x)=>sum+x.totalAmount,0),paymentTotal:payments.reduce((sum,x)=>sum+x.amount,0),pendingBalance}})}catch(error){next(error)}}

/* v3: customer ledger (udhar khata) + loyalty history for the profile page. */
import { CustomerLedgerEntry, LoyaltyTransaction } from '../models/PlatformModels.js'
export async function customerLedger(req, res, next) {
  try {
    if (!validId(req.params.id)) return fail(res, 'Invalid customer.')
    const customer = await Customer.findById(req.params.id).select('customerId name phone pendingBalance creditLimit loyaltyPoints').lean()
    if (!customer) return res.status(404).json({ message: 'Customer not found.' })
    const { page = 1, limit = 50 } = req.query
    const [entries, total, loyalty] = await Promise.all([
      CustomerLedgerEntry.find({ customer: customer._id }).populate('createdBy', 'name')
        .sort({ occurredAt: -1, createdAt: -1 }).skip((Number(page) - 1) * Number(limit)).limit(Number(limit)).lean(),
      CustomerLedgerEntry.countDocuments({ customer: customer._id }),
      LoyaltyTransaction.find({ customer: customer._id }).sort({ occurredAt: -1 }).limit(20).lean(),
    ])
    res.json({ customer, entries, total, loyalty })
  } catch (error) { next(error) }
}
