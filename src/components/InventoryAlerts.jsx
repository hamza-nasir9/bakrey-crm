/**
 * Low-stock & expiry alerts panel (data: GET /api/inventory/alerts).
 * Drop it on the Dashboard or Inventory screen:
 *   import InventoryAlerts from './InventoryAlerts.jsx'
 *   <InventoryAlerts />
 * Renders nothing when there are no alerts, so it never adds noise on a healthy day.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, PackageX } from 'lucide-react'
import api from '../lib/api.js'

export default function InventoryAlerts() {
  const [alerts, setAlerts] = useState(null)

  useEffect(() => {
    api.get('/inventory/alerts').then(({ data }) => setAlerts(data)).catch(() => setAlerts(null))
  }, [])

  if (!alerts || alerts.summary.total === 0) return null

  const Row = ({ icon, title, items, render }) => (
    items.length ? (
      <div style={{ marginTop: 10 }}>
        <p style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700, margin: '6px 0' }}>{icon}{title} ({items.length})</p>
        {items.slice(0, 8).map((item) => <p key={item._id} style={{ margin: '3px 0', fontSize: 13 }}>{render(item)}</p>)}
        {items.length > 8 && <p style={{ fontSize: 12, color: '#5b6b5b' }}>…and {items.length - 8} more</p>}
      </div>
    ) : null
  )

  return (
    <section style={{ background: '#fff8e6', border: '1px solid #f0d48a', borderRadius: 12, padding: '14px 18px', margin: '16px 0' }} aria-label="Inventory alerts">
      <h2 style={{ margin: 0, fontSize: 16, display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={18} /> Inventory alerts</h2>
      <Row icon={<PackageX size={15} />} title="Low stock" items={alerts.lowStock}
        render={(i) => `${i.itemName} — ${i.quantity} ${i.unit} left (threshold ${i.lowStockThreshold || 0})`} />
      <Row icon={<CalendarClock size={15} />} title="Expiring soon" items={alerts.expiringSoon}
        render={(i) => `${i.itemName} — expires in ${i.daysToExpiry} day(s)${i.batchNo ? ` · batch ${i.batchNo}` : ''}`} />
      <Row icon={<AlertTriangle size={15} />} title="Expired" items={alerts.expired}
        render={(i) => `${i.itemName} — expired ${Math.abs(i.daysToExpiry)} day(s) ago — remove from sale`} />
    </section>
  )
}
