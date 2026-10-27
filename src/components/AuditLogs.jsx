/**
 * Audit Logs — staff activity tracking screen.
 * Data: GET /api/audit-logs (Admin/Manager only, enforced by the API).
 * Every row answers: WHO (staff + role), WHAT (module/action + plain-English
 * description, incl. old → new values for inventory edits), WHEN, and the
 * amount involved where relevant. Filters + CSV export included.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, Download, Search, X } from 'lucide-react'
import api from '../lib/api.js'
import { downloadAuditLogs } from '../lib/download.js'
import './auditLogs.css'

const fmtWhen = (d) => new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
const money = (n) => (n == null ? '—' : new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n))

export default function AuditLogs({ user, logout }) {
  const [logs, setLogs] = useState([])
  const [options, setOptions] = useState({ modules: [], actors: [] })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ module: '', actor: '', search: '', from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const limit = 25

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/audit-logs', { params: { ...filters, page, limit } })
      setLogs(data.logs); setTotal(data.total); setError('')
    } catch (e) { setError(e.response?.data?.message || 'Unable to load audit logs.') }
    finally { setLoading(false) }
  }
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [filters, page])
  useEffect(() => { api.get('/audit-logs/options').then(({ data }) => setOptions(data)).catch(() => {}) }, [])

  const set = (key) => (e) => { setPage(1); setFilters((f) => ({ ...f, [key]: e.target.value })) }
  const pages = Math.max(1, Math.ceil(total / limit))

  const exportCsv = async () => {
    try { await downloadAuditLogs({ ...filters }) }
    catch { setError('Export failed. Please try again.') }
  }

  return (
    <div className="audit-page">
      <header>
        <button onClick={() => history.back()}><ArrowLeft size={18} />Dashboard</button>
        <div><b>AL KAUSAR BAKREY</b><span>Audit Logs</span></div>
        <button onClick={logout}>Sign out</button>
      </header>
      <main>
        <div className="audit-title">
          <div>
            <p>STAFF ACTIVITY TRACKING</p>
            <h1>Audit Logs</h1>
            <span>Who changed stock, updated a price, or cancelled a bill — and when. {total} record{total === 1 ? '' : 's'} found.</span>
          </div>
          <button className="audit-primary" onClick={exportCsv}><Download size={16} />Export CSV</button>
        </div>

        <div className="audit-tools">
          <label><Search size={16} /><input value={filters.search} onChange={set('search')} placeholder="Search action or description…" /></label>
          <select value={filters.module} onChange={set('module')} aria-label="Module">
            <option value="">All Modules</option>
            {options.modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={filters.actor} onChange={set('actor')} aria-label="Staff member">
            <option value="">All Staff</option>
            {options.actors.map((a) => <option key={a._id} value={a._id}>{a.name} ({a.role})</option>)}
          </select>
          <input type="date" value={filters.from} onChange={set('from')} aria-label="From date" />
          <input type="date" value={filters.to} onChange={set('to')} aria-label="To date" />
        </div>

        {error && <div className="audit-error"><AlertCircle size={17} />{error}<button onClick={() => setError('')}><X size={14} /></button></div>}

        <section className="audit-table">
          {loading ? <p>Loading audit logs…</p> : logs.length === 0 ? <p>No activity matches these filters yet.</p> : (
            <table>
              <thead><tr><th>When</th><th>Staff</th><th>Module</th><th>Action</th><th>Details</th><th>Amount</th></tr></thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td data-label="When">{fmtWhen(log.occurredAt)}</td>
                    <td data-label="Staff">
                      <b>{log.actor?.name || 'System'}</b>
                      {log.actor && <small>{log.actor.username} · {log.actor.role}</small>}
                    </td>
                    <td data-label="Module"><span className="audit-chip">{log.module}</span></td>
                    <td data-label="Action">{log.action}</td>
                    <td data-label="Details">{log.description}</td>
                    <td data-label="Amount">{money(log.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="audit-pager">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
        <p className="audit-note">Signed in as {user.name} ({user.role}). Audit records are written automatically by the system and cannot be edited from this screen.</p>
      </main>
    </div>
  )
}
