import mongoose from 'mongoose'
import { ActivityLog, Attendance, Order, Payment, Purchase, Shift } from '../models/BusinessModels.js'
import User from '../models/User.js'
import { activeShift, calculateShift, isWithinWindow, overlappingSchedule, upcomingShift } from '../services/shiftService.js'
const id = x => mongoose.isValidObjectId(x)
const num = x => Number(x)
const fail = (res, message) => res.status(400).json({ message })
const log = (data, actor) => ActivityLog.create({ ...data, actor })

// Cashier-facing: current open shift (if any) plus the nearest upcoming
// assignment, so a cashier can see their schedule before it starts.
export async function currentShift(req, res, next) {
  try {
    const [shift, upcoming] = await Promise.all([activeShift(req.auth.sub), upcomingShift(req.auth.sub)])
    res.json({ shift, upcoming, windowClosed: shift ? !isWithinWindow(shift) : false })
  } catch (error) { next(error) }
}

export async function listShifts(req, res, next) {
  try {
    const { search = '', status = '', cashier = '', fromDate = '', toDate = '' } = req.query
    const filter = {}
    if (status) filter.status = status
    if (id(cashier)) filter.cashier = cashier
    // Cashiers only ever see their own shift history, regardless of any cashier filter they send.
    if (req.auth.role === 'CASHIER') filter.cashier = req.auth.sub
    if (fromDate || toDate) {
      const range = { ...(fromDate && { $gte: new Date(fromDate) }), ...(toDate && { $lte: new Date(`${toDate}T23:59:59.999Z`) }) }
      filter.$or = [{ shiftStartTime: range }, { scheduledStartTime: range }]
    }
    const rows = await Shift.find(filter).populate('cashier', 'name username').populate('assignedBy', 'name').sort({ scheduledStartTime: -1, shiftStartTime: -1, createdAt: -1 }).lean()
    const shifts = search ? rows.filter(x => `${x.shiftId} ${x.cashier?.name} ${x.cashier?.username}`.toLowerCase().includes(search.toLowerCase())) : rows
    res.json({ shifts })
  } catch (error) { next(error) }
}

// ADMIN: assign a cashier to a fully custom shift window — any shift number,
// any date, any start/end time. No hard-coded schedule.
export async function scheduleShift(req, res, next) {
  try {
    const { cashier, shiftNumber, startTime, endTime, notes = '' } = req.body
    if (!id(cashier)) return fail(res, 'A valid cashier must be selected.')
    if (!Number.isInteger(num(shiftNumber)) || num(shiftNumber) < 1) return fail(res, 'A valid Shift Number is required.')
    if (!startTime || !endTime) return fail(res, 'Start Time and End Time are required.')
    const start = new Date(startTime), end = new Date(endTime)
    // Validate that these actually parsed into real instants before comparing
    // them — a Date built from an unparsable string (e.g. a bare "09:00 AM"
    // with no date) becomes Invalid Date, and Invalid Date < Invalid Date is
    // always false, which used to fall straight into the "End Time must be
    // after Start Time" message even though the real problem was invalid
    // input. Reporting that separately avoids the misleading error.
    if (Number.isNaN(start.getTime())) return fail(res, 'Start Time is not a valid date/time.')
    if (Number.isNaN(end.getTime())) return fail(res, 'End Time is not a valid date/time.')
    // Compare the actual millisecond instants, not the Date objects/strings.
    if (end.getTime() <= start.getTime()) return fail(res, 'End Time must be after Start Time.')
    const cashierUser = await User.findOne({ _id: cashier, role: 'CASHIER', isActive: true })
    if (!cashierUser) return fail(res, 'Selected user is not an active cashier.')
    if (await overlappingSchedule(cashier, start, end)) return fail(res, 'This cashier already has an overlapping shift scheduled.')
    const shift = await Shift.create({ cashier, shiftNumber: num(shiftNumber), scheduledDate: start, scheduledStartTime: start, scheduledEndTime: end, notes: notes.trim(), status: 'Scheduled', assignedBy: req.auth.sub, createdBy: req.auth.sub })
    await log({ module: 'Shifts', action: 'Shift scheduled', description: `${shift.shiftId} · Shift ${shift.shiftNumber} scheduled for ${cashierUser.name}.` }, req.auth.sub)
    res.status(201).json({ shift })
  } catch (error) { next(error) }
}

