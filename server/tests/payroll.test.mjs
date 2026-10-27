/**
 * Unit tests for the payroll attendance maths (pure function — no DB needed).
 * Run:  node --test server/tests/
 * Env vars are set before importing the service because config/env.js
 * validates the environment at import time (by design).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/bakrey_test'
process.env.JWT_SECRET ||= 'test-secret-at-least-sixteen-chars'
process.env.LATE_TO_ABSENT_RATIO ||= '3'

const { summariseAttendance } = await import('../services/payrollService.js')

const rows = (status, n, overtimeHours = 0) => Array.from({ length: n }, () => ({ status, overtimeHours }))

test('present + half days accumulate payable days', () => {
  const s = summariseAttendance([...rows('Present', 20), ...rows('Half Day', 2)])
  assert.equal(s.payableDays, 21)
})

test('absent and leave days are not payable', () => {
  const s = summariseAttendance([...rows('Present', 10), ...rows('Absent', 3), ...rows('Leave', 2)])
  assert.equal(s.payableDays, 10)
})

test('every 3 lates deduct one payable day', () => {
  const s = summariseAttendance(rows('Late', 7))
  assert.equal(s.lateDeductionDays, 2)
  assert.equal(s.payableDays, 5)
})

test('overtime hours are summed across rows', () => {
  const s = summariseAttendance([...rows('Present', 2, 1.5), ...rows('Late', 1, 2)])
  assert.equal(s.overtimeHours, 5)
})
