/**
 * Centralised, validated environment configuration.
 *
 * Why this exists: the original code read `process.env.*` ad-hoc in many
 * files, silently continued with a missing/weak JWT secret, and shipped a
 * real `.env` (Atlas password + JWT secret + backup key) inside the repo.
 * Failing fast at boot with a clear message is far safer than failing
 * mysteriously in production.
 *
 * Install: `zod` is the only runtime dependency added by the upgrade.
 */
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config() // must run before the schema parse below; ESM imports evaluate first

const isProd = process.env.NODE_ENV === 'production'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  // --- Database -----------------------------------------------------------
  MONGODB_URI: z
    .string({ required_error: 'MONGODB_URI is required' })
    .min(1, 'MONGODB_URI is required')
    .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
      message: 'MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string',
    }),

  // --- Auth ---------------------------------------------------------------
  // In production a short/guessable secret is a full account-takeover risk,
  // so we refuse to boot. In development we still require >= 16 chars.
  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET is required' })
    .min(isProd ? 32 : 16, `JWT_SECRET must be at least ${isProd ? 32 : 16} characters`),
  JWT_EXPIRES_IN: z.string().default('8h'),
  JWT_ISSUER: z.string().default('bakrey-crm'),
  // --- Session cookie (JWT transport) --------------------------------------
  // Production default: Secure + SameSite=None so the cookie works between a
  // Vercel frontend and an API on a different domain. If frontend and API are
  // served from the SAME site, set COOKIE_SAMESITE=lax for stricter CSRF defence.
  AUTH_COOKIE_NAME: z.string().default('akb_session'),
  COOKIE_SAMESITE: z
    .enum(['lax', 'strict', 'none'])
    .optional()
    .transform((v) => v ?? (isProd ? 'none' : 'lax')),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => (v == null ? isProd : v === 'true' || v === '1')),
  // Bearer-header auth is off unless explicitly enabled (non-browser clients only).
  ALLOW_BEARER_AUTH: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  JWT_AUDIENCE: z.string().default('bakrey-crm-web'),

  // --- HTTP ---------------------------------------------------------------
  CLIENT_URL: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // --- Business policy (payroll / alerts) ---------------------------------
  EXPIRY_WARNING_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  LATE_TO_ABSENT_RATIO: z.coerce.number().int().min(1).max(30).default(3), // 3 lates = 1 day deduction
  OVERTIME_MULTIPLIER: z.coerce.number().min(1).max(5).default(1),

  UPLOAD_DIR: z.string().default('uploads'),
  // --- v3: loyalty ----------------------------------------------------------
  LOYALTY_STEP_PKR: z.coerce.number().positive().default(100), // earn points per this much paid
  LOYALTY_POINTS_PER_STEP: z.coerce.number().positive().default(1),
  LOYALTY_POINT_VALUE_PKR: z.coerce.number().positive().default(1), // redemption value of 1 point
  // --- v3: notifications ------------------------------------------------------
  APP_PUBLIC_URL: z.string().default('http://localhost:5173'), // used in invoice links
  NOTIFY_PROVIDER: z.enum(['none', 'twilio', 'meta']).default('none'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(), // e.g. whatsapp:+14155238886
  TWILIO_SMS_FROM: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(), // Meta WhatsApp Cloud API
  WHATSAPP_PHONE_ID: z.string().optional(),
  ADMIN_ALERT_PHONE: z.string().optional(), // daily digest recipient (WhatsApp)
  ADMIN_ALERT_EMAIL: z.string().optional(), // daily digest recipient (email)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  ALERT_DIGEST_ENABLED: z.string().default('false').transform((v) => v === 'true' || v === '1'),
  ALERT_DIGEST_TIME: z.string().default('09:00'), // HH:MM local server time
  // --- v3: backups --------------------------------------------------------------
  BACKUP_DIR: z.string().default('backups'),
  AUTO_BACKUP_ENABLED: z.string().default('false').transform((v) => v === 'true' || v === '1'),
  AUTO_BACKUP_TIME: z.string().default('02:00'),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  // Print every problem at once, then exit — do not start a half-configured API.
  console.error('\n❌ Invalid environment configuration:')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  console.error('\nCopy .env.example to .env and fill in real values. Never commit .env.\n')
  process.exit(1)
}

export const env = Object.freeze({
  ...parsed.data,
  isProd,
  isDev: !isProd,
  allowedOrigins: parsed.data.CLIENT_URL.split(',').map((o) => o.trim()).filter(Boolean),
})

export default env
