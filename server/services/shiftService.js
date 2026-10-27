import { Order, Payment, Shift } from '../models/BusinessModels.js'
export async function activeShift(cashier){return Shift.findOne({cashier,status:'Open'})}
export async function calculateShift(shift){const start=shift.shiftStartTime,end=shift.shiftEndTime||new Date();const window={ $gte:start,$lte:end };const [orders,payments]=await Promise.all([Order.countDocuments({createdBy:shift.cashier,bookingDate:window,status:{$ne:'Cancelled'}}),Payment.aggregate([{$match:{receivedBy:shift.cashier,date:window,isVoided:false,paymentMethod:'Cash'}},{$group:{_id:null,total:{$sum:'$amount'}}}])]);const systemCashCollection=payments[0]?.total||0;return {totalOrders:orders,totalPayments:systemCashCollection,systemCashCollection,expectedCash:shift.openingCash+systemCashCollection}}

// A shift created before admin-controlled scheduling existed has no
// scheduledEndTime — treat those as always-operational so nothing already
// in production breaks. Newly scheduled shifts must stay inside their window.
export function isWithinWindow(shift, now = new Date()) {
  if (!shift) return false
  if (!shift.scheduledStartTime && !shift.scheduledEndTime) return true
  if (shift.scheduledStartTime && now < shift.scheduledStartTime) return false
  if (shift.scheduledEndTime && now > shift.scheduledEndTime) return false
  return true
}

// The shift a cashier is actually allowed to transact against right now —
// used to gate order/payment creation. Different from activeShift(), which
// is used for display (e.g. "you still have an open shift to close").
export async function operationalShift(cashier) {
  const shift = await activeShift(cashier)
  return shift && isWithinWindow(shift) ? shift : null
}

// The cashier's nearest not-yet-started assignment, so they can see it
// before their shift begins.
export async function upcomingShift(cashier) {
  return Shift.findOne({ cashier, status: 'Scheduled', scheduledEndTime: { $gte: new Date() } }).sort({ scheduledStartTime: 1 })
}

export async function overlappingSchedule(cashier, start, end, excludeId) {
  return Shift.findOne({
    cashier,
    status: { $in: ['Scheduled', 'Open'] },
    ...(excludeId && { _id: { $ne: excludeId } }),
    scheduledStartTime: { $lt: end },
    scheduledEndTime: { $gt: start },
  })
}
