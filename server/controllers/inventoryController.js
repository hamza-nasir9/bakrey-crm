import mongoose from 'mongoose'
import { searchRegex, escapeRegExp } from '../middleware/validate.js'
import { ActivityLog, InventoryItem, Purchase, StockAdjustment, StockUsage, Supplier } from '../models/BusinessModels.js'
import { operationalShift } from '../services/shiftService.js'
const fail = (res, message) => res.status(400).json({ message })
const isId = value => mongoose.isValidObjectId(value)
const number = value => Number(value)
const units = ['Kg','Piece','Bag','Liter']
const itemFields = body => ({ itemName:body.itemName?.trim(), category:body.category?.trim(), unit:body.unit?.trim(), lowStockThreshold:number(body.lowStockThreshold || 0), imageUrl:body.imageUrl?.trim(), isActive:body.isActive !== false, /* UPGRADE: expiry + batch flow through create/update so alerts can work. Blank expiry clears the date. */ expiryDate:body.expiryDate ? new Date(body.expiryDate) : undefined, batchNo:body.batchNo?.trim() })
const activity = (data, actor) => ActivityLog.create({ ...data, actor })
export async function listItems(req,res,next){try{const {search='',status='',lowStock='',page=1,limit=20}=req.query;const filter={};if(search)filter.$or=[{itemName:searchRegex(search)},{category:searchRegex(search)}];if(status==='active')filter.isActive=true;if(status==='inactive')filter.isActive=false;if(lowStock==='true')filter.$expr={$lte:['$quantity','$lowStockThreshold']};const [items,total]=await Promise.all([InventoryItem.find(filter).sort({updatedAt:-1}).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean(),InventoryItem.countDocuments(filter)]);
// Cashiers see stock levels and selling price (needed to book orders) but never purchase cost — that's owner-level margin data.
const visible=req.auth.role!=='CASHIER'?items:items.map(item=>item.goatDetails?{...item,goatDetails:{...item.goatDetails,purchasePrice:undefined}}:item)
res.json({items:visible,total,page:Number(page),limit:Number(limit)})}catch(error){next(error)}}
export async function createItem(req,res,next){try{const values=itemFields(req.body);if(!values.itemName||!values.category||!values.unit)return fail(res,'Item Name, Category, and Unit are required.');if(!units.includes(values.unit))return fail(res,'Unit must be Kg, Piece, Bag, or Liter.');if(!Number.isFinite(values.lowStockThreshold)||values.lowStockThreshold<0)return fail(res,'Low Stock Threshold must be zero or greater.');const item=await InventoryItem.create({...values,quantity:0});await activity({module:'Inventory',action:'Item created',description:`${item.itemId} · ${item.itemName} was added to inventory.`},req.auth.sub);res.status(201).json({item})}catch(error){next(error)}}
export async function updateItem(req,res,next){try{if(!isId(req.params.id))return fail(res,'Invalid inventory item.');const values=itemFields(req.body);if(!values.itemName||!values.category||!values.unit)return fail(res,'Item Name, Category, and Unit are required.');if(!units.includes(values.unit))return fail(res,'Unit must be Kg, Piece, Bag, or Liter.');const before=await InventoryItem.findById(req.params.id);if(!before)return res.status(404).json({message:'Inventory item not found.'});const item=await InventoryItem.findByIdAndUpdate(req.params.id,values,{new:true,runValidators:true});/* AUDIT UPGRADE: record exactly which fields changed, old -> new, so a price/stock edit is traceable to a person and a moment. */const changes=['itemName','category','unit','lowStockThreshold','batchNo'].filter(f=>values[f]!==undefined&&String(before[f]??'')!==String(item[f]??'')).map(f=>`${f}: ${before[f]??'—'} -> ${item[f]??'—'}`);if(values.expiryDate!==undefined&&String(before.expiryDate||'')!==String(item.expiryDate||''))changes.push(`expiryDate: ${before.expiryDate?String(before.expiryDate).slice(0,10):'—'} -> ${item.expiryDate?String(item.expiryDate).slice(0,10):'—'}`);await activity({module:'Inventory',action:'Item updated',description:`${item.itemId} · ${item.itemName} updated${changes.length?` (${changes.join('; ')})`:''}.`},req.auth.sub);res.json({item})}catch(error){next(error)}}
export async function removeItem(req,res,next){try{if(!isId(req.params.id))return fail(res,'Invalid inventory item.');const item=await InventoryItem.findByIdAndUpdate(req.params.id,{isActive:false},{new:true});if(!item)return res.status(404).json({message:'Inventory item not found.'});await activity({module:'Inventory',action:'Item deactivated',description:`${item.itemName} was deactivated.`},req.auth.sub);res.status(204).end()}catch(error){next(error)}}
export async function createPurchase(req,res,next){try{const {date,item,quantityPieces,quantityKg,supplier,invoiceNo,notes,totalPrice:bodyTotalPrice,branch}=req.body;const isCashier=req.auth.role==='CASHIER';
  const pieces=Number.isFinite(number(quantityPieces))&&number(quantityPieces)>0?number(quantityPieces):undefined;
  const kg=Number.isFinite(number(quantityKg))&&number(quantityKg)>0?number(quantityKg):undefined;
  // Both quantity units are optional individually — at least one must be provided.
  if(!date||!isId(item)||!isId(supplier)||(pieces===undefined&&kg===undefined))return fail(res,'Date, Item, Supplier, and at least one of Quantity (Pieces) or Quantity (KG) are required.');
  const totalPrice=number(bodyTotalPrice);
  if(!(Number.isFinite(totalPrice)&&totalPrice>0))return fail(res,'Purchase Price / Total Amount is required.');
  // Cashiers can only record incoming stock while they have a valid, active
  // shift — enforced here, not just in the UI. Once their scheduled window
  // ends this fails the same way order/payment creation already does.
  let shift=null
  if(isCashier){shift=await operationalShift(req.auth.sub);if(!shift)return fail(res,'You need an open shift within your assigned schedule window before recording incoming stock.')}
  const [stockItem,supplierProfile]=await Promise.all([InventoryItem.findById(item),Supplier.findById(supplier)]);
  if(!stockItem)return res.status(404).json({message:'Inventory item not found.'});
  if(!supplierProfile)return res.status(404).json({message:'Supplier not found.'});
  const purchaseBranch=await resolveBranch(branch);const purchase=await Purchase.create({date,item,quantityPieces:pieces,quantityKg:kg,totalPrice,supplier,invoiceNo:invoiceNo?.trim(),notes:notes?.trim(),createdBy:req.auth.sub,shift:shift?._id,branch:purchaseBranch._id});
  // stockPieces/stockKg are additive running totals shown in the inventory
  // list. The legacy quantity/unit pair stays the single number the rest of
  // the app (low-stock alerts, order availability) already relies on — it
  // increments by whichever of pieces/kg matches this item's own unit, so
  // nothing else in the system needs to change.
  if(pieces!==undefined)stockItem.stockPieces+=pieces
  if(kg!==undefined)stockItem.stockKg+=kg
  if(stockItem.unit==='Piece'&&pieces!==undefined)stockItem.quantity+=pieces
  else if(stockItem.unit==='Kg'&&kg!==undefined)stockItem.quantity+=kg
  else stockItem.quantity+=(pieces||0)+(kg||0)
  /* AUDIT FIX: persist with atomic $inc instead of read-modify-save, so two simultaneous purchases cannot overwrite each other's stock or supplier balance. The in-memory objects above already hold the new values for the response/audit log. */await Promise.all([InventoryItem.updateOne({_id:stockItem._id},{$inc:{quantity:(stockItem.unit==='Piece'&&pieces!==undefined)?pieces:(stockItem.unit==='Kg'&&kg!==undefined)?kg:(pieces||0)+(kg||0),stockPieces:pieces||0,stockKg:kg||0}}),Supplier.updateOne({_id:supplierProfile._id},{$inc:{outstandingBalance:totalPrice}})]);
  // v3 MULTI-BRANCH: a purchase received at a non-main branch/warehouse is
  // stocked THERE, not at main. The catalog-level stats (stockPieces/Kg)
  // above stay global; only the sellable `quantity` moves to the branch.
  {const mainBranch=await ensureMainBranch();if(String(purchaseBranch._id)!==String(mainBranch._id)){const effectiveQty=(stockItem.unit==='Piece'&&pieces!==undefined)?pieces:(stockItem.unit==='Kg'&&kg!==undefined)?kg:(pieces||0)+(kg||0);await InventoryItem.updateOne({_id:stockItem._id},{$inc:{quantity:-effectiveQty}});await adjustStock({itemId:stockItem._id,branch:purchaseBranch,main:mainBranch,delta:effectiveQty})}}
  const parts=[pieces!==undefined?`${pieces} pcs`:null,kg!==undefined?`${kg} kg`:null].filter(Boolean).join(', ');
  await activity({module:'Inventory',action:'Purchase entry',description:`${parts} added to ${stockItem.itemName}.`,amount:totalPrice},req.auth.sub);
  res.status(201).json({purchase,inventoryItem:stockItem})
}catch(error){next(error)}}
export async function createUsage(req,res,next){try{const {date,item,quantityUsed,purpose,remarks}=req.body;if(!date||!isId(item)||!purpose||!Number.isFinite(number(quantityUsed))||number(quantityUsed)<=0)return fail(res,'Date, Item, Quantity Used, and Purpose are required.');const stockItem=await InventoryItem.findById(item);if(!stockItem)return res.status(404).json({message:'Inventory item not found.'});if(stockItem.quantity<number(quantityUsed))return fail(res,'Quantity Used cannot exceed current stock.');/* AUDIT FIX: was read-check-save — two concurrent requests could both pass the check and oversell, and the usage record was created BEFORE the stock save, so a failed save left an orphan record. Now: atomic guarded deduction first, record second, re-credit if the record fails. */const deducted=await InventoryItem.findOneAndUpdate({_id:item,isActive:true,quantity:{$gte:number(quantityUsed)}},{$inc:{quantity:-number(quantityUsed)}},{new:true});if(!deducted)return fail(res,'Quantity Used cannot exceed current stock.');let usage;try{usage=await StockUsage.create({date,item,quantityUsed:number(quantityUsed),purpose:purpose.trim(),remarks:remarks?.trim(),createdBy:req.auth.sub})}catch(createError){await InventoryItem.updateOne({_id:item},{$inc:{quantity:number(quantityUsed)}});throw createError}stockItem.quantity=deducted.quantity;await activity({module:'Inventory',action:'Stock usage',description:`${quantityUsed} ${stockItem.unit} used from ${stockItem.itemName}.`},req.auth.sub);res.status(201).json({usage,inventoryItem:stockItem})}catch(error){next(error)}}
export async function createAdjustment(req,res,next){try{const {date,item,adjustmentType,quantity,reason}=req.body;if(!date||!isId(item)||!['Increase','Decrease'].includes(adjustmentType)||!reason||!Number.isFinite(number(quantity))||number(quantity)<=0)return fail(res,'Date, Item, adjustment type, Quantity, and Reason are required.');const stockItem=await InventoryItem.findById(item);if(!stockItem)return res.status(404).json({message:'Inventory item not found.'});if(adjustmentType==='Decrease'&&stockItem.quantity<number(quantity))return fail(res,'Decrease quantity cannot exceed current stock.');const adjustedQuantity=adjustmentType==='Increase'?number(quantity):-number(quantity);/* AUDIT FIX: same atomic pattern as stock usage (guarded for Decrease). */const adjusted=adjustmentType==='Decrease'?await InventoryItem.findOneAndUpdate({_id:item,isActive:true,quantity:{$gte:number(quantity)}},{$inc:{quantity:-number(quantity)}},{new:true}):await InventoryItem.findOneAndUpdate({_id:item,isActive:true},{$inc:{quantity:number(quantity)}},{new:true});if(!adjusted)return fail(res,'Decrease quantity cannot exceed current stock.');let adjustment;try{adjustment=await StockAdjustment.create({date,item,adjustmentType,quantity:number(quantity),reason:reason.trim(),createdBy:req.auth.sub})}catch(createError){await InventoryItem.updateOne({_id:item},{$inc:{quantity:-adjustedQuantity}});throw createError}stockItem.quantity=adjusted.quantity;await activity({module:'Inventory',action:'Stock adjustment',description:`${adjustmentType} of ${quantity} ${stockItem.unit} for ${stockItem.itemName}.`},req.auth.sub);res.status(201).json({adjustment,inventoryItem:stockItem})}catch(error){next(error)}}
export async function history(req,res,next){try{if(!isId(req.params.id))return fail(res,'Invalid inventory item.');const [purchases,usages,adjustments]=await Promise.all([Purchase.find({item:req.params.id}).sort({date:-1}).lean(),StockUsage.find({item:req.params.id}).sort({date:-1}).lean(),StockAdjustment.find({item:req.params.id}).sort({date:-1}).lean()]);res.json({history:[...purchases.map(x=>({...x,type:'Stock In',quantityPieces:x.quantityPieces,quantityKg:x.quantityKg,quantity:x.quantity??((x.quantityPieces||0)+(x.quantityKg||0)||undefined)})),...usages.map(x=>({...x,type:'Stock Out',quantity:x.quantityUsed})),...adjustments.map(x=>({...x,type:`Adjustment: ${x.adjustmentType}`,quantity:x.quantity}))].sort((a,b)=>new Date(b.date)-new Date(a.date))})}catch(error){next(error)}}

