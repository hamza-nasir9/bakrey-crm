/**
 * Dashboard Sales & Net Profit chart (Recharts).
 * Data: GET /api/dashboard/analytics?range=daily|weekly|monthly
 *   daily   = last 30 days · weekly = last 12 weeks · monthly = last 12 months
 * Bars = Sales (order value), Line = Net Profit (revenue − purchases −
 * salaries − expenses — the same definition as the dashboard cards and the
 * Profit & Loss report, so every screen agrees).
 * Admin/Manager only: the API rejects cashiers, and Dashboard only mounts
 * this component on the management dashboard.
 */
import { useEffect, useState } from 'react'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../lib/api.js'

const money = (n) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0)
const compact = (n) => new Intl.NumberFormat('en-PK', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0)
const RANGES = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
]

export default function SalesAnalytics() {
  const [range, setRange] = useState('daily')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.get('/dashboard/analytics', { params: { range } })
      .then(({ data: d }) => { if (!cancelled) { setData(d); setError('') } })
      .catch((e) => { if (!cancelled) setError(e.response?.data?.message || 'Could not load analytics.') })
    return () => { cancelled = true }
  }, [range])

  return (
    <section className="dash-panel" style={{ padding: '18px 20px', marginTop: 16 }} aria-label="Sales and profit analytics">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="dash-kicker">ANALYTICS</p>
          <h3 style={{ margin: '2px 0' }}>Sales & Net Profit</h3>
          {data && (
            <p style={{ margin: 0, fontSize: 13, color: '#5b6b5b' }}>
              Sales <b style={{ color: '#17231b' }}>{money(data.totals.sales)}</b>
              {'  ·  '}Net Profit <b style={{ color: data.totals.netProfit < 0 ? '#b3261e' : '#1d7a3a' }}>{money(data.totals.netProfit)}</b>
              {'  ·  '}Revenue {money(data.totals.revenue)} − Purchases {money(data.totals.purchases)} − Salaries {money(data.totals.salaries)} − Expenses {money(data.totals.expenses)}
            </p>
          )}
        </div>
        <div role="tablist" aria-label="Chart range" style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <button key={r.key} role="tab" aria-selected={range === r.key} onClick={() => setRange(r.key)}
              style={{
                padding: '6px 14px', borderRadius: 999, cursor: 'pointer', fontWeight: 600,
                border: '1px solid #17231b', background: range === r.key ? '#17231b' : '#fff', color: range === r.key ? '#fff' : '#17231b',
              }}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: '#b3261e', fontSize: 13 }}>{error}</p>}
      {!data && !error && <p style={{ fontSize: 13, color: '#5b6b5b' }}>Loading chart…</p>}

      {data && (
        <div style={{ width: '100%', height: 320, marginTop: 10 }}>
          <ResponsiveContainer>
            <ComposedChart data={data.buckets} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e2" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={64} />
              <Tooltip formatter={(value, name) => [money(value), name]} labelFormatter={(l) => `${range === 'weekly' ? 'Week of ' : ''}${l}`} />
              <Legend />
              <Bar dataKey="sales" name="Sales" fill="#7fb069" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke="#17231b" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
