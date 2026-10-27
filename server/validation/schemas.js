/**
 * Zod schemas for the highest-risk endpoints (auth, orders, inventory,
 * attendance, salaries). Applied with `validate()` from middleware/validate.js.
 * Unknown keys are stripped, strings trimmed, numbers coerced — controllers
 * receive clean data only. Extend the same pattern to the remaining modules.
 */
import { z, zodId, zodMoney } from '../middleware/validate.js'

const trimmed = (max = 200) => z.string().trim().min(1).max(max)
const optionalTrimmed = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''))

export const loginSchema = z.object({
  username: trimmed(50),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER']),
  password: z.string().min(1).max(200).optional(),
  pin: z.union([z.string().regex(/^\d{4,8}$/), z.number()]).optional(),
})

export const createOrderSchema = z.object({
  bookingDate: z.string().min(1, 'Booking Date is required'),
  deliveryDate: z.string().optional().or(z.literal('')),
  customer: zodId.optional().or(z.literal('')),
  newCustomer: z
    .object({ name: optionalTrimmed(100), phone: optionalTrimmed(30), whatsapp: optionalTrimmed(30), address: optionalTrimmed(300), city: optionalTrimmed(100) })
    .optional(),
  items: z
    .array(
      z.object({
        inventoryItem: zodId,
        quantity: z.coerce.number().finite().positive('Quantity must be positive'),
        unitPrice: zodMoney,
      }),
    )
    .min(1, 'Select at least one item'),
  advancePaid: zodMoney.default(0),
  paymentMethod: z.enum(['Cash', 'Bank', 'JazzCash', 'EasyPaisa', 'Other']),
  // v3: selling branch, loyalty redemption, admin credit-limit override.
  branch: zodId.optional().or(z.literal('')),
  loyaltyRedeemPoints: z.coerce.number().int().min(0).default(0),
  allowCreditOverride: z.boolean().optional(),
  // AUDIT FIX: 'Delivered' at creation bypassed stock deduction entirely and
  // 'Cancelled' at creation made no sense — delivery must go through PATCH so
  // stock is issued atomically (orderStockService). Matches the UI form.
  status: z.enum(['Pending', 'Confirmed', 'Completed']).default('Pending'),
  notes: optionalTrimmed(1000),
})

export const updateOrderSchema = z.object({
  deliveryDate: z.string().optional(),
  notes: optionalTrimmed(1000),
  status: z.enum(['Pending', 'Confirmed', 'Completed', 'Delivered', 'Cancelled']).optional(),
  paymentMethod: z.enum(['Cash', 'Bank', 'JazzCash', 'EasyPaisa', 'Other']).optional(),
})

export const createInventoryItemSchema = z.object({
  itemName: trimmed(120),
  category: trimmed(80),
  quantity: z.coerce.number().finite().min(0).default(0),
  unit: z.enum(['Kg', 'Piece', 'Bag', 'Liter']),
  lowStockThreshold: z.coerce.number().finite().min(0).default(0),
  expiryDate: z.string().optional().or(z.literal('')), // ISO date; blank = no expiry
  batchNo: optionalTrimmed(80),
  imageUrl: optionalTrimmed(500),
  goatDetails: z.record(z.string(), z.unknown()).optional(),
})

export const attendanceSchema = z.object({
  employee: zodId,
  attendanceDate: z.string().min(1),
  status: z.enum(['Present', 'Absent', 'Leave', 'Half Day', 'Late']), // 'Late' is new — payroll-aware
  checkInTime: optionalTrimmed(20),
  checkOutTime: optionalTrimmed(20),
  workingHours: z.coerce.number().finite().min(0).max(24).default(0),
  overtimeHours: z.coerce.number().finite().min(0).max(24).default(0),
  attendanceNotes: optionalTrimmed(500),
})

export const salaryPreviewQuerySchema = z.object({
  employee: zodId,
  period: z.enum(['Daily', 'Weekly', 'Monthly']),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  bonus: z.coerce.number().finite().min(0).optional(),
  deduction: z.coerce.number().finite().min(0).optional(),
  overtimeAmount: z.coerce.number().finite().min(0).optional(),
})
