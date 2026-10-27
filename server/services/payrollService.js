/**
 * Payroll calculation — extracted from salaryController so the maths is
 * testable in isolation and used identically by preview + create.
 *
 * BUGS FIXED vs. the original implementation
 * -------------------------------------------
 * 1. Monthly staff were paid the FULL monthlySalary no matter how many
 *    days they were absent. Now monthly pay is pro-rated:
 *        base = monthlySalary × payableDays / periodDays
 * 2. Overtime pay was a free-typed amount unrelated to recorded overtime
 *    hours. Now, unless an explicit override is supplied, it is computed:
 *        overtimePay = overtimeHours × (dailySalary / 8) × OVERTIME_MULTIPLIER
 * 3. There was no "Late" attendance status. Late now counts as a worked
 *    day, but every `LATE_TO_ABSENT_RATIO` lates (default 3) deducts 1 day.
 *
 * PAY POLICY (change here, in one place)
 *   Present = 1 day · Late = 1 day (minus late deductions) · Half Day = 0.5
 *   Absent = 0 · Leave = 0 (unpaid leave — flip to 1 if your policy is paid leave)
 */
import env from '../config/env.js'
import { Attendance, Employee } from '../models/BusinessModels.js'

const dayStart = (x) => {
  const d = new Date(x)
  d.setHours(0, 0, 0, 0)
  return d
}
const num = (x) => Number(x)
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100

export function summariseAttendance(rows) {
  const snapshot = {
    presentDays: 0, absentDays: 0, leaveDays: 0, halfDays: 0,
    lateDays: 0, lateDeductionDays: 0, overtimeHours: 0,
  }
  for (const row of rows) {
    if (row.status === 'Present') snapshot.presentDays += 1
    else if (row.status === 'Absent') snapshot.absentDays += 1
    else if (row.status === 'Leave') snapshot.leaveDays += 1
    else if (row.status === 'Half Day') snapshot.halfDays += 1
    else if (row.status === 'Late') snapshot.lateDays += 1
    snapshot.overtimeHours += row.overtimeHours || 0
  }
  snapshot.lateDeductionDays = Math.floor(snapshot.lateDays / env.LATE_TO_ABSENT_RATIO)
  snapshot.payableDays =
    snapshot.presentDays + snapshot.lateDays + snapshot.halfDays * 0.5 - snapshot.lateDeductionDays
  return snapshot
}

/**
 * @param {{employee:string, period:'Daily'|'Weekly'|'Monthly', periodStart:string, periodEnd:string,
 *          bonus?:number, deduction?:number, overtimeAmount?:number}} input
 * `overtimeAmount` is an optional manual override (e.g. a negotiated flat rate);
 * when omitted it is auto-computed from recorded overtime hours.
 */
export async function calculatePayroll(input) {
  const { employee, period, periodStart, periodEnd, bonus = 0, deduction = 0, overtimeAmount } = input

  if (!['Daily', 'Weekly', 'Monthly'].includes(period) || !periodStart || !periodEnd) {
    throw Object.assign(new Error('Valid Salary Period, Period Start, and Period End are required.'), { status: 400 })
  }
  if (dayStart(periodEnd) < dayStart(periodStart)) {
    throw Object.assign(new Error('Period End cannot be before Period Start.'), { status: 400 })
  }
  for (const [label, v] of [['Bonus', bonus], ['Deduction', deduction]]) {
    if (!Number.isFinite(num(v)) || num(v) < 0) {
      throw Object.assign(new Error(`${label} must be zero or greater.`), { status: 400 })
    }
  }

  const person = await Employee.findOne({ _id: employee, status: 'Active' })
  if (!person) throw Object.assign(new Error('Active employee not found.'), { status: 400 })

  const rows = await Attendance.find({
    employee,
    attendanceDate: { $gte: dayStart(periodStart), $lte: new Date(`${periodEnd}T23:59:59.999Z`) },
    isActive: true,
  }).lean()

  const snapshot = summariseAttendance(rows)
  const periodDays = Math.round((dayStart(periodEnd) - dayStart(periodStart)) / 86_400_000) + 1
  snapshot.periodDays = periodDays

  // --- Base pay -------------------------------------------------------------
  let base
  if (period === 'Monthly' && person.monthlySalary != null) {
    base = periodDays > 0 ? (person.monthlySalary * snapshot.payableDays) / periodDays : 0
  } else {
    base = snapshot.payableDays * person.dailySalary
  }

  // --- Overtime ---------------------------------------------------------------
  const hourlyRate = person.dailySalary / 8
  const autoOvertime = snapshot.overtimeHours * hourlyRate * env.OVERTIME_MULTIPLIER
  const overtimePay = overtimeAmount == null || overtimeAmount === '' ? autoOvertime : num(overtimeAmount)
  if (!Number.isFinite(overtimePay) || overtimePay < 0) {
    throw Object.assign(new Error('Overtime Amount must be zero or greater.'), { status: 400 })
  }

  const grossSalary = round2(base + overtimePay + num(bonus))
  const netSalary = round2(Math.max(0, grossSalary - num(deduction)))

  return {
    person, snapshot, periodDays,
    baseSalary: round2(base),
    overtimeAmount: round2(overtimePay),
    overtimeAutoCalculated: overtimeAmount == null || overtimeAmount === '',
    grossSalary, netSalary,
  }
}

export default calculatePayroll
