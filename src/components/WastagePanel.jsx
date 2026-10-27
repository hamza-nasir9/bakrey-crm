import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import api from '../lib/api.js'

const money = (n) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0)
const today = new Date().toISOString().slice(0, 10)
const monthStart = today.slice(0, 8) + '01'

/**
 * Wastage & damage write-offs (v3) — mounted on the Inventory page.
 * Recording wastage deducts stock immediately and values the loss at the
 * item's current unit cost, so the financial damage is always visible.
 */
export default function WastagePanel() {
  const [records, setRecords] = useState([])
  const [summary, setSummary] = useState({ totalLoss: 0, totalQuantity: 0 })
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [form, setForm] = useState({ date: today, item: '', quantity: '', reason: 'Expired', notes: '' })

  const load = useCallback(async () => {
    try {
      const [w, inv] = await Promise.all([
        api.get('/inventory/wastage', { params: { fromDate: monthStart, toDate: today, limit: 10 } }),
        api.get('/inventory/items', { params: { limit: 500 } }),
      ])
      setRecords(w.data.records)
      setSummary(w.data.summary)
      setItems(inv.data.items || [])
    } catch { /* panel is additive — stay silent if it cannot load */ }
  }, [])
  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/inventory/wastage', { ...form, quantity: Number(form.quantity) })
      setForm({ date: today, item: '', quantity: '', reason: 'Expired', notes: '' })
      setError('')
      load()
    } catch (err) { setError(err.response?.data?.message || 'Could not record wastage.') }
  }

  return (
    <section style={{ background: '#fff', border: '1px solid #dde3d5', borderRadius: 14, padding: 18, margin: '0 0 18px' }}>
      <h2 style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 17, margin: '0 0 6px' }}><Trash2 size={17} /> Wastage & Damage</h2>
      <p style={{ fontSize: 13, color: '#5b6b5b', margin: '0 0 14px' }}>
        This month: <b style={{ color: '#8c2b26' }}>{money(summary.totalLoss)} lost</b> across {records.length} recent write-off(s). Stock deducts immediately; loss is valued at current unit cost.
      </p>
      {error && <p style={{ color: '#8c2b26', fontSize: 13 }}>{error}</p>}
      <form onSubmit={submit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600 }}>Date<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ border: '1px solid #c9d2bf', borderRadius: 8, padding: '8px 10px' }} /></label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600 }}>Item<select required value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} style={{ border: '1px solid #c9d2bf', borderRadius: 8, padding: '8px 10px' }}><option value="">Select item</option>{items.map((i) => <option key={i._id} value={i._id}>{i.itemName} ({i.quantity} {i.unit})</option>)}</select></label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600 }}>Quantity<input type="number" required min="0.001" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} style={{ border: '1px solid #c9d2bf', borderRadius: 8, padding: '8px 10px', width: 110 }} /></label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600 }}>Reason<select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={{ border: '1px solid #c9d2bf', borderRadius: 8, padding: '8px 10px' }}>{['Expired', 'Damaged', 'Spoiled', 'Spillage', 'Other'].map((r) => <option key={r}>{r}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600 }}>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ border: '1px solid #c9d2bf', borderRadius: 8, padding: '8px 10px' }} /></label>
        <button style={{ background: '#8c2b26', color: '#fff', border: 0, borderRadius: 9, padding: '10px 16px', cursor: 'pointer', fontWeight: 600 }}>Record Write-off</button>
      </form>
      {records.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['ID', 'Date', 'Item', 'Qty', 'Reason', 'Unit Cost', 'Loss'].map((h) => <th key={h} style={{ textAlign: 'left', color: '#5b6b5b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', padding: 8, borderBottom: '1px solid #e3e8da' }}>{h}</th>)}</tr></thead>
            <tbody>{records.map((r) => (
              <tr key={r._id}>
                <td style={{ padding: 8, borderBottom: '1px solid #eef1e7' }}><b>{r.wastageId}</b></td>
                <td style={{ padding: 8, borderBottom: '1px solid #eef1e7' }}>{new Date(r.date).toLocaleDateString()}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eef1e7' }}>{r.item?.itemName}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eef1e7' }}>{r.quantity} {r.item?.unit}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eef1e7' }}>{r.reason}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eef1e7' }}>{money(r.unitCost)}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eef1e7', color: '#8c2b26' }}><b>{money(r.lossAmount)}</b></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