// ADMIN: edit a shift that hasn't started yet.
export async function updateSchedule(req, res, next) {
  try {
    if (!id(req.params.id)) return fail(res, 'Invalid shift.')
    const shift = await Shift.findById(req.params.id)
    if (!shift) return res.status(404).json({ message: 'Shift not found.' })
    if (shift.status !== 'Scheduled') return fail(res, 'Only a shift that has not started yet can be edited.')
    const { shiftNumber, startTime, endTime, notes } = req.body
    const start = startTime ? new Date(startTime) : shift.scheduledStartTime
    const end = endTime ? new Date(endTime) : shift.scheduledEndTime
    if (Number.isNaN(start?.getTime?.())) return fail(res, 'Start Time is not a valid date/time.')
    if (Number.isNaN(end?.getTime?.())) return fail(res, 'End Time is not a valid date/time.')
    if (end.getTime() <= start.getTime()) return fail(res, 'End Time must be after Start Time.')
    if (await overlappingSchedule(shift.cashier, start, end, shift._id)) return fail(res, 'This cashier already has an overlapping shift scheduled.')
    if (shiftNumber) shift.shiftNumber = num(shiftNumber)
    shift.scheduledStartTime = start; shift.scheduledEndTime = end; shift.scheduledDate = start
    if (notes !== undefined) shift.notes = notes.trim()
    await shift.save()
    await log({ module: 'Shifts', action: 'Shift schedule updated', description: `${shift.shiftId} schedule was updated.` }, req.auth.sub)
    res.json({ shift })
  } catch (error) { next(error) }
}

// ADMIN: cancel a shift that hasn't started yet. Kept (not deleted) so the
// Scheduled → Cancelled transition stays in the audit trail.
export async function cancelSchedule(req, res, next) {
  try {
    if (!id(req.params.id)) return fail(res, 'Invalid shift.')
    const shift = await Shift.findById(req.params.id)
    if (!shift) return res.status(404).json({ message: 'Shift not found.' })
    if (shift.status !== 'Scheduled') return fail(res, 'Only a shift that has not started yet can be cancelled.')
    shift.status = 'Cancelled'
    await shift.save()
    await log({ module: 'Shifts', action: 'Shift schedule cancelled', description: `${shift.shiftId} schedule was cancelled.` }, req.auth.sub)
    res.json({ shift })
  } catch (error) { next(error) }
}

// CASHIER: start the shift that is currently scheduled for them. They can no
// longer invent a shift number/time — that now comes from the Admin's
// assignment, and this only succeeds inside the assigned window.
export async function startShift(req, res, next) {
  try {
    const { openingCash, notes = '' } = req.body
    if (!Number.isFinite(num(openingCash)) || num(openingCash) < 0) return fail(res, 'Non-negative Opening Cash is required.')
    const existing = await activeShift(req.auth.sub)
    if (existing) return fail(res, 'Cashier already has an active shift.')
    const now = new Date()
    const scheduled = await Shift.findOne({ cashier: req.auth.sub, status: 'Scheduled', scheduledStartTime: { $lte: now }, scheduledEndTime: { $gte: now } })
    if (!scheduled) {
      const next = await upcomingShift(req.auth.sub)
      if (next) return res.status(400).json({ message: `Your next shift (Shift ${next.shiftNumber}) has not started yet.`, nextShift: next })
      return fail(res, 'No shift is currently scheduled for you. Contact your Admin.')
    }
    scheduled.status = 'Open'
    scheduled.shiftStartTime = now
    scheduled.openingCash = num(openingCash)
    scheduled.notes = notes.trim() || scheduled.notes
    await scheduled.save()
    await log({ module: 'Shifts', action: 'Shift started', description: `${scheduled.shiftId} · Shift ${scheduled.shiftNumber} started.`, amount: scheduled.openingCash }, req.auth.sub)
    res.status(201).json({ shift: scheduled })
  } catch (error) { if (error.code === 11000) return fail(res, 'Cashier already has an active shift.'); next(error) }
}

