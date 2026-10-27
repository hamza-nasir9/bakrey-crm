/**
 * Outbound notifications — WhatsApp / SMS / Email.
 *
 * Provider strategy (no vendor lock-in, everything via plain HTTPS):
 *   NOTIFY_PROVIDER=none   → messages are still generated and recorded in
 *                            NotificationLog as `skipped`, so the business
 *                            trail exists before any provider is paid for.
 *   NOTIFY_PROVIDER=twilio → WhatsApp + SMS via Twilio (TWILIO_* env).
 *   NOTIFY_PROVIDER=meta   → WhatsApp via Meta WhatsApp Cloud API
 *                            (WHATSAPP_TOKEN + WHATSAPP_PHONE_ID env).
 *   Email works whenever SMTP_* env is set (nodemailer).
 * Every attempt — sent, failed, or skipped — lands in NotificationLog,
 * viewable at GET /api/system/notification-logs (Admin).
 */
import nodemailer from 'nodemailer'
import env from '../config/env.js'
import { NotificationLog } from '../models/PlatformModels.js'

const digits = (phone) => String(phone || '').replace(/[^\d]/g, '')
/** Normalise a Pakistani local number (03xx…) to international form for WhatsApp. */
const intl = (phone) => {
  const d = digits(phone)
  if (!d) return ''
  if (d.startsWith('0')) return `92${d.slice(1)}`
  return d
}

async function log(entry) {
  return NotificationLog.create(entry).catch(() => null)
}

async function sendViaTwilio({ channel, to, body }) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token } = env
  const from = channel === 'whatsapp' ? env.TWILIO_WHATSAPP_FROM : env.TWILIO_SMS_FROM
  if (!sid || !token || !from) throw new Error('Twilio credentials or sender number not configured.')
  const toField = channel === 'whatsapp' ? `whatsapp:+${intl(to)}` : `+${intl(to)}`
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: toField, Body: body }),
  })
  if (!res.ok) throw new Error(`Twilio responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function sendViaMeta({ to, body }) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: intl(to), type: 'text', text: { body } }),
  })
  if (!res.ok) throw new Error(`Meta WhatsApp responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function sendEmail({ to, subject, body }) {
  if (!env.SMTP_HOST || !env.SMTP_USER) throw new Error('SMTP not configured.')
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  })
  await transport.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject, text: body })
}

/** Core sender: resolves provider, attempts delivery, always writes a log row. */
export async function notify({ channel, to, body, template, ref }) {
  const provider = channel === 'email' ? (env.SMTP_HOST ? 'smtp' : 'none') : env.NOTIFY_PROVIDER
  const base = { channel, provider, to: to || '', template, body, ref }
  if (!to) return log({ ...base, status: 'skipped', error: 'No destination address/phone on record.' })
  if (provider === 'none') {
    return log({ ...base, status: 'skipped', error: 'No notification provider configured (NOTIFY_PROVIDER=none). Message recorded for when a provider is connected.' })
  }
  try {
    if (channel === 'email') await sendEmail({ to, subject: template === 'alert-digest' ? 'Bakrey CRM — Daily Stock Alert Summary' : 'Bakrey CRM Notification', body })
    else if (provider === 'twilio') await sendViaTwilio({ channel, to, body })
    else if (provider === 'meta') {
      if (channel !== 'whatsapp') throw new Error('Meta provider supports WhatsApp only.')
      await sendViaMeta({ to, body })
    }
    return log({ ...base, status: 'sent' })
  } catch (error) {
    return log({ ...base, status: 'failed', error: error.message.slice(0, 300) })
  }
}

/** Digital invoice: fires when an order is created (fire-and-forget by callers). */
export async function notifyInvoiceCreated({ order, customer }) {
  const to = customer?.whatsapp || customer?.phone
  const link = `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/orders/${order._id}/invoice`
  const body =
    `Assalam-o-Alaikum ${customer?.name || ''}, your order ${order.orderId} at Al Kausar Bakrey is confirmed.\n` +
    `Total: Rs ${order.totalAmount} · Paid: Rs ${order.advancePaid || 0} · Remaining: Rs ${order.remainingAmount || 0}\n` +
    `View/print your invoice: ${link}\nThank you for your order!`
  return notify({ channel: 'whatsapp', to, body, template: 'invoice', ref: order.orderId })
}

/** Daily low-stock + expiry digest to the owner/manager. Returns the alert data used. */
export async function sendAlertDigest() {
  const { getInventoryAlerts } = await import('./inventoryAlertService.js')
  const alerts = await getInventoryAlerts()
  const total = alerts.summary.lowStock + alerts.summary.expiringSoon + alerts.summary.expired
  if (total === 0) {
    await log({ channel: 'whatsapp', provider: env.NOTIFY_PROVIDER, to: env.ADMIN_ALERT_PHONE || '', template: 'alert-digest', body: 'Daily digest: no low-stock or expiry alerts.', status: 'skipped', error: 'No alerts to report today.' })
    return { alerts, sent: false }
  }
  const lines = [
    `*Bakrey CRM — Daily Stock Alerts* (${new Date().toISOString().slice(0, 10)})`,
    alerts.summary.lowStock ? `\nLow stock (${alerts.summary.lowStock}):\n${alerts.lowStock.slice(0, 15).map((x) => `• ${x.itemName}: ${x.quantity} ${x.unit} left (threshold ${x.lowStockThreshold})`).join('\n')}` : '',
    alerts.summary.expiringSoon ? `\nExpiring soon (${alerts.summary.expiringSoon}):\n${alerts.expiringSoon.slice(0, 15).map((x) => `• ${x.itemName}: expires ${String(x.expiryDate).slice(0, 10)} (${x.daysToExpiry} days)`).join('\n')}` : '',
    alerts.summary.expired ? `\nEXPIRED (${alerts.summary.expired}):\n${alerts.expired.slice(0, 15).map((x) => `• ${x.itemName}: expired ${String(x.expiryDate).slice(0, 10)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
  const results = []
  if (env.ADMIN_ALERT_PHONE) results.push(await notify({ channel: 'whatsapp', to: env.ADMIN_ALERT_PHONE, body: lines, template: 'alert-digest' }))
  if (env.ADMIN_ALERT_EMAIL) results.push(await notify({ channel: 'email', to: env.ADMIN_ALERT_EMAIL, body: lines, template: 'alert-digest' }))
  if (!results.length) {
    await log({ channel: 'whatsapp', provider: env.NOTIFY_PROVIDER, to: '', template: 'alert-digest', body: lines, status: 'skipped', error: 'ADMIN_ALERT_PHONE / ADMIN_ALERT_EMAIL not configured.' })
  }
  return { alerts, sent: results.some((r) => r?.status === 'sent') }
}

export default { notify, notifyInvoiceCreated, sendAlertDigest }
