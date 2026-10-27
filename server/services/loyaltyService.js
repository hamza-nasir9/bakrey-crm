/**
 * Loyalty points.
 * Rules (all configurable in env — see config/env.js):
 *   EARN    — for every LOYALTY_STEP_PKR (default Rs 100) actually PAID on a
 *             payment, the customer earns LOYALTY_POINTS_PER_STEP (default 1).
 *             Points are earned on money received, never on credit or on
 *             amounts paid with points themselves.
 *   REDEEM  — at order time, 1 point = LOYALTY_POINT_VALUE_PKR (default Rs 1)
 *             off the amount payable. Redemption is an atomic guarded
 *             decrement: the balance can never go negative or be double-spent
 *             by two simultaneous orders.
 * Every movement is recorded in LoyaltyTransaction with the running balance.
 */
import env from '../config/env.js'
import { Customer } from '../models/BusinessModels.js'
import { LoyaltyTransaction } from '../models/PlatformModels.js'

export const pointsForAmount = (amount) =>
  Math.floor(Math.max(0, Number(amount) || 0) / env.LOYALTY_STEP_PKR) * env.LOYALTY_POINTS_PER_STEP

export const valueOfPoints = (points) => Math.max(0, Math.floor(Number(points) || 0)) * env.LOYALTY_POINT_VALUE_PKR

/** Award points for a received (non-refund) payment. No-op for zero points. */
export async function earnOnPayment({ customerId, amount, orderId, paymentId, actor }) {
  const points = pointsForAmount(amount)
  if (!customerId || points <= 0) return null
  const customer = await Customer.findByIdAndUpdate(customerId, { $inc: { loyaltyPoints: points } }, { new: true }).select('loyaltyPoints')
  if (!customer) return null
  return LoyaltyTransaction.create({
    customer: customerId, type: 'EARN', points, balanceAfter: customer.loyaltyPoints,
    order: orderId, payment: paymentId, createdBy: actor, note: `Earned on payment of Rs ${amount}`,
  })
}

/** Reverse points earned by a payment that was voided (balance never below 0). */
export async function reverseEarnForPayment({ customerId, paymentId, actor }) {
  if (!customerId || !paymentId) return null
  const earn = await LoyaltyTransaction.findOne({ customer: customerId, payment: paymentId, type: 'EARN' }).lean()
  if (!earn) return null
  const customer = await Customer.findByIdAndUpdate(customerId, { $inc: { loyaltyPoints: -earn.points } }, { new: true }).select('loyaltyPoints')
  if (!customer) return null
  if (customer.loyaltyPoints < 0) {
    // Customer already spent the points — clamp at zero (business absorbs it,
    // the reversal row still records the full clawback attempt for audit).
    await Customer.updateOne({ _id: customerId }, { $set: { loyaltyPoints: 0 } })
    customer.loyaltyPoints = 0
  }
  return LoyaltyTransaction.create({
    customer: customerId, type: 'REVERSAL', points: -earn.points, balanceAfter: customer.loyaltyPoints,
    payment: paymentId, createdBy: actor, note: 'Payment voided — earned points reversed',
  })
}

/**
 * Redeem points against an order. Atomic: succeeds only if the balance
 * covers the request. Returns { points, discount, balanceAfter }.
 * Throws an Error with status 400 when the balance is insufficient.
 */
export async function redeemPoints({ customerId, points, actor }) {
  const wanted = Math.floor(Number(points) || 0)
  if (wanted <= 0) return { points: 0, discount: 0, balanceAfter: null }
  const customer = await Customer.findOneAndUpdate(
    { _id: customerId, loyaltyPoints: { $gte: wanted } },
    { $inc: { loyaltyPoints: -wanted } },
    { new: true },
  ).select('loyaltyPoints')
  if (!customer) {
    throw Object.assign(new Error('Customer does not have enough loyalty points for this redemption.'), { status: 400 })
  }
  const discount = valueOfPoints(wanted)
  await LoyaltyTransaction.create({
    customer: customerId, type: 'REDEEM', points: -wanted, balanceAfter: customer.loyaltyPoints,
    createdBy: actor, note: `Redeemed for Rs ${discount} discount`,
  })
  return { points: wanted, discount, balanceAfter: customer.loyaltyPoints }
}

/** Give redeemed points back (order creation failed after redemption, or the order was cancelled). */
export async function refundRedeemedPoints({ customerId, points, orderId, actor, reason }) {
  const pts = Math.floor(Number(points) || 0)
  if (!customerId || pts <= 0) return null
  const customer = await Customer.findByIdAndUpdate(customerId, { $inc: { loyaltyPoints: pts } }, { new: true }).select('loyaltyPoints')
  if (!customer) return null
  return LoyaltyTransaction.create({
    customer: customerId, type: 'ADJUSTMENT', points: pts, balanceAfter: customer.loyaltyPoints,
    order: orderId, createdBy: actor, note: reason || 'Redemption refunded',
  })
}

export default { pointsForAmount, valueOfPoints, earnOnPayment, reverseEarnForPayment, redeemPoints, refundRedeemedPoints }
