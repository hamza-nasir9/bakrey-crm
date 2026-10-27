/**
 * File-download helpers for report exports.
 * The heavy lifting (querying, shaping, CSV/XLSX generation, audit-logging
 * the export itself) happens on the server at GET /api/reports/export —
 * these helpers just save the returned blob with the right filename.
 */
import api from './api.js'

const EXT = { csv: 'csv', xlsx: 'xlsx' }

/**
 * Download a business report as CSV or Excel.
 * @param {'Orders'|'Expenses'|'Attendance'|string} type  report type (Orders = Sales report)
 * @param {'csv'|'xlsx'} format
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
export async function downloadReport(type, format, from, to) {
  const { data } = await api.get('/reports/export', {
    params: { type, format, from, to },
    responseType: 'blob',
  })
  saveBlob(data, `${type.replaceAll(' ', '-')}-${from}-to-${to}.${EXT[format] || 'csv'}`)
}

/** Download the audit trail (current filters) as CSV. */
export async function downloadAuditLogs(params) {
  const { data } = await api.get('/audit-logs', { params: { ...params, format: 'csv' }, responseType: 'blob' })
  saveBlob(data, 'audit-logs.csv')
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** First and last day (YYYY-MM-DD) of the month containing `dateStr` (or today). */
export function monthRange(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date()
  const from = new Date(d.getFullYear(), d.getMonth(), 1)
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const ymd = (x) => x.toISOString().slice(0, 10)
  return { from: ymd(from), to: ymd(to) }
}
