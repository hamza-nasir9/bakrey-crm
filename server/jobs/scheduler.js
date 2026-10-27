/**
 * In-process daily schedulers (v3).
 * Runs inside the API process — no external cron needed. A minute-tick
 * checks the configured HH:MM times and fires each job once per day.
 * For multi-instance deployments, disable these and call the endpoints
 * (POST /api/system/backups/encrypted, POST /api/system/alerts/digest)
 * from your platform cron instead, to avoid duplicate runs.
 */
import env from '../config/env.js'

const firedOn = new Map() // jobName -> YYYY-MM-DD

async function tick() {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const jobs = []
  if (env.AUTO_BACKUP_ENABLED) jobs.push(['backup', env.AUTO_BACKUP_TIME, async () => {
    const { createEncryptedBackup } = await import('../services/backupService.js')
    const result = await createEncryptedBackup()
    console.log(`[scheduler] encrypted backup written: ${result.filename} (${result.bytes} bytes)${result.s3Url ? ` -> ${result.s3Url}` : ''}`)
  }])
  if (env.ALERT_DIGEST_ENABLED) jobs.push(['digest', env.ALERT_DIGEST_TIME, async () => {
    const { sendAlertDigest } = await import('../services/notificationService.js')
    const { sent, alerts } = await sendAlertDigest()
    console.log(`[scheduler] alert digest ${sent ? 'sent' : 'recorded'} — low ${alerts.summary.lowStock}, expiring ${alerts.summary.expiringSoon}, expired ${alerts.summary.expired}`)
  }])
  for (const [name, time, run] of jobs) {
    if (time === hhmm && firedOn.get(name) !== today) {
      firedOn.set(name, today)
      try { await run() } catch (error) { console.error(`[scheduler] ${name} failed:`, error.message) }
    }
  }
}

export function startSchedulers() {
  if (!env.AUTO_BACKUP_ENABLED && !env.ALERT_DIGEST_ENABLED) return
  setInterval(() => { tick().catch(() => {}) }, 30_000)
  console.log(`[scheduler] daily jobs enabled (backup ${env.AUTO_BACKUP_ENABLED ? env.AUTO_BACKUP_TIME : 'off'}, digest ${env.ALERT_DIGEST_ENABLED ? env.ALERT_DIGEST_TIME : 'off'})`)
}

export default startSchedulers
