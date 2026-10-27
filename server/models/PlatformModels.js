/**
 * Platform models added in v3.0 — multi-branch, customer ledger & loyalty,
 * recipes (BOM), wastage, and notification delivery logs.
 * Kept in their own file so the original BusinessModels stay untouched
 * apart from a few additive fields (branch tags, credit limit, points).
 */
import mongoose from 'mongoose'

const { Schema, model } = mongoose
const timestamped = { timestamps: true, versionKey: false }

/* ------------------------------ Branches ------------------------------ */

const branchSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ['BRANCH', 'WAREHOUSE'], default: 'BRANCH' },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    isMain: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  timestamped,
)
export const Branch = model('Branch', branchSchema)

/**
 * Stock held at a NON-main location. The main branch's stock stays in
 * InventoryItem.quantity (the long-standing system of record) so every
 * existing flow keeps working; BranchStock rows exist for other branches.
 */
const branchStockSchema = new Schema(
  {
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    item: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    quantity: { type: Number, default: 0, min: 0 },
  },
  timestamped,
)
branchStockSchema.index({ branch: 1, item: 1 }, { unique: true })
export const BranchStock = model('BranchStock', branchStockSchema)

const stockTransferSchema = new Schema(
  {
    transferId: { type: String, unique: true, index: true },
    fromBranch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    toBranch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    item: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    quantity: { type: Number, required: true, min: 0.001 },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  timestamped,
)
stockTransferSchema.pre('validate', async function () {
  if (!this.isNew || this.transferId) return
  const Counter = mongoose.models.Counter
  const counter = await Counter.findOneAndUpdate({ key: 'transferId' }, { $inc: { sequence: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true })
  this.transferId = `AKT-${String(counter.sequence).padStart(6, '0')}`
})
export const StockTransfer = model('StockTransfer', stockTransferSchema)

/* ------------------------- Customer ledger ---------------------------- */

/**
 * One row per money movement against a customer's account (udhar khata).
 * `amount` is the signed effect on what the customer OWES:
 *   ORDER_CHARGE + · PAYMENT − · REFUND + · CANCEL_REVERSAL − · ADJUSTMENT ±
 * `balanceAfter` is the customer's outstanding balance right after the entry.
 */
const ledgerSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: { type: String, enum: ['ORDER_CHARGE', 'PAYMENT', 'REFUND', 'CANCEL_REVERSAL', 'ADJUSTMENT'], required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    occurredAt: { type: Date, default: Date.now },
  },
  timestamped,
)
export const CustomerLedgerEntry = model('CustomerLedgerEntry', ledgerSchema)

/* ------------------------------ Loyalty ------------------------------- */

/** Points movements; Customer.loyaltyPoints holds the current balance. */
const loyaltySchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: { type: String, enum: ['EARN', 'REDEEM', 'REVERSAL', 'ADJUSTMENT'], required: true },
    points: { type: Number, required: true }, // signed: EARN +, REDEEM −
    balanceAfter: { type: Number, required: true, min: 0 },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    occurredAt: { type: Date, default: Date.now },
  },
  timestamped,
)
export const LoyaltyTransaction = model('LoyaltyTransaction', loyaltySchema)

/* --------------------------- Recipes (BOM) ---------------------------- */

/**
 * A recipe turns raw-material stock into a sellable item.
 * deductMode:
 *   INGREDIENTS — selling the output deducts the ingredients (made-to-order)
 *   BOTH        — deducts the finished item AND the ingredients
 *   FINISHED    — no BOM behaviour (normal finished-stock deduction)
 * Ingredient quantities are per ONE unit of output.
 */
const recipeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    outputItem: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, unique: true },
    deductMode: { type: String, enum: ['INGREDIENTS', 'BOTH', 'FINISHED'], default: 'INGREDIENTS' },
    ingredients: [
      {
        item: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
        quantity: { type: Number, required: true, min: 0.0001 }, // per 1 unit of output
        _id: false,
      },
    ],
    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  timestamped,
)
export const Recipe = model('Recipe', recipeSchema)

/* ------------------------------ Wastage ------------------------------- */

const wastageSchema = new Schema(
  {
    wastageId: { type: String, unique: true, index: true },
    date: { type: Date, required: true },
    item: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    quantity: { type: Number, required: true, min: 0.001 },
    reason: { type: String, enum: ['Expired', 'Damaged', 'Spoiled', 'Spillage', 'Other'], required: true },
    unitCost: { type: Number, required: true, min: 0 }, // snapshot at time of loss
    lossAmount: { type: Number, required: true, min: 0 }, // quantity × unitCost
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  timestamped,
)
wastageSchema.pre('validate', async function () {
  if (!this.isNew || this.wastageId) return
  const Counter = mongoose.models.Counter
  const counter = await Counter.findOneAndUpdate({ key: 'wastageId' }, { $inc: { sequence: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true })
  this.wastageId = `AKW-${String(counter.sequence).padStart(6, '0')}`
})
export const WastageRecord = model('WastageRecord', wastageSchema)

/* --------------------------- Notifications ---------------------------- */

/** Delivery log for every outbound WhatsApp/SMS/email attempt. */
const notificationLogSchema = new Schema(
  {
    channel: { type: String, enum: ['whatsapp', 'sms', 'email'], required: true },
    provider: { type: String, default: 'none' },
    to: { type: String, trim: true },
    template: { type: String, trim: true }, // 'invoice' | 'alert-digest' | 'manual' …
    body: { type: String, required: true },
    status: { type: String, enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
    error: { type: String, trim: true },
    ref: { type: String, trim: true }, // related order id etc.
    occurredAt: { type: Date, default: Date.now },
  },
  timestamped,
)
export const NotificationLog = model('NotificationLog', notificationLogSchema)
