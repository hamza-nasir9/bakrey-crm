/**
 * MongoDB connection.
 * NOTE on transactions: atomic multi-document writes (order delivery ->
 * stock deduction) use MongoDB transactions when the deployment supports
 * them (Atlas always does — it is a replica set). Against a standalone
 * local mongod the order service falls back to guarded atomic updates with
 * compensating rollback; see services/orderStockService.js.
 */
import mongoose from 'mongoose'
import env from './env.js'

export async function connectDatabase() {
  mongoose.set('strictQuery', true)
  mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'))
  mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'))
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 20 })
  console.log(`[db] MongoDB connected: ${mongoose.connection.host}`)
  return mongoose.connection
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
}
