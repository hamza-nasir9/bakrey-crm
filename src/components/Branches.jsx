import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRightLeft, Building2, Plus, Warehouse, X } from 'lucide-react'
import api from '../lib/api.js'
import './branches.css'

const money = (n) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0)
const today = new Date().toISOString().slice(0, 10)
const monthStart = today.slice(0, 8) + '01'

/**
 * Multi-branch & warehouse management (v3):
 *  - branch/warehouse list + creation (Admin)
 *  - stock transfers between locations with history
 *  - per-branch stock position
 *  - branch-wise profit/loss + combined company P&L
 */
export default function Branches({ user, logout }) {
  const isAdmin = user.role === 'ADMIN'
  const [branches, setBranches] = useState([])
  const [items, setItems] = useState([])
  const [transfers, setTransfers] = useState([])
  const [error, setError] = useState('')
  const [branchForm, setBranchForm] = useState(null)
  const [transferForm, setTransferForm] = useState({ fromBranch: '', toBranch: '', item: '', quantity: '', note: '' })
  const [stockBranch, setStockBranch] = useState('')
  const [stockRows, setStockRows] = useState([])
  const [range, setRange] = useState({ from: monthStart, to: today })
  const [financials, setFinancials] = useState(null)

  const load = useCallback(async () => {
    try {
      const [br, tr] = await Promise.all([api.get('/branches'), api.get('/branches/transfers', { params: { limit: 25 } })])
      setBranches(br.data.branches)
      setTransfers(tr.data.transfers)
      if (!stockBranch && br.data.branches[0]) setStockBranch(br.data.branches[0]._id)
      const stock = await api.get('/branches/stock', { params: { branch: br.data.branches[0]?._id } })
      setItems(stock.data.items)
      setError('')
    } catch (e) { setError(e.response?.data?.message || 'Unable to load branches.') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!stockBranch) return
    api.get('/branches/stock', { params: { branch: stockBranch } }).then(({ data }) => setStockRows(data.items)).catch(() => {})
  }, [stockBranch])

  useEffect(() => {
    api.get('/branches/financials', { params: range }).then(({ data }) => setFinancials(data)).catch(() => {})
  }, [range])

  const createBranch = async (e) => {
    e.preventDefault()
    try { await api.post('/branches', branchForm); setBranchForm(null); load() }
    catch (err) { setError(err.response?.data?.message || 'Could not create branch.') }
  }

  const doTransfer = async (e) => {
    e.preventDefault()
    try {
      await api.post('/branches/transfers', { ...transferForm, quantity: Number(transferForm.quantity) })
      setTransferForm({ fromBranch: '', toBranch: '', item: '', quantity: '', note: '' })
      load()
      if (stockBranch) {
        const { data } = await api.get('/branches/stock', { params: { branch: stockBranch } })
        setStockRows(data.items)
      }
    } catch (err) { setError(err.response?.data?.message || 'Transfer failed.') }
  }

  return (
    <div className="branches-page">
      <header>
        <button onClick={() => history.back()}><ArrowLeft size={18} />Dashboard</button>
        <div><b>AL KAUSAR BAKREY</b><span>Branches & Warehouses</span></div>
        <button onClick={logout}>Sign out</button>
      </header>
      <main>
        <div className="branches-title">
          <div><p>MULTI-LOCATION</p><h1>Branches & Warehouses</h1><span>Stock per location, transfers, and branch-wise profit.</span></div>
          {isAdmin && <button className="branches-primary" onClick={() => setBranchForm({ code: '', name: '', type: 'BRANCH', address: '', phone: '' })}><Plus size={17} />New Branch</button>}
        </div>

        {error && <div className="branches-error"><AlertCircle size={18} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}

        <section className="branches-grid">
          {branches.map((b) => (
            <article key={b._id} className="branch-card">
              {b.type === 'WAREHOUSE' ? <Warehouse size={20} /> : <Building2 size={20} />}
              <div><b>{b.name}</b><span>{b.code} · {b.type}{b.isMain ? ' · MAIN' : ''}</span>{b.address && <span>{b.address}</span>}{b.phone && <span>{b.phone}</span>}</div>
            </article>
          ))}
          {!branches.length && <p>No branches yet.</p>}
        </section>

        <section className="branches-panel">
          <h2><ArrowRightLeft size={17} /> Transfer Stock</h2>
          <form className="branches-form" onSubmit={doTransfer}>
            <label>From<select required value={transferForm.fromBranch} onChange={(e) => setTransferForm({ ...transferForm, fromBranch: e.target.value })}><option value="">Select branch</option>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</select></label>
            <label>To<select required value={transferForm.toBranch} onChange={(e) => setTransferForm({ ...transferForm, toBranch: e.target.value })}><option value="">Select branch</option>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</select></label>
            <label>Item<select required value={transferForm.item} onChange={(e) => setTransferForm({ ...transferForm, item: e.target.value })}><option value="">Select item</option>{items.map((i) => <option key={i._id} value={i._id}>{i.itemName} ({i.unit})</option>)}</select></label>
            <label>Quantity<input required type="number" min="0.001" step="any" value={transferForm.quantity} onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })} /></label>
            <label>Note<input value={transferForm.note} onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })} placeholder="Optional" /></label>
            <button className="branches-primary">Transfer</button>
          </form>
          <div className="branches-table">
            <table><thead><tr><th>Transfer</th><th>Date</th><th>Item</th><th>From → To</th><th>Qty</th><th>By</th></tr></thead>
              <tbody>{transfers.map((tr) => <tr key={tr._id}><td><b>{tr.transferId}</b></td><td>{new Date(tr.createdAt).toLocaleDateString()}</td><td>{tr.item?.itemName}</td><td>{tr.fromBranch?.name} → {tr.toBranch?.name}</td><td>{tr.quantity} {tr.item?.unit}</td><td>{tr.createdBy?.name || '—'}</td></tr>)}
                {!transfers.length && <tr><td colSpan="6">No transfers yet.</td></tr>}</tbody></table>
          </div>
        </section>

        <section className="branches-panel">
          <h2>Stock by Branch</h2>
          <label className="branches-inline">Branch<select value={stockBranch} onChange={(e) => setStockBranch(e.target.value)}>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</select></label>
          <div className="branches-table">
            <table><thead><tr><th>Item</th><th>Category</th><th>Quantity</th></tr></thead>
              <tbody>{stockRows.map((i) => <tr key={i._id}><td>{i.itemName}</td><td>{i.category}</td><td>{i.quantity} {i.unit}</td></tr>)}</tbody></table>
          </div>
        </section>

        <section className="branches-panel">
          <h2>Branch Profit / Loss</h2>
          <div className="branches-form">
            <label>From<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
            <label>To<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          </div>
          {financials && (
            <div className="branches-table">
              <table><thead><tr><th>Branch</th><th>Sales</th><th>Revenue</th><th>Purchases</th><th>Expenses</th><th>Net (excl. salaries)</th></tr></thead>
                <tbody>
                  {financials.branches.map((r) => <tr key={r.branch.id}><td><b>{r.branch.name}</b></td><td>{money(r.sales)}</td><td>{money(r.revenue)}</td><td>{money(r.purchases)}</td><td>{money(r.expenses)}</td><td><b>{money(r.netProfit)}</b></td></tr>)}
                  <tr className="branches-total"><td><b>Combined (all branches)</b></td><td>{money(financials.combined.sales)}</td><td>{money(financials.combined.revenue)}</td><td>{money(financials.combined.purchases)}</td><td>{money(financials.combined.expenses)}</td><td><b>{money(financials.combined.netProfit)}</b> <small>(after salaries {money(financials.combined.salaries)})</small></td></tr>
                </tbody></table>
              <p className="branches-note">Salaries are company-wide (staff are not assigned to a branch), so they are deducted only in the combined row.</p>
            </div>
          )}
        </section>

        {branchForm && (
          <div className="branches-back" onMouseDown={() => setBranchForm(null)}>
            <section className="branches-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="branches-modal-head"><h2>New Branch / Warehouse</h2><button onClick={() => setBranchForm(null)}><X /></button></div>
              <form className="branches-modal-form" onSubmit={createBranch}>
                <label>Code (unique)<input required maxLength="20" value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value.toUpperCase() })} placeholder="BR2 / WH1" /></label>
                <label>Name<input required value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} /></label>
                <label>Type<select value={branchForm.type} onChange={(e) => setBranchForm({ ...branchForm, type: e.target.value })}><option value="BRANCH">Branch</option><option value="WAREHOUSE">Warehouse</option></select></label>
                <label>Address<input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} /></label>
                <label>Phone<input value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} /></label>
                <footer><button type="button" onClick={() => setBranchForm(null)}>Cancel</button><button className="branches-primary">Create Branch</button></footer>
              </form>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
