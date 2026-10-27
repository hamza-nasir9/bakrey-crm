/**
 * Operator tool: decrypt an encrypted backup file produced by
 * POST /api/system/backups/encrypted (or the nightly job).
 * Usage:  BACKUP_ENCRYPTION_KEY=... node server/scripts/decrypt-backup.mjs <in.enc> <out.json>
 */
import { readFile, writeFile } from 'node:fs/promises'
import { decryptEnvelope } from '../services/backupService.js'

const [input, output] = process.argv.slice(2)
const secret = process.env.BACKUP_ENCRYPTION_KEY
if (!input || !output || !secret) {
  console.error('Usage: BACKUP_ENCRYPTION_KEY=<key> node server/scripts/decrypt-backup.mjs <backup.json.enc> <restored.json>')
  process.exit(1)
}
const snapshot = decryptEnvelope(await readFile(input), secret)
await writeFile(output, JSON.stringify(snapshot, null, 2))
console.log(`Decrypted ${input} -> ${output} (${Object.keys(snapshot).length} collections)`)
