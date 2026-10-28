/**
 * MongoDB connection optimized for Vercel Serverless Functions.
 */
import mongoose from 'mongoose'
import env from './env.js'

let cached = global.mongoose

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null }
}

export async function connectDatabase() {
  if (cached.conn) {
    return cached.conn
  }

  if (!cached.promise) {
    mongoose.set('strictQuery', true)

    // Buffering ko disable karein taake Mongoose disconnected state mein requests ko 10s tak hold na rakhe
    mongoose.set('bufferCommands', false)

    mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'))
    mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'))

    cached.promise = mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    }).then((m) => {
      console.log(`[db] MongoDB connected: ${m.connection.host}`)
      return m.connection
    })
  }

  try {
    cached.conn = await cached.promise
  } catch (e) {
    cached.promise = null
    throw e
  }

  return cached.conn
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
  cached.conn = null
  cached.promise = null
}