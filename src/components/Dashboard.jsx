import { Suspense, lazy, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowUpRight, Bell, Boxes, CalendarDays, ClipboardList, Clock, HandCoins, LayoutDashboard, Menu, PackagePlus, PlayCircle, ReceiptText, RefreshCw, Truck, Users, Wallet, History, Building2, ChefHat } from 'lucide-react'
import api from '../lib/api.js'
import InventoryAlerts from './InventoryAlerts.jsx'
// Recharts is the heaviest dependency in the app — lazy-load its panel so
// it never ships in the initial bundle (cashiers never download it at all).
const SalesAnalytics = lazy(() => import('./SalesAnalytics.jsx'))
import './dashboard.css'

const money = value => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(value || 0)
const numbers = value => new Intl.NumberFormat('en-PK').format(value || 0)

const adminNav = [['Dashboard', LayoutDashboard, '/dashboard'], ['Inventory', Boxes, '/inventory'], ['Orders', ClipboardList, '/orders'], ['Payments', Wallet, '/payments'], ['Customers', Users, '/customers'], ['Suppliers', Truck, '/suppliers'], ['Employees', Users, '/employees'], ['Attendance', Users, '/attendance'], ['Salary', HandCoins, '/salaries'], ['Expenses', ReceiptText, '/expenses'], ['Shifts', CalendarDays, '/shifts'], ['Daily Closing', ClipboardList, '/daily-closing'], ['Reports', ReceiptText, '/reports'], ['Audit Logs', History, '/audit-logs'], ['Branches', Building2, '/branches'], ['Recipes', ChefHat, '/recipes'], ['User Management', Users, '/users'], ['System Center', Bell, '/system']]
const managerNav = adminNav.filter(([name]) => !['Daily Closing', 'User Management', 'System Center'].includes(name))
// Cashiers only get links to screens scoped to their own operational work.
const cashierNav = [['Dashboard', LayoutDashboard, '/dashboard'], ['Orders', ClipboardList, '/orders'], ['Payments', Wallet, '/payments'], ['Customers', Users, '/customers'], ['Inventory', Boxes, '/inventory'], ['Suppliers', Truck, '/suppliers'], ['Attendance', Users, '/attendance'], ['My Shift', CalendarDays, '/shifts']]

const adminDefinitions = [['Total Sales', 'totalSales', Wallet], ['Total Revenue', 'totalRevenue', ArrowUpRight], ['Total Expenses', 'totalExpenses', ReceiptText], ['Total Purchase', 'totalPurchase', PackagePlus], ['Total Salary', 'totalSalary', HandCoins], ['Net Profit', 'netProfit', ArrowUpRight], ['Pending Payments', 'pendingPayments', Wallet], ['Total Orders', 'totalOrders', ClipboardList], ['Completed Orders', 'completedOrders', ClipboardList], ['Pending Orders', 'pendingOrders', AlertCircle], ['Total Employees', 'totalEmployees', Users], ['Total Suppliers', 'totalSuppliers', Truck], ['Current Inventory', 'currentInventory', Boxes], ['Low Stock Items', 'lowStockItems', AlertCircle]]

function Chart({ title, data, color }) {
  const max = Math.max(...data.map(x => x.value), 1)
  const points = data.length === 1 ? '0,145 300,145' : data.map((x, i) => `${(i / (data.length - 1)) * 300},${145 - (x.value / max) * 120}`).join(' ')
  return <article className="dash-panel chart-panel"><div><p className="dash-kicker">ANALYTICS</p><h3>{title}</h3></div><div className="svg-wrap"><svg viewBox="0 0 300 155" preserveAspectRatio="none"><line x1="0" y1="145" x2="300" y2="145" /><line x1="0" y1="95" x2="300" y2="95" /><line x1="0" y1="45" x2="300" y2="45" /><polyline points={points} fill="none" stroke={color} strokeWidth="3" /></svg><div className="chart-labels">{data.map(x => <span key={x.date}>{x.label}</span>)}</div></div></article>
}

