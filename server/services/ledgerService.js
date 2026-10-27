/**
 * Customer ledger (udhar khata).
 * Customer.pendingBalance remains the live balance used across the app; the
 * ledger is the immutable, itemised trail behind it. Callers pass the
 * running balance explicitly (they know the sequence of movements inside
 * one operation), and every entry also snapshots it as `balanceAfter`.
 */
import { CustomerLedgerEntry } from '../models/PlatformModels.js'

/**
 * @param {string} customerId
 * @param {{type:string, amount:number, balanceAfter:number, order?:string, payment?:string, note?:string, actor?:string}} entry
 * amount = signed effect on what the customer owes (+ charge, − payment).
 */
export async function appendLedgerEntry(customerId, entry) {
  if (!customerId || !entry?.type || !Number.isFinite(Number(entry.amount))) return null
  return CustomerLedgerEntry.create({
    customer: customerId,
    type: entry.type,
    amount: Number(entry.amount),
    balanceAfter: Number(entry.balanceAfter) || 0,
    order: entry.order,
    payment: entry.payment,
    note: entry.note,
    createdBy: entry.actor,
  })
}

/** Convenience runner: keeps a running balance across several entries in one operation. */
export function ledgerRunner(startingBalance) {
  let balance = Number(startingBalance) || 0
  return {
    async add(customerId, entry) {
      balance += Number(entry.amount) || 0
      const saved = await appendLedgerEntry(customerId, { ...entry, balanceAfter: balance })
      return saved
    },
    get balance() { return balance },
  }
}

export default appendLedgerEntry
