import { Suspense, lazy, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck, UserRound, ChevronRight } from 'lucide-react'
import './App.css'
import api from './lib/api.js'
const Dashboard = lazy(() => import('./components/Dashboard.jsx')) // code-split: loaded on first visit
const Inventory = lazy(() => import('./components/Inventory.jsx')) // code-split: loaded on first visit
const Suppliers = lazy(() => import('./components/Suppliers.jsx')) // code-split: loaded on first visit
const Customers = lazy(() => import('./components/Customers.jsx')) // code-split: loaded on first visit
const Orders = lazy(() => import('./components/Orders.jsx')) // code-split: loaded on first visit
const Payments = lazy(() => import('./components/Payments.jsx')) // code-split: loaded on first visit
const Employees = lazy(() => import('./components/Employees.jsx')) // code-split: loaded on first visit
const Attendance = lazy(() => import('./components/Attendance.jsx')) // code-split: loaded on first visit
const Salaries = lazy(() => import('./components/Salaries.jsx')) // code-split: loaded on first visit
const Expenses = lazy(() => import('./components/Expenses.jsx')) // code-split: loaded on first visit
const Shifts = lazy(() => import('./components/Shifts.jsx')) // code-split: loaded on first visit
const DailyClosing = lazy(() => import('./components/DailyClosing.jsx')) // code-split: loaded on first visit
const Reports = lazy(() => import('./components/Reports.jsx')) // code-split: loaded on first visit
const System = lazy(() => import('./components/System.jsx')) // code-split: loaded on first visit
const UserManagement = lazy(() => import('./components/UserManagement.jsx')) // code-split: loaded on first visit
const Invoice = lazy(() => import('./components/Invoice.jsx')) // code-split: loaded on first visit
const AuditLogs = lazy(() => import('./components/AuditLogs.jsx')) // code-split: loaded on first visit
const Branches = lazy(() => import('./components/Branches.jsx')) // code-split: loaded on first visit
const Recipes = lazy(() => import('./components/Recipes.jsx')) // code-split: loaded on first visit
import { ROUTE_ROLES } from './lib/roles.js'

/**
 * Route guard (UPGRADE): previously ANY signed-in user could open /users,
 * /salaries, /reports, /system by typing the URL — the API blocked the data,
 * but the screens, navigation and forms were all exposed. Now routes enforce
 * the same role matrix as the API (src/lib/roles.js).
 */
function Guard({ user, path, children }) {
  if (!user) return <Navigate to="/login" replace />
  const roles = ROUTE_ROLES[path]
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />
  return children
}

