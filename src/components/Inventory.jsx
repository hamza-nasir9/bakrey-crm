import { Suspense, lazy, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, Download, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import api from '../lib/api.js'
import './inventory.css'
const WastagePanel = lazy(() => import('./WastagePanel.jsx')) // v3: wastage & damage write-offs

const blank = { itemName: '', category: '', unit: '', lowStockThreshold: '', expiryDate: '', batchNo: '' }
const stockBlank = { date: new Date().toISOString().slice(0, 10), item: '', quantityPieces: '', quantityKg: '', supplier: '', invoiceNo: '', notes: '', totalPrice: '' }

export default function Inventory({ user, logout }) {
  const [items, setItems] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [search, setSearch] = useState(''), [low, setLow] = useState(false), [form, setForm] = useState(null), [editing, setEditing] = useState(null), [suppliers, setSuppliers] = useState([]), [stock, setStock] = useState(null), [stockError, setStockError] = useState('')
  const readOnly = user.role !== 'ADMIN'
  const load = async () => {
    setLoading(true)
    try { const { data } = await api.get('/inventory/items', { params: { search, lowStock: low } }); setItems(data.items); setError('') }
    catch (e) { setError(e.response?.data?.message || 'Unable to load inventory.') }
    finally { setLoading(false) }
  }
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [search, low])
  // Both roles can add incoming stock now, so both need the supplier list.
  useEffect(() => { api.get('/suppliers', { params: { status: 'active' } }).then(({ data }) => setSuppliers(data.suppliers)).catch(() => {}) }, [])

  const save = async e => {
    e.preventDefault()
    try { if (editing) await api.patch(`/inventory/items/${editing._id}`, form); else await api.post('/inventory/items', form); setForm(null); setEditing(null); load() }
    catch (e) { setError(e.response?.data?.message || 'Could not save inventory item.') }
  }
  const deactivate = async id => {
    if (!window.confirm('Deactivate this inventory item?')) return
    try { await api.delete(`/inventory/items/${id}`); load() }
    catch (e) { setError(e.response?.data?.message || 'Could not deactivate item.') }
  }
  const addStock = async e => {
    e.preventDefault()
    setStockError('')
    // At least one of Pieces / KG must be provided before we even hit the API.
    if (!stock.quantityPieces && !stock.quantityKg) { setStockError('Enter a Quantity in Pieces, KG, or both.'); return }
    try { await api.post('/inventory/purchases', stock); setStock(null); load() }
    catch (e) { setStockError(e.response?.data?.message || 'Could not record incoming stock.') }
  }
  const exportCsv = () => {
    const rows = [['Item Name', 'Category', 'Quantity', 'Unit', 'Stock (Pieces)', 'Stock (KG)', 'Low Stock Threshold', 'Status'], ...items.map(x => [x.itemName, x.category, x.quantity, x.unit, x.stockPieces || 0, x.stockKg || 0, x.lowStockThreshold, x.isActive ? 'Active' : 'Inactive'])]
    const blob = new Blob([rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'inventory-report.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return <div className="inventory-page">
    <header><button onClick={() => history.back()}><ArrowLeft size={18} /> Dashboard</button><div><b>AL KAUSAR BAKREY</b><span>Inventory {readOnly ? 'Status' : 'Management'}</span></div><button onClick={logout}>Sign out</button></header>
    <main>{user.role!=='CASHIER'&&<Suspense fallback={null}><WastagePanel/></Suspense>}
      <div className="inventory-title">
        <div><p>{readOnly ? 'INVENTORY STATUS' : 'INVENTORY MANAGEMENT'}</p><h1>Current stock</h1><span>{readOnly ? 'Live stock levels for goats and items.' : 'Track stock in, stock out, low stock alerts, and inventory history.'}</span></div>
        <div className="inventory-title-actions">
          {!readOnly && <button className="inv-primary" onClick={() => { setForm(blank); setEditing(null) }}><Plus size={17} />Add Item</button>}
          <button className="inv-primary" onClick={() => { setStock(stockBlank); setStockError('') }}><Plus size={17} />Add Incoming Stock</button>
        </div>
      </div>
      <div className="inventory-actions"><label><Search size={17} /><input placeholder="Search item or category" value={search} onChange={e => setSearch(e.target.value)} /></label><button className={low ? 'active' : ''} onClick={() => setLow(!low)}><SlidersHorizontal size={16} />Low stock only</button><button onClick={exportCsv}><Download size={16} />Export CSV</button></div>
      {error && <div className="inv-error"><AlertCircle size={18} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
      <section className="inventory-cards"><article><span>Total items</span><b>{items.length}</b></article><article><span>Current inventory</span><b>{items.reduce((total, x) => total + x.quantity, 0)}</b></article><article><span>Low stock items</span><b>{items.filter(x => x.quantity <= x.lowStockThreshold).length}</b></article></section>
      <section className="inventory-table">{loading ? <p>Loading live inventory records…</p> : <table><thead><tr><th>Item Name</th><th>Category</th><th>Current Stock</th><th>Unit</th><th>Stock (Pieces)</th><th>Stock (KG)</th><th>Low Stock Threshold</th><th>Status</th>{!readOnly && <th>Action</th>}</tr></thead><tbody>
        {items.length ? items.map(item => <tr key={item._id}>
          <td><b>{item.itemName}</b></td>
          <td>{item.category}</td>
          <td className={item.quantity <= item.lowStockThreshold ? 'low' : ''}>{item.quantity}</td>
          <td>{item.unit}</td>
          <td>{item.stockPieces || 0}</td>
          <td>{item.stockKg || 0}</td>
          <td>{item.lowStockThreshold}</td>
          <td><span className={item.isActive ? 'status-active' : 'status-off'}>{item.isActive ? 'Active' : 'Inactive'}</span></td>
          {!readOnly && <td><button onClick={() => { setEditing(item); setForm({ itemName: item.itemName, category: item.category, unit: item.unit, lowStockThreshold: item.lowStockThreshold, expiryDate: item.expiryDate ? String(item.expiryDate).slice(0, 10) : '', batchNo: item.batchNo || '' }) }}>Edit</button><button className="remove" onClick={() => deactivate(item._id)}>Deactivate</button></td>}
        </tr>) : <tr><td colSpan="9" className="empty">No inventory records found. Add an item to begin.</td></tr>}
      </tbody></table>}</section>
    </main>

    {!readOnly && form && <div className="inv-modal-back" onMouseDown={() => setForm(null)}><form className="inv-modal" onMouseDown={e => e.stopPropagation()} onSubmit={save}>
      <div><h2>{editing ? 'Edit Inventory Item' : 'Add Inventory Item'}</h2><button type="button" onClick={() => setForm(null)}><X /></button></div>
      <label>Item Name<input required value={form.itemName} onChange={e => setForm({ ...form, itemName: e.target.value })} /></label>
      <label>Category<input required value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
      <label>Unit<input required value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
      <label>Low Stock Threshold<input required min="0" type="number" value={form.lowStockThreshold} onChange={e => setForm({ ...form, lowStockThreshold: e.target.value })} /></label>       <label>Expiry Date (optional)<input type="date" value={form.expiryDate || ''} onChange={e => setForm({ ...form, expiryDate: e.target.value })} /></label>       <label>Batch No. (optional)<input value={form.batchNo || ''} onChange={e => setForm({ ...form, batchNo: e.target.value })} /></label>
      <footer><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="inv-primary">Save Item</button></footer>
    </form></div>}

    {stock && <div className="inv-modal-back" onMouseDown={() => setStock(null)}><form className="inv-modal" onMouseDown={e => e.stopPropagation()} onSubmit={addStock}>
      <div><h2>Add Incoming Stock</h2><button type="button" onClick={() => setStock(null)}><X /></button></div>
      <label>Item<select required value={stock.item} onChange={e => setStock({ ...stock, item: e.target.value })}><option value="">Select item</option>{items.filter(x => x.isActive).map(x => <option key={x._id} value={x._id}>{x.itemName} ({x.unit})</option>)}</select></label>
      <p className="inv-dual-hint">Enter Pieces, KG, or both — whatever matches this delivery.</p>
      <label>Quantity (Pieces) — optional<input min="0" step="any" type="number" value={stock.quantityPieces} onChange={e => setStock({ ...stock, quantityPieces: e.target.value })} placeholder="e.g. 10" /></label>
      <label>Quantity (KG) — optional<input min="0" step="any" type="number" value={stock.quantityKg} onChange={e => setStock({ ...stock, quantityKg: e.target.value })} placeholder="e.g. 250" /></label>
      <label>Supplier<select required value={stock.supplier} onChange={e => setStock({ ...stock, supplier: e.target.value })}><option value="">Select supplier</option>{suppliers.map(x => <option key={x._id} value={x._id}>{x.name}</option>)}</select></label>
      <label>Date<input required type="date" value={stock.date} onChange={e => setStock({ ...stock, date: e.target.value })} /></label>
      <label>Invoice/Reference No (optional)<input value={stock.invoiceNo} onChange={e => setStock({ ...stock, invoiceNo: e.target.value })} /></label>
      <label>Purchase Price / Total Amount<input required min="0.01" step="any" type="number" value={stock.totalPrice} onChange={e => setStock({ ...stock, totalPrice: e.target.value })} /></label>
      <label>Notes<textarea value={stock.notes} onChange={e => setStock({ ...stock, notes: e.target.value })} /></label>
      {stockError && <p className="inv-stock-error"><AlertCircle size={14} />{stockError}</p>}
      <footer><button type="button" onClick={() => setStock(null)}>Cancel</button><button className="inv-primary">Save Stock Entry</button></footer>
    </form></div>}
  </div>
}