export async function closeShift(req, res, next) {
  try {
    const { closingCash, notes = '' } = req.body
    if (!Number.isFinite(num(closingCash)) || num(closingCash) < 0) return fail(res, 'Non-negative Closing Cash is required.')
    const shift = await activeShift(req.auth.sub)
    if (!shift) return res.status(404).json({ message: 'No active shift found.' })
    shift.shiftEndTime = new Date()
    Object.assign(shift, await calculateShift(shift))
    shift.closingCash = num(closingCash)
    shift.cashDifference = shift.closingCash - shift.expectedCash
    shift.notes = notes.trim() || shift.notes
    shift.status = 'Closed'
    await shift.save()
    await log({ module: 'Shifts', action: 'Shift closed', description: `${shift.shiftId} closed with a cash difference of ${shift.cashDifference}.`, amount: shift.systemCashCollection }, req.auth.sub)
    res.json({ shift })
  } catch (error) { next(error) }
}

export async function shiftDetails(req, res, next) {
  try {
    if (!id(req.params.id)) return fail(res, 'Invalid shift.')
    const shift = await Shift.findById(req.params.id).populate('cashier', 'name username').populate('assignedBy', 'name').lean()
    if (!shift) return res.status(404).json({ message: 'Shift not found.' })
    res.json({ shift })
  } catch (error) { next(error) }
}

export async function reopenShift(req, res, next) {
  try {
    if (!id(req.params.id)) return fail(res, 'Invalid shift.')
    const shift = await Shift.findById(req.params.id)
    if (!shift) return res.status(404).json({ message: 'Shift not found.' })
    if (shift.status === 'Open') return fail(res, 'Shift is already open.')
    if (shift.status !== 'Closed') return fail(res, 'Only a closed shift can be reopened.')
    if (await activeShift(shift.cashier)) return fail(res, 'Cashier already has another active shift.')
    shift.status = 'Open'
    shift.shiftEndTime = undefined
    shift.reopenedAt = new Date()
    await shift.save()
    await log({ module: 'Shifts', action: 'Shift reopened', description: `${shift.shiftId} was reopened by Admin.` }, req.auth.sub)
    res.json({ shift })
  } catch (error) { next(error) }
}

// Complete detail for ONE shift: the cashier who worked it may view only
// their own (ownership enforced below); Admin may view any shift. This is
// deliberately scoped to a single shift — it never aggregates across shifts
// or cashiers, so it can never leak another cashier's activity or
// business-wide totals to a CASHIER caller.
export async function shiftReport(req, res, next) {
  try {
    if (!id(req.params.id)) return fail(res, 'Invalid shift.')
    const shift = await Shift.findById(req.params.id).populate('cashier', 'name username').populate('assignedBy', 'name').lean()
    if (!shift) return res.status(404).json({ message: 'Shift not found.' })
    if (req.auth.role === 'CASHIER' && shift.cashier?._id?.toString() !== req.auth.sub) return res.status(403).json({ message: 'You can only view your own shift report.' })

    const [incomingInventory, orders, payments, attendance] = await Promise.all([
      Purchase.find({ shift: shift._id }).populate('item', 'itemName itemId unit').populate('supplier', 'name companyName').sort({ createdAt: 1 }).lean(),
      Order.find({ shift: shift._id }).populate('customer', 'name phone').sort({ createdAt: 1 }).lean(),
      Payment.find({ shift: shift._id, isVoided: false }).populate('customer', 'name phone').populate('order', 'orderId').sort({ createdAt: 1 }).lean(),
      Attendance.find({ shift: shift._id }).populate('employee', 'name employeeId position').sort({ createdAt: 1 }).lean(),
    ])

    const totals = {
      incomingStockAmount: incomingInventory.reduce((sum, p) => sum + (p.totalPrice || 0), 0),
      incomingStockEntries: incomingInventory.length,
      orderValue: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
      totalOrders: orders.length,
      paymentsCollected: payments.reduce((sum, p) => sum + (p.paymentType === 'Refund' ? -p.amount : p.amount), 0),
      openingCash: shift.openingCash,
      closingCash: shift.closingCash,
      cashDifference: shift.cashDifference,
    }

    res.json({ shift, incomingInventory, orders, payments, attendance, totals })
  } catch (error) { next(error) }
}
