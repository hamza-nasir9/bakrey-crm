/**
 * Seed login users — credentials come from the ENVIRONMENT, never from code.
 *
 * The original script hard-coded `Admin@123` and PINs 1234/2345/… in the
 * repository: anyone with the ZIP owns the business. This version refuses
 * to run without SEED_* variables and refuses known-weak values outright.
 *
 * Usage:
 *   SEED_ADMIN_PASSWORD=… SEED_MANAGER_PASSWORD=… SEED_CASHIER_PIN=… npm run seed:auth
 * (or put them in .env — local only, never committed.)
 * Re-running bumps tokenVersion, revoking sessions issued under old credentials.
 */
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import { connectDatabase, disconnectDatabase } from '../config/database.js'
import User from '../models/User.js'

dotenv.config()

const WEAK = new Set(['admin@123', 'password', '1234', '123456', 'changeme'])
function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required to seed users. See .env.example.`)
  if (WEAK.has(value.toLowerCase())) throw new Error(`${name} is a known-weak value — choose a real secret.`)
  return value
}

const adminPassword = required('SEED_ADMIN_PASSWORD')
const managerPassword = required('SEED_MANAGER_PASSWORD')
const cashierPin = required('SEED_CASHIER_PIN')
if (!/^\d{4,8}$/.test(cashierPin)) throw new Error('SEED_CASHIER_PIN must be 4–8 digits.')
if (adminPassword.length < 10 || managerPassword.length < 10) {
  throw new Error('Seed passwords must be at least 10 characters.')
}

const accounts = [
  { username: process.env.SEED_ADMIN_USERNAME || 'admin', name: 'Admin Owner', role: 'ADMIN', password: adminPassword },
  { username: process.env.SEED_MANAGER_USERNAME || 'manager', name: 'Shop Manager', role: 'MANAGER', password: managerPassword },
  { username: 'cashier1', name: 'Cashier 1', role: 'CASHIER', pin: cashierPin },
]

await connectDatabase()
for (const account of accounts) {
  const isPin = account.role === 'CASHIER'
  const hashKey = isPin ? 'pinHash' : 'passwordHash'
  await User.findOneAndUpdate(
    { username: account.username },
    {
      name: account.name,
      role: account.role,
      [hashKey]: await bcrypt.hash(isPin ? account.pin : account.password, 12),
      isActive: true,
      forceCredentialChange: true, // first login must set personal credentials
      $inc: { tokenVersion: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  console.log(`Seeded ${account.role}: ${account.username}`)
}
console.log('Done. Users must change credentials on first login. Remove SEED_* secrets from the environment if you will not re-seed.')
await disconnectDatabase()
process.exit(0)