function Shell({ user, logout, menu, setMenu, title, children }) {
  const navigate = useNavigate()
  const nav = user.role === 'ADMIN' ? adminNav : user.role === 'MANAGER' ? managerNav : cashierNav
  return <div className="dashboard-shell">
    <aside className={menu ? 'show' : ''}>
      <div className="dash-brand"><b>AK</b><span>AL KAUSAR<small>BAKREY</small></span></div>
      <p>BUSINESS MANAGEMENT</p>
      {nav.map(([name, Icon, path]) => <button onClick={() => navigate(path)} className={name === 'Dashboard' ? 'active' : ''} key={name}><Icon size={17} />{name}</button>)}
      <div className="dash-user"><b>{user.name?.slice(0, 1)}</b><span><strong>{user.name}</strong><small>{user.role === 'ADMIN' ? 'Owner / Admin' : user.role === 'MANAGER' ? 'Manager' : 'Cashier'}</small></span><button onClick={logout}>Sign out</button></div>
    </aside>
    <main><InventoryAlerts />
      <header>
        <button className="dash-menu" onClick={() => setMenu(!menu)}><Menu /></button>
        <div><span>AL KAUSAR BAKREY</span><b>/ {title}</b></div>
        <section><button><CalendarDays size={15} />{new Intl.DateTimeFormat('en-PK', { dateStyle: 'medium' }).format(new Date())}</button><button><Bell size={18} /></button><i>{user.name?.slice(0, 1)}</i></section>
      </header>
      {children}
    </main>
  </div>
}

