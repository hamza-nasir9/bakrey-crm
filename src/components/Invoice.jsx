/**
 * Printable invoice / thermal receipt for an order.
 *
 * Route: /orders/:id/invoice  (linked from the Orders screen)
 * - "Print Receipt (80mm)" renders the narrow thermal layout.
 * - "Print Invoice (A4)" renders the full invoice.
 * Both use the browser print dialog (Save as PDF included) — no server
 * PDF dependency, works offline at the counter, one click from the order.
 * Print CSS hides everything except the selected sheet.
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import api from '../lib/api.js'
import './invoice.css'

const money = (n) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0)
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export default function Invoice() {
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [payments, setPayments] = useState([])
  const [error, setError] = useState('')
  const [mode, setMode] = useState('a4') // 'a4' | 'thermal'

  useEffect(() => {
    api.get(`/orders/${id}`)
      .then(({ data }) => { setOrder(data.order); setPayments(data.paymentHistory || []) })
      .catch((e) => setError(e.response?.data?.message || 'Could not load this order.'))
  }, [id])

  const print = (selected) => {
    setMode(selected)
    // Let React apply the layout class before the print dialog snapshots the page.
    setTimeout(() => window.print(), 60)
  }

  if (error) return <main className="invoice-page"><p className="invoice-error">{error}</p><Link to="/orders">← Back to Orders</Link></main>
  if (!order) return <main className="invoice-page"><p>Loading invoice…</p></main>

  const paid = (order.totalAmount || 0) - (order.remainingAmount || 0)

  return (
    <main className="invoice-page">
      <div className="invoice-actions no-print">
        <Link to="/orders"><ArrowLeft size={16} /> Orders</Link>
        <button onClick={() => print('thermal')}><Printer size={16} /> Print Receipt (80mm)</button>
        <button onClick={() => print('a4')}><Printer size={16} /> Print Invoice (A4)</button>
      </div>

      <section className={`invoice-sheet ${mode === 'thermal' ? 'thermal' : 'a4'}`}>
        <header>
          <h1>AL KAUSAR BAKREY</h1>
          <p className="invoice-sub">{mode === 'thermal' ? 'SALES RECEIPT' : 'TAX INVOICE'}</p>
        </header>

        <div className="invoice-meta">
          <span><b>Invoice:</b> {order.orderId}</span>
          <span><b>Date:</b> {fmtDate(order.bookingDate)}</span>
          {order.deliveryDate && <span><b>Delivery:</b> {fmtDate(order.deliveryDate)}</span>}
          <span><b>Status:</b> {order.status} · {order.paymentStatus}</span>
          <span><b>Branch:</b> {order.branch?.name || 'Main Branch'}</span>
        </div>

        <div className="invoice-customer">
          <b>Billed to:</b> {order.customer?.name || 'Walk-in customer'}
          {order.customer?.phone && <> · {order.customer.phone}</>}
          {order.customer?.address && <><br />{order.customer.address}{order.customer?.city ? `, ${order.customer.city}` : ''}</>}
        </div>

        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            {order.items?.map((row, i) => (
              <tr key={i}>
                <td>{row.itemName}</td>
                <td>{row.quantity}</td>
                <td>{money(row.unitPrice)}</td>
                <td>{money(row.quantity * row.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-totals">
          <p><span>Total</span><b>{money(order.totalAmount)}</b></p>
          {order.loyaltyDiscount > 0 && <p><span>Loyalty Discount ({order.loyaltyPointsRedeemed} pts)</span><b>− {money(order.loyaltyDiscount)}</b></p>}
          <p><span>Paid</span><b>{money(paid)}</b></p>
          <p className="invoice-due"><span>Balance Due</span><b>{money(order.remainingAmount)}</b></p>
          <p><span>Method</span><b>{order.paymentMethod}</b></p>
        </div>

        {payments.length > 0 && mode === 'a4' && (
          <div className="invoice-payments">
            <b>Payment history</b>
            {payments.map((p) => (
              <p key={p._id}>{fmtDate(p.date)} · {p.paymentType} · {p.paymentMethod} · {money(p.amount)}</p>
            ))}
          </div>
        )}

        {order.notes && <p className="invoice-notes">{order.notes}</p>}
        <footer>Thank you for your business!<br />Generated {new Date().toLocaleString('en-PK')}</footer>
      </section>
    </main>
  )
}