function App() {
  // Auth state lives only in memory. The JWT itself is in an HttpOnly cookie
  // that JavaScript cannot read, so on a page refresh we ask the API who we
  // are (GET /auth/me) — the browser attaches the cookie automatically.
  const [user, setUser] = useState(null)
  const [restoring, setRestoring] = useState(true)
  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setRestoring(false))
  }, [])
  const logout = async () => {
    try { await api.post('/auth/logout') } catch { /* cookie already gone/expired — local logout still applies */ }
    setUser(null)
  }
  if (restoring) return <div className="auth-page"><p className="sub" style={{ margin: 'auto' }}>Restoring your session…</p></div>
  const page = (path, Component) => <Guard user={user} path={path}><Component user={user} logout={logout} /></Guard>
  return (
    <Suspense fallback={<div className="auth-page"><p className="sub" style={{ margin: 'auto' }}>Loading…</p></div>}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login signedIn={setUser} />} />
      <Route path="/dashboard" element={page('/dashboard', Dashboard)} />
      <Route path="/inventory" element={page('/inventory', Inventory)} />
      <Route path="/suppliers" element={page('/suppliers', Suppliers)} />
      <Route path="/customers" element={page('/customers', Customers)} />
      <Route path="/orders" element={page('/orders', Orders)} />
      <Route path="/orders/:id/invoice" element={user ? <Invoice /> : <Navigate to="/login" replace />} />
      <Route path="/payments" element={page('/payments', Payments)} />
      <Route path="/employees" element={page('/employees', Employees)} />
      <Route path="/attendance" element={page('/attendance', Attendance)} />
      <Route path="/salaries" element={page('/salaries', Salaries)} />
      <Route path="/expenses" element={page('/expenses', Expenses)} />
      <Route path="/shifts" element={page('/shifts', Shifts)} />
      <Route path="/daily-closing" element={page('/daily-closing', DailyClosing)} />
      <Route path="/audit-logs" element={page('/audit-logs', AuditLogs)} />
      <Route path="/branches" element={page('/branches', Branches)} />
      <Route path="/recipes" element={page('/recipes', Recipes)} />
      <Route path="/reports" element={page('/reports', Reports)} />
      <Route path="/system" element={page('/system', System)} />
      <Route path="/users" element={page('/users', UserManagement)} />
      <Route path="/" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
    </Suspense>
  )
}
function Login({ signedIn }) {
  const navigate = useNavigate();

  const [mode, setMode] = useState('admin');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data } = await api.post('/auth/login', {
        username,
        password: mode === 'cashier' ? undefined : secret,
        pin: mode === 'cashier' ? secret : undefined,
        role: mode === 'admin' ? 'ADMIN' : mode === 'manager' ? 'MANAGER' : 'CASHIER',
      });

      // No token handling here: the API set the session as an HttpOnly
      // cookie on this response, and the browser will send it from now on.
      signedIn(data.user);

      navigate('/dashboard');
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.userMessage ||
        'Unable to sign in. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return <div className="auth-page"><section className="auth-side"><div className="auth-brand"><div className="logo">AK</div><div><b>AL KAUSAR</b><span>BAKREY</span></div></div><div className="side-content"><p className="eyebrow">BUSINESS MANAGEMENT SYSTEM</p><h1>Built for every part<br />of your livestock business.</h1><p className="side-copy">Securely manage records, sales, cash collection, inventory and staff from one professional workspace.</p><div className="feature-list"><p><CheckCircle2 />Role-based access for Owner / Admin and Cashiers</p><p><CheckCircle2 />Secure sessions and protected business records</p><p><CheckCircle2 />Four fixed cashier shifts with individual access</p></div></div><footer>© 2024 AL KAUSAR BAKREY · Business Management System</footer></section><section className="login-panel"><div className="login-box"><div className="mobile-brand"><div className="logo">AK</div><b>AL KAUSAR BAKREY</b></div><p className="eyebrow">SECURE ACCESS</p><h2>Welcome back</h2><p className="sub">Sign in to access your business workspace.</p><div className="role-switch"><button className={mode === 'admin' ? 'selected' : ''} onClick={() => { setMode('admin'); setError(''); setSecret('') }}><ShieldCheck />Owner / Admin</button><button className={mode === 'manager' ? 'selected' : ''} onClick={() => { setMode('manager'); setError(''); setSecret('') }}><ShieldCheck />Manager</button><button className={mode === 'cashier' ? 'selected' : ''} onClick={() => { setMode('cashier'); setError(''); setSecret('') }}><UserRound />Cashier</button></div><form onSubmit={submit}><label>Username<div className="input"><UserRound /><input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder={mode === 'cashier' ? 'Enter cashier username' : 'Enter your username'} required /></div></label><label>{mode === 'cashier' ? 'Numeric PIN' : 'Password'}<div className="input"><KeyRound />
    <input
      value={secret}
      onChange={(e) => {
        if (mode === 'cashier') {
          setSecret(e.target.value.replace(/\D/g, ''))
        } else {
          setSecret(e.target.value)
        }
      }}
      type={show ? 'text' : 'password'}
      inputMode={mode === 'cashier' ? 'numeric' : undefined}
      maxLength={mode === 'cashier' ? 8 : undefined}
      autoComplete="current-password"
      placeholder={mode === 'cashier' ? 'Enter your numeric PIN' : 'Enter your password'}
      required
    />

    <button type="button" onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button></div></label>{error && <p className="error">{error}</p>}<button className="signin" disabled={loading}>{loading ? 'Signing in…' : <>Sign in <ChevronRight size={18} /></>}</button></form><p className="secure"><LockKeyhole size={13} /> Protected with secure authentication</p></div></section></div>
}
export default App