// UPGRADE: GET /api/inventory/alerts — low-stock, expiring-soon and expired items.
import { getInventoryAlerts } from '../services/inventoryAlertService.js'
export async function inventoryAlerts(req, res, next) {
  try {
    const days = req.query.days != null ? Number(req.query.days) : undefined
    res.json(await getInventoryAlerts(days != null && Number.isFinite(days) ? { expiryDays: days } : {}))
  } catch (error) { next(error) }
}

/* ===================== v3: WASTAGE & DAMAGE ===================== */
import { WastageRecord } from '../models/PlatformModels.js'
import { unitCostOf } from '../services/costService.js'
import { adjustStock, ensureMainBranch as ensureMainBranchSvc, resolveBranch, stockOf } from '../services/branchService.js'
const ensureMainBranch = ensureMainBranchSvc

/**
 * Record wastage/damage: stock is deducted atomically at the chosen branch
 * and the financial loss is valued at the item's current unit cost
 * (snapshotted, so later price changes never rewrite history).
 */
export async function createWastage(req, res, next) {
  try {
    const { date, item, quantity, reason, notes, branch } = req.body
    if (!date || !isId(item) || !Number.isFinite(number(quantity)) || number(quantity) <= 0 || !['Expired', 'Damaged', 'Spoiled', 'Spillage', 'Other'].includes(reason)) {
      return fail(res, 'Date, Item, positive Quantity, and a valid Reason (Expired/Damaged/Spoiled/Spillage/Other) are required.')
    }
    const stockItem = await InventoryItem.findById(item)
    if (!stockItem) return res.status(404).json({ message: 'Inventory item not found.' })
    const wastageBranch = await resolveBranch(branch)
    const main = await ensureMainBranch()
    const after = await adjustStock({ itemId: item, branch: wastageBranch, main, delta: -number(quantity) })
    if (after == null) return fail(res, `Insufficient stock at ${wastageBranch.name} for wastage: only ${await stockOf(item, wastageBranch, main)} available.`)
    const unitCost = await unitCostOf(stockItem)
    const record = await WastageRecord.create({
      date, item, branch: wastageBranch._id, quantity: number(quantity), reason,
      unitCost, lossAmount: Math.round(number(quantity) * unitCost * 100) / 100,
      notes: notes?.trim(), createdBy: req.auth.sub,
    }).catch(async (error) => { await adjustStock({ itemId: item, branch: wastageBranch, main, delta: number(quantity) }); throw error })
    await activity({ module: 'Inventory', action: 'Wastage recorded', description: `${record.wastageId}: ${quantity} ${stockItem.unit} of ${stockItem.itemName} written off (${reason}) at ${wastageBranch.name} — loss Rs ${record.lossAmount}.` }, req.auth.sub).catch(() => {})
    res.status(201).json({ wastage: record })
  } catch (error) { next(error) }
}
export async function listWastage(req, res, next) {
  try {
    const { fromDate = '', toDate = '', page = 1, limit = 25 } = req.query
    const filter = {}
    if (fromDate || toDate) filter.date = { ...(fromDate && { $gte: new Date(fromDate) }), ...(toDate && { $lte: new Date(`${toDate}T23:59:59.999Z`) }) }
    const [records, total, agg] = await Promise.all([
      WastageRecord.find(filter).populate('item', 'itemId itemName unit').populate('branch', 'code name').populate('createdBy', 'name').sort({ date: -1 }).skip((Number(page) - 1) * Number(limit)).limit(Number(limit)).lean(),
      WastageRecord.countDocuments(filter),
      WastageRecord.aggregate([{ $match: filter }, { $group: { _id: null, loss: { $sum: '$lossAmount' }, qty: { $sum: '$quantity' } } }]),
    ])
    res.json({ records, total, summary: { totalLoss: agg[0]?.loss || 0, totalQuantity: agg[0]?.qty || 0 } })
  } catch (error) { next(error) }
}