function CashierDashboard({ user, logout }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const load = async () => {
    setLoading(true); setError('')
    try { const response = await api.get('/dashboard/summary'); setData(response.data) }
    catch (e) { setError(e.response?.data?.message || 'Unable to load dashboard data. Check the API connection.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const shift = data?.shift
  return <Shell user={user} logout={logout} menu={menu} setMenu={setMenu} title="Dashboard">
    <div className="dash-content">
      <div className="dash-title">
        <div><p className="dash-kicker">MY WORKSPACE</p><h1>Welcome back, {user.name?.split(' ')[0]}</h1><span>Your shift, today's orders, and today's collections.</span></div>
        <div className="periods"><button onClick={load} aria-label="Refresh dashboard"><RefreshCw size={16} /></button></div>
      </div>
      {error ? <div className="dash-error"><AlertCircle /><div><b>Dashboard data could not be loaded</b><p>{error}</p></div><button onClick={load}>Try again</button></div>
        : loading ? <div className="dash-loading">Loading your workspace…</div>
        : <>
          <article className="dash-panel" style={{ marginBottom: 17 }}>
            <div><p className="dash-kicker">CURRENT SHIFT</p><h3>{shift ? `${shift.shiftId} · Shift ${shift.shiftNumber}` : 'No active shift'}</h3></div>
            {shift
              ? <div className="dash-cards" style={{ gridTemplateColumns: 'repeat(4,minmax(150px,1fr))', marginTop: 14, marginBottom: 0 }}>
                  <article><div><Clock size={17} /></div><p>Started</p><h2 style={{ fontSize: 14 }}>{new Date(shift.startedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}</h2><small>Shift status: {shift.status}</small></article>
                  <article><div><Wallet size={17} /></div><p>Opening Cash</p><h2>{money(shift.openingCash)}</h2><small>Recorded at shift start</small></article>
                  <article><div><HandCoins size={17} /></div><p>Cash Collected</p><h2>{money(shift.cashCollected)}</h2><small>Payments received this shift</small></article>
                  <article><div><ClipboardList size={17} /></div><p>Orders This Shift</p><h2>{numbers(shift.totalOrders)}</h2><small>Booked while this shift is open</small></article>
                </div>
              : <div className="stock-alert"><AlertCircle /><span><b>No active shift</b><small>Start a shift from the Shifts page before creating orders or receiving payments.</small></span></div>}
            <p style={{ marginTop: 16 }}><button onClick={() => navigate('/shifts')} style={{ border: 0, background: '#176d3d', color: '#fff', borderRadius: 6, padding: '9px 14px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><PlayCircle size={15} />{shift ? 'Manage / End Shift' : 'Start a Shift'}</button></p>
          </article>

          <div className="dash-cards" style={{ gridTemplateColumns: 'repeat(4,minmax(150px,1fr))' }}>
            <article><div><ClipboardList size={17} /></div><p>Today's Orders</p><h2>{numbers(data.cards.todayOrders)}</h2><small>Orders you booked today</small></article>
            <article><div><Wallet size={17} /></div><p>Today's Order Value</p><h2>{money(data.cards.todayOrdersValue)}</h2><small>Total value of today's bookings</small></article>
            <article><div><HandCoins size={17} /></div><p>Today's Collections</p><h2>{money(data.cards.todayCollections)}</h2><small>Payments you received today</small></article>
            <article><div><AlertCircle size={17} /></div><p>Your Pending Orders</p><h2>{numbers(data.cards.pendingOrders)}</h2><small>Orders awaiting confirmation/delivery</small></article>
          </div>

          <div className="dash-bottom" style={{ marginTop: 17 }}>
            <article className="dash-panel activities">
              <div><p className="dash-kicker">YOUR RECENT ACTIVITY</p><h3>Recent actions</h3></div>
              {data.recentActivities.length
                ? data.recentActivities.map(a => <div className="dash-activity" key={a.id}><b><ReceiptText size={15} /></b><span><strong>{a.action}</strong><small>{a.description}</small></span><span>{a.amount > 0 && <strong>{money(a.amount)}</strong>}<small>{new Intl.DateTimeFormat('en-PK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(a.occurredAt))}</small></span></div>)
                : <p className="blank">No activity recorded yet today.</p>}
            </article>
            <article className="dash-panel lowstock">
              <div><p className="dash-kicker">OPERATIONAL ALERT</p><h3>Stock status</h3></div>
              <div className="stock-alert"><AlertCircle /><span><b>{numbers(data.cards.lowStockItems)} low stock items</b><small>Let Admin know if you need restocking before your shift ends.</small></span></div>
            </article>
          </div>
        </>}
    </div>
  </Shell>
}

function AdminDashboard({ user, logout }) {
  const [period, setPeriod] = useState('daily')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const load = async () => {
    setLoading(true); setError('')
    try { const response = await api.get(`/dashboard/summary?period=${period}`); setData(response.data) }
    catch (e) { setError(e.response?.data?.message || 'Unable to load dashboard data. Check the API connection.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [period])
  return <Shell user={user} logout={logout} menu={menu} setMenu={setMenu} title="Dashboard">
    <div className="dash-content">
      <div className="dash-title">
        <div><p className="dash-kicker">OVERVIEW</p><h1>Business at a glance</h1><span>Live business results from your MongoDB records.</span></div>
        <div className="periods">{['daily', 'weekly', 'monthly'].map(x => <button onClick={() => setPeriod(x)} className={period === x ? 'chosen' : ''} key={x}>{x}</button>)}<button onClick={load} aria-label="Refresh dashboard"><RefreshCw size={16} /></button></div>
      </div>
      {error ? <div className="dash-error"><AlertCircle /><div><b>Dashboard data could not be loaded</b><p>{error}</p></div><button onClick={load}>Try again</button></div>
        : loading ? <div className="dash-loading">Loading live dashboard data…</div>
        : <>
          <div className="dash-cards">{adminDefinitions.map(([label, key, Icon]) => <article key={key}><div><Icon size={17} /></div><p>{label}</p><h2>{key.includes('Orders') || key.includes('Employees') || key.includes('Suppliers') || key.includes('Items') || key === 'currentInventory' ? numbers(data.cards[key]) : money(data.cards[key])}</h2><small>{key === 'lowStockItems' ? 'Items at or below their stock threshold' : key === 'currentInventory' ? 'Total unit quantity on hand' : 'Calculated from saved database records'}</small></article>)}</div>
          <div className="dash-charts"><Chart title="Revenue" data={data.charts.revenue} color="#188044" /><Chart title="Expenses" data={data.charts.expenses} color="#c9781b" /><Chart title="Net Profit" data={data.charts.profit} color="#7053b7" /><Chart title="Orders" data={data.charts.orders} color="#3e77b5" /></div>
          <Suspense fallback={<p style={{ fontSize: 13, color: '#5b6b5b' }}>Loading chart…</p>}><SalesAnalytics /></Suspense>
          <div className="dash-bottom">
            <article className="dash-panel activities">
              <div><p className="dash-kicker">LIVE DATABASE LOG</p><h3>Recent activities</h3></div>
              {data.recentActivities.length ? data.recentActivities.map(a => <div className="dash-activity" key={a.id}><b><ReceiptText size={15} /></b><span><strong>{a.action}</strong><small>{a.description}</small></span><span>{a.amount > 0 && <strong>{money(a.amount)}</strong>}<small>{new Intl.DateTimeFormat('en-PK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(a.occurredAt))}</small></span></div>) : <p className="blank">No activities have been recorded yet.</p>}
            </article>
            <article className="dash-panel lowstock">
              <div><p className="dash-kicker">INVENTORY ALERT</p><h3>Low stock status</h3></div>
              <div className="stock-alert"><AlertCircle /><span><b>{numbers(data.cards.lowStockItems)} low stock items</b><small>Inventory alerts update automatically from stock quantities and thresholds.</small></span></div>
              <p>Current inventory <b>{numbers(data.cards.currentInventory)} units</b></p>
              <p>Pending customer payments <b>{money(data.cards.pendingPayments)}</b></p>
            </article>
          </div>
        </>}
    </div>
  </Shell>
}

export default function Dashboard({ user, logout }) {
  return user.role !== 'CASHIER' ? <AdminDashboard user={user} logout={logout} /> : <CashierDashboard user={user} logout={logout} />
}
