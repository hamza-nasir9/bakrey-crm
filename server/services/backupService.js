/**
 * Encrypted, portable database backups (v3).
 *
 * What this adds over the in-app Backup snapshots (which live INSIDE the
 * same database): a standalone encrypted file that can leave the building —
 * written to BACKUP_DIR and optionally uploaded to an S3 bucket.
 *   Format: JSON snapshot → AES-256-GCM (key derived from
 *           BACKUP_ENCRYPTION_KEY via scrypt) → base64 envelope file.
 * Restore: `node server/scripts/decrypt-backup.mjs <file.enc> <out.json>`
 * with BACKUP_ENCRYPTION_KEY set, then import the JSON through the normal
 * restore route or a migration script.
 * S3 upload uses a hand-rolled SigV4 PUT — no AWS SDK dependency.
 */
import crypto from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import env from '../config/env.js'
import mongoose from 'mongoose'

const backupModels = async () => {
  const biz = await import('../models/BusinessModels.js')
  const platform = await import('../models/PlatformModels.js')
  const auth = await import('../models/User.js')
  return { ...pick(biz), ...pick(platform), User: auth.default }
}
const pick = (m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v?.modelName))

export async function snapshotAll() {
  const models = await backupModels()
  const snapshot = {}
  for (const [name, Model] of Object.entries(models)) {
    snapshot[name] = await Model.find({}).lean()
  }
  return snapshot
}

const deriveKey = (secret) => crypto.scryptSync(String(secret), 'bakrey-crm-backup-v1', 32)

export function encryptSnapshot(snapshot, secret) {
  const key = deriveKey(secret)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plain = Buffer.from(JSON.stringify(snapshot), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const envelope = {
    product: 'bakrey-crm', format: 'aes-256-gcm', version: 1,
    createdAt: new Date().toISOString(),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
    sha256: crypto.createHash('sha256').update(plain).digest('hex'),
  }
  return Buffer.from(JSON.stringify(envelope), 'utf8')
}

export function decryptEnvelope(buffer, secret) {
  const envelope = JSON.parse(buffer.toString('utf8'))
  if (envelope.format !== 'aes-256-gcm') throw new Error('Unsupported backup format.')
  const key = deriveKey(secret)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
  const sha = crypto.createHash('sha256').update(plain).digest('hex')
  if (sha !== envelope.sha256) throw new Error('Backup integrity check failed (sha256 mismatch).')
  return JSON.parse(plain.toString('utf8'))
}

/* ------------------------- S3 upload (SigV4) -------------------------- */
async function uploadToS3(key, body) {
  const { BACKUP_S3_BUCKET: bucket, BACKUP_S3_REGION: region, AWS_ACCESS_KEY_ID: accessKey, AWS_SECRET_ACCESS_KEY: secretKey } = env
  if (!bucket || !accessKey || !secretKey) return null
  const host = `${bucket}.s3.${region}.amazonaws.com`
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex')
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['PUT', `/${key}`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const res = await fetch(`https://${host}/${key}`, {
    method: 'PUT',
    headers: {
      'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  })
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return `https://${host}/${key}`
}

/** Create one encrypted backup file (+ optional S3 upload). Returns metadata only. */
export async function createEncryptedBackup() {
  const secret = env.BACKUP_ENCRYPTION_KEY
  if (!secret || String(secret).length < 16) {
    throw Object.assign(new Error('BACKUP_ENCRYPTION_KEY is not set (or too short). Set a long random value in the server .env first.'), { status: 400 })
  }
  const snapshot = await snapshotAll()
  const body = encryptSnapshot(snapshot, secret)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `bakrey-backup-${stamp}.json.enc`
  const dir = path.resolve(env.BACKUP_DIR)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, filename)
  await writeFile(filePath, body)
  let s3Url = null
  if (env.BACKUP_S3_BUCKET) s3Url = await uploadToS3(filename, body)
  const collections = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, v.length]))
  return { filename, path: filePath, bytes: body.length, s3Url, collections, database: mongoose.connection.name }
}

export const readBackupFile = (filePath) => new Promise((resolve, reject) => {
  const chunks = []
  createReadStream(filePath).on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject)
})

export default { createEncryptedBackup, snapshotAll, encryptSnapshot, decryptEnvelope }
