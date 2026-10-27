import mongoose from 'mongoose'

/**
 * Application user (login account) — distinct from Employee (HR record).
 * Changes in this upgrade:
 *  - MANAGER role added (see server/security/permissions.js for the matrix).
 *  - tokenVersion: bump it to revoke every outstanding JWT for this user
 *    (used on credential reset, deactivation and password/PIN change).
 *  - failedLoginAttempts / lockUntil: brute-force lockout for password & PIN login.
 */
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, minlength: 3, maxlength: 50 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    role: { type: String, required: true, enum: ['ADMIN', 'MANAGER', 'CASHIER'] },
    passwordHash: { type: String, select: false },
    pinHash: { type: String, select: false },
    isActive: { type: Boolean, default: true },
    forceCredentialChange: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0, select: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
)

userSchema.virtual('isLocked').get(function () {
  return Boolean(this.lockUntil && this.lockUntil > new Date())
})

export default mongoose.model('User', userSchema)
