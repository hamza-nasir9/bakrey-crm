import { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, CalendarPlus, Clock, FileText, LockKeyhole, Play, Search, X } from 'lucide-react'
import api from '../lib/api.js'
import './shifts.css'

const money = n => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0)
const fmt = d => d ? new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
// Separate, unambiguous Date ("YYYY-MM-DD") and Time ("HH:mm") input values —
// both natively guaranteed formats, unlike a combined datetime-local value
// which can degrade to free text (e.g. "09:00 AM") on some browsers/inputs
// and silently fail to parse. We build the actual Date from these numeric
// components ourselves instead of trusting new Date(combinedString).
const dateInput = d => { const x = d ? new Date(d) : new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const timeInput = d => { const x = d ? new Date(d) : new Date(); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}` }
// Combines a "YYYY-MM-DD" date and "HH:mm" time into a real Date built from
// numeric parts — never from parsing a single ambiguous string.
const combine = (dateStr, timeStr) => {
  const [y, m, d] = (dateStr || '').split('-').map(Number)
  const [h, mi] = (timeStr || '').split(':').map(Number)
  if (![y, m, d, h, mi].every(Number.isFinite)) return null
  return new Date(y, m - 1, d, h, mi)
}
const statusClass = { Scheduled: 'scheduled', Open: 'open', Closed: 'closed', Cancelled: 'cancelled' }

export default function Shifts({ user, logout }) {
  const [current, setCurrent] = useState(null)
  const [upcoming, setUpcoming] = useState(null)
  const [windowClosed, setWindowClosed] = useState(false)
  const [shifts, setShifts] = useState([])
  const [cashiers, setCashiers] = useState([])
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)
  const [close, setClose] = useState(false)
  const [schedule, setSchedule] = useState(null)
  const [search, setSearch] = useState('')
  const [report, setReport] = useState(null)
  const [reportError, setReportError] = useState('')

  const load = async () => {
    try {
      const currentResponse = await api.get('/shifts/current')
      setCurrent(currentResponse.data.shift)
      setUpcoming(currentResponse.data.upcoming)
      setWindowClosed(currentResponse.data.windowClosed)
      if (user.role === 'ADMIN') {
        const [list, users] = await Promise.all([api.get('/shifts', { params: { search } }), api.get('/users', { params: { status: 'active' } })])
        setShifts(list.data.shifts)
        setCashiers(users.data.users.filter(u => u.role === 'CASHIER'))
      } else {
        // Cashiers see only their own shift history — the API already scopes this server-side.
        const list = await api.get('/shifts')
        setShifts(list.data.shifts)
      }
      setError('')
    } catch (e) { setError(e.response?.data?.message || 'Unable to load shifts.') }
  }
  useEffect(() => { load() }, [search])

  const start = async e => {
    e.preventDefault()
    try { await api.post('/shifts/start', form); setForm(null); load() }
    catch (e) { setError(e.response?.data?.message || 'Could not start shift.') }
  }
  const end = async e => {
    e.preventDefault()
    try { await api.post('/shifts/close', close); setClose(false); load() }
    catch (e) { setError(e.response?.data?.message || 'Could not close shift.') }
  }
  const reopen = async id => {
    try { await api.post(`/shifts/${id}/reopen`); load() }
    catch (e) { setError(e.response?.data?.message || 'Could not reopen shift.') }
  }
  const saveSchedule = async e => {
    e.preventDefault()
    const start = combine(schedule.startDate, schedule.startClock)
    const end = combine(schedule.endDate, schedule.endClock)
    if (!start || !end) { setError('Please provide a valid Start Date/Time and End Date/Time.'); return }
    try {
      const payload = { cashier: schedule.cashier, shiftNumber: schedule.shiftNumber, startTime: start.toISOString(), endTime: end.toISOString(), notes: schedule.notes }
      if (schedule._id) await api.patch(`/shifts/${schedule._id}/schedule`, payload)
      else await api.post('/shifts/schedule', payload)
      setSchedule(null); load()
    } catch (e) { setError(e.response?.data?.message || 'Could not save shift schedule.') }
  }
  const cancelSchedule = async id => {
    if (!window.confirm('Cancel this scheduled shift?')) return
    try { await api.post(`/shifts/${id}/cancel-schedule`); load() }
    catch (e) { setError(e.response?.data?.message || 'Could not cancel shift.') }
  }
  const viewReport = async id => {
    setReport({ loading: true }); setReportError('')
    try { const { data } = await api.get(`/shifts/${id}/report`); setReport(data) }
    catch (e) { setReportError(e.response?.data?.message || 'Could not load shift report.'); setReport(null) }
  }

  return <div className="shift-page">
    <header><button onClick={() => history.back()}><ArrowLeft size={18} />Dashboard</button><div><b>AL KAUSAR BAKREY</b><span>Shift Management</span></div><button onClick={logout}>Sign out</button></header>
    <main>
      <div className="shift-title">
        <div><p>SHIFT MANAGEMENT</p><h1>{user.role === 'ADMIN' ? 'Cashier shifts' : 'My shift'}</h1><span>{user.role === 'ADMIN' ? 'Assign custom shift windows and reconcile cash collections.' : 'Your assigned shift, start/end time, and cash reconciliation.'}</span></div>
        {user.role === 'ADMIN'
          ? <button className="shift-primary" onClick={() => setSchedule({ cashier: cashiers[0]?._id || '', shiftNumber: '1', startDate: dateInput(), startClock: timeInput(), endDate: dateInput(new Date(Date.now() + 6 * 3600000)), endClock: timeInput(new Date(Date.now() + 6 * 3600000)), notes: '' })}><CalendarPlus size={16} />Schedule Shift</button>
          : !current ? <button className="shift-primary" disabled={!upcoming} onClick={() => setForm({ openingCash: '0', notes: '' })}><Play size={16} />Start Shift</button> : <button className="close-shift" onClick={() => setClose({ closingCash: '', notes: '' })}><LockKeyhole size={16} />End Shift</button>}
      </div>

      {error && <div className="shift-error"><AlertCircle size={18} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}

      {user.role !== 'ADMIN' && <section className="current-card">
        <p>{current ? 'ACTIVE SHIFT' : 'UPCOMING SHIFT'}</p>
        {current
          ? <><h2>{current.shiftId} · Shift {current.shiftNumber}</h2><div><span>Opening Cash <b>{money(current.openingCash)}</b></span><span>Started <b>{fmt(current.shiftStartTime)}</b></span><span>Status <b>Open</b></span>{current.scheduledEndTime && <span>Assigned Until <b>{fmt(current.scheduledEndTime)}</b></span>}</div>{windowClosed && <p className="shift-window-warning"><AlertCircle size={15} />Your assigned shift window has ended — please close out.</p>}<p style={{ marginTop: 12 }}><button className="report-link" onClick={() => viewReport(current._id)}><FileText size={14} />View Shift Report</button></p></>
          : upcoming
            ? <><h2>Shift {upcoming.shiftNumber}</h2><div><span><Clock size={14} /> {fmt(upcoming.scheduledStartTime)} – {fmt(upcoming.scheduledEndTime)}</span></div><p>You can start this shift once it reaches its assigned start time.</p></>
            : <p>No shift is currently assigned to you. Contact your Admin.</p>}
      </section>}

      {user.role === 'ADMIN' && <>
        <div className="shift-search"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shift or cashier" /></div>
        <section className="shift-table"><table><thead><tr><th>Shift ID</th><th>Cashier</th><th>Shift</th><th>Assigned Window</th><th>Opening</th><th>Collection</th><th>Closing</th><th>Difference</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {shifts.length ? shifts.map(s => <tr key={s._id}>
            <td><b>{s.shiftId}</b></td>
            <td>{s.cashier?.name}</td>
            <td>Shift {s.shiftNumber}</td>
            <td>{s.scheduledStartTime ? <>{fmt(s.scheduledStartTime)} → {fmt(s.scheduledEndTime)}</> : '—'}</td>
            <td>{s.openingCash === undefined ? '—' : money(s.openingCash)}</td>
            <td>{money(s.systemCashCollection)}</td>
            <td>{s.closingCash === undefined ? '—' : money(s.closingCash)}</td>
            <td>{money(s.cashDifference)}</td>
            <td><span className={statusClass[s.status] || ''}>{s.status}</span></td>
            <td>
              {s.status === 'Scheduled' && <><button onClick={() => setSchedule({ _id: s._id, cashier: s.cashier?._id, shiftNumber: s.shiftNumber, startDate: dateInput(s.scheduledStartTime), startClock: timeInput(s.scheduledStartTime), endDate: dateInput(s.scheduledEndTime), endClock: timeInput(s.scheduledEndTime), notes: s.notes || '' })}>Edit</button><button className="danger" onClick={() => cancelSchedule(s._id)}>Cancel</button></>}
              {s.status === 'Closed' && <button onClick={() => reopen(s._id)}>Reopen</button>}
              {(s.status === 'Open' || s.status === 'Closed') && <button onClick={() => viewReport(s._id)}><FileText size={13} />Report</button>}
            </td>
          </tr>) : <tr><td colSpan="10" className="empty">No shifts yet. Schedule a shift to begin.</td></tr>}
        </tbody></table></section>
      </>}

      {user.role !== 'ADMIN' && <section className="shift-table">
        <p className="dash-kicker" style={{ margin: '18px 0 8px' }}>MY SHIFT HISTORY</p>
        <table><thead><tr><th>Shift ID</th><th>Shift</th><th>Window</th><th>Opening</th><th>Closing</th><th>Difference</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {shifts.length ? shifts.map(s => <tr key={s._id}>
            <td><b>{s.shiftId}</b></td>
            <td>Shift {s.shiftNumber}</td>
            <td>{s.scheduledStartTime ? <>{fmt(s.scheduledStartTime)} → {fmt(s.scheduledEndTime)}</> : '—'}</td>
            <td>{s.openingCash === undefined ? '—' : money(s.openingCash)}</td>
            <td>{s.closingCash === undefined ? '—' : money(s.closingCash)}</td>
            <td>{money(s.cashDifference)}</td>
            <td><span className={statusClass[s.status] || ''}>{s.status}</span></td>
            <td>{(s.status === 'Open' || s.status === 'Closed') && <button onClick={() => viewReport(s._id)}><FileText size={13} />Report</button>}</td>
          </tr>) : <tr><td colSpan="8" className="empty">No shift history yet.</td></tr>}
        </tbody></table>
      </section>}
    </main>

    {form && <Modal title="Start Shift" close={() => setForm(null)}><form onSubmit={start} className="shift-form">
      {upcoming && <p className="shift-hint">Shift {upcoming.shiftNumber} · {fmt(upcoming.scheduledStartTime)} – {fmt(upcoming.scheduledEndTime)}</p>}
      <label>Opening Cash<input required min="0" type="number" value={form.openingCash} onChange={e => setForm({ ...form, openingCash: e.target.value })} /></label>
      <label>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
      <button className="shift-primary">Start Shift</button>
    </form></Modal>}

    {close && <Modal title="End Shift" close={() => setClose(false)}><form onSubmit={end} className="shift-form">
      <label>Closing Cash<input required min="0" type="number" value={close.closingCash} onChange={e => setClose({ ...close, closingCash: e.target.value })} /></label>
      <label>Remarks<textarea value={close.notes} onChange={e => setClose({ ...close, notes: e.target.value })} /></label>
      <button className="close-shift">Close & Reconcile</button>
    </form></Modal>}

    {schedule && <Modal title={schedule._id ? 'Edit Scheduled Shift' : 'Schedule Shift'} close={() => setSchedule(null)}><form onSubmit={saveSchedule} className="shift-form">
      <label>Cashier<select required disabled={Boolean(schedule._id)} value={schedule.cashier} onChange={e => setSchedule({ ...schedule, cashier: e.target.value })}><option value="">Select cashier</option>{cashiers.map(c => <option key={c._id} value={c._id}>{c.name} ({c.username})</option>)}</select></label>
      <label>Shift Number<input required min="1" type="number" value={schedule.shiftNumber} onChange={e => setSchedule({ ...schedule, shiftNumber: e.target.value })} /></label>
      <label>Start Date<input required type="date" value={schedule.startDate} onChange={e => setSchedule({ ...schedule, startDate: e.target.value })} /></label>
      <label>Start Time<input required type="time" value={schedule.startClock} onChange={e => setSchedule({ ...schedule, startClock: e.target.value })} /></label>
      <label>End Date<input required type="date" value={schedule.endDate} onChange={e => setSchedule({ ...schedule, endDate: e.target.value })} /></label>
      <label>End Time<input required type="time" value={schedule.endClock} onChange={e => setSchedule({ ...schedule, endClock: e.target.value })} /></label>
      <p className="shift-hint">For an overnight shift (e.g. 10:00 PM – 6:00 AM), set End Date to the next calendar day.</p>
      <label>Notes<textarea value={schedule.notes} onChange={e => setSchedule({ ...schedule, notes: e.target.value })} /></label>
      <button className="shift-primary">{schedule._id ? 'Save Changes' : 'Schedule Shift'}</button>
    </form></Modal>}

    {(report || reportError) && <Modal title="Shift Report" wide close={() => { setReport(null); setReportError('') }}>
      {reportError ? <p className="shift-report-error"><AlertCircle size={15} />{reportError}</p>
        : report.loading ? <p>Loading shift report…</p>
        : <ShiftReport data={report} />}
    </Modal>}
  </div>
}

function ShiftReport({ data }) {
  const { shift, incomingInventory, orders, payments, attendance, totals } = data
  return <div className="shift-report">
    <section>
      <h3>Shift Information</h3>
      <div className="shift-report-grid">
        <span>Cashier<b>{shift.cashier?.name}</b></span>
        <span>Shift Number<b>{shift.shiftNumber}</b></span>
        <span>Scheduled Window<b>{shift.scheduledStartTime ? <>{fmt(shift.scheduledStartTime)} → {fmt(shift.scheduledEndTime)}</> : '—'}</b></span>
        <span>Clock-In<b>{fmt(shift.shiftStartTime)}</b></span>
        <span>Clock-Out<b>{fmt(shift.shiftEndTime)}</b></span>
        <span>Opening Cash<b>{money(shift.openingCash)}</b></span>
        <span>Closing Cash<b>{shift.closingCash === undefined ? '—' : money(shift.closingCash)}</b></span>
        <span>Status<b>{shift.status}</b></span>
      </div>
    </section>

    <section>
      <h3>Incoming Inventory ({incomingInventory.length})</h3>
      {incomingInventory.length ? <table className="shift-report-table"><thead><tr><th>Item</th><th>Pieces</th><th>KG</th><th>Supplier</th><th>Amount</th><th>Date</th></tr></thead><tbody>
        {incomingInventory.map(p => <tr key={p._id}><td>{p.item?.itemName || '—'}</td><td>{p.quantityPieces || '—'}</td><td>{p.quantityKg || '—'}</td><td>{p.supplier?.name || '—'}</td><td>{money(p.totalPrice)}</td><td>{new Date(p.date).toLocaleDateString()}</td></tr>)}
      </tbody></table> : <p className="blank">No incoming stock recorded during this shift.</p>}
    </section>

    <section>
      <h3>Orders ({orders.length})</h3>
      {orders.length ? <table className="shift-report-table"><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Received</th><th>Pending</th><th>Method</th><th>Status</th></tr></thead><tbody>
        {orders.map(o => <tr key={o._id}><td>{o.orderId}</td><td>{o.customer?.name || '—'}</td><td>{money(o.totalAmount)}</td><td>{money(o.advancePaid)}</td><td>{money(o.remainingAmount)}</td><td>{o.paymentMethod}</td><td>{o.status}</td></tr>)}
      </tbody></table> : <p className="blank">No orders created during this shift.</p>}
    </section>

    <section>
      <h3>Payments ({payments.length})</h3>
      {payments.length ? <table className="shift-report-table"><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Method</th><th>Type</th></tr></thead><tbody>
        {payments.map(p => <tr key={p._id}><td>{p.order?.orderId || '—'}</td><td>{p.customer?.name || '—'}</td><td>{money(p.amount)}</td><td>{p.paymentMethod}</td><td>{p.paymentType}</td></tr>)}
      </tbody></table> : <p className="blank">No payments received during this shift.</p>}
    </section>

    <section>
      <h3>Attendance Marked ({attendance.length})</h3>
      {attendance.length ? <table className="shift-report-table"><thead><tr><th>Employee</th><th>Status</th><th>Check-In</th><th>Check-Out</th></tr></thead><tbody>
        {attendance.map(a => <tr key={a._id}><td>{a.employee?.name || '—'}</td><td>{a.status}</td><td>{a.checkInTime || '—'}</td><td>{a.checkOutTime || '—'}</td></tr>)}
      </tbody></table> : <p className="blank">No attendance marked during this shift.</p>}
    </section>

    <section>
      <h3>Shift Totals</h3>
      <div className="shift-report-grid">
        <span>Total Incoming Stock Amount<b>{money(totals.incomingStockAmount)}</b></span>
        <span>Incoming Stock Entries<b>{totals.incomingStockEntries}</b></span>
        <span>Total Order Value<b>{money(totals.orderValue)}</b></span>
        <span>Number of Orders<b>{totals.totalOrders}</b></span>
        <span>Total Payments Collected<b>{money(totals.paymentsCollected)}</b></span>
        <span>Opening Cash<b>{money(totals.openingCash)}</b></span>
        <span>Closing Cash<b>{totals.closingCash === undefined ? '—' : money(totals.closingCash)}</b></span>
        <span>Cash Variance<b>{money(totals.cashDifference)}</b></span>
      </div>
    </section>
  </div>
}

function Modal({ title, close, wide, children }) {
  return <div className="shift-back" onMouseDown={close}><section className={`shift-modal${wide ? ' wide' : ''}`} onMouseDown={e => e.stopPropagation()}><div><h2>{title}</h2><button onClick={close}><X /></button></div>{children}</section></div>
}
