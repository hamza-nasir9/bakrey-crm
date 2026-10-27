/**
 * Single source of truth for Role-Based Access Control (RBAC).
 *
 * Roles
 * -----
 * ADMIN   — owner. Everything, including users, payroll payment, system
 *           settings/backups, voiding payments and locking daily closings.
 * MANAGER — NEW in this upgrade. Runs the shop day-to-day: inventory,
 *           suppliers, customers, orders, attendance and reports.
 *           Cannot: manage users, pay/void salaries, change system
 *           settings, void payments, or edit prices/costs on inventory.
 * CASHIER — front counter, scoped to their own open shift. Can book
 *           orders, take payments and mark attendance during a shift.
 *           Cannot: see purchase costs, other cashiers' orders, reports,
 *           payroll, expenses, or any admin/manager screen.
 *
 * Routes declare the *permission* they need, not a role list, so changing
 * who can do what is a one-line edit here — not a hunt through 16 route files.
 */

export const ROLES = Object.freeze({ ADMIN: 'ADMIN', MANAGER: 'MANAGER', CASHIER: 'CASHIER' })
export const ALL_ROLES = Object.freeze(Object.values(ROLES))

export const PERMISSIONS = Object.freeze({
  // Dashboard / inventory
  DASHBOARD_VIEW: 'dashboard:view',
  INVENTORY_VIEW: 'inventory:view',
  INVENTORY_MANAGE: 'inventory:manage', // create/edit/delete items, purchases, usage, adjustments
  INVENTORY_VIEW_COST: 'inventory:view-cost', // purchase prices / margins
  ALERTS_VIEW: 'alerts:view',

  // Sales
  SUPPLIERS_VIEW: 'suppliers:view',
  SUPPLIERS_MANAGE: 'suppliers:manage',
  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_MANAGE: 'customers:manage',
  ORDERS_VIEW: 'orders:view',
  ORDERS_CREATE: 'orders:create',
  ORDERS_UPDATE: 'orders:update',
  ORDERS_CANCEL: 'orders:cancel',
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_CREATE: 'payments:create',
  PAYMENTS_VOID: 'payments:void',

  // People / payroll
  EMPLOYEES_MANAGE: 'employees:manage',
  ATTENDANCE_VIEW: 'attendance:view',
  ATTENDANCE_MARK: 'attendance:mark',
  ATTENDANCE_MANAGE: 'attendance:manage',
  SALARIES_VIEW: 'salaries:view',
  SALARIES_MANAGE: 'salaries:manage', // create / pay / void

  // Finance / ops
  EXPENSES_MANAGE: 'expenses:manage',
  SHIFTS_VIEW: 'shifts:view',
  SHIFTS_MANAGE: 'shifts:manage', // schedule / reopen
  CLOSINGS_MANAGE: 'closings:manage',
  REPORTS_VIEW: 'reports:view',

  // System
  USERS_MANAGE: 'users:manage',
  SYSTEM_MANAGE: 'system:manage', // settings + backups
  NOTIFICATIONS_VIEW: 'notifications:view',
})

const P = PERMISSIONS

/** Role → permission set. Frozen so nothing can mutate it at runtime. */
export const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: new Set(Object.values(P)), // admin gets everything by construction

  MANAGER: new Set([
    P.DASHBOARD_VIEW,
    P.INVENTORY_VIEW, P.INVENTORY_MANAGE, P.INVENTORY_VIEW_COST, P.ALERTS_VIEW,
    P.SUPPLIERS_VIEW, P.SUPPLIERS_MANAGE,
    P.CUSTOMERS_VIEW, P.CUSTOMERS_MANAGE,
    P.ORDERS_VIEW, P.ORDERS_CREATE, P.ORDERS_UPDATE, P.ORDERS_CANCEL,
    P.PAYMENTS_VIEW, P.PAYMENTS_CREATE, // note: no PAYMENTS_VOID
    P.EMPLOYEES_MANAGE,
    P.ATTENDANCE_VIEW, P.ATTENDANCE_MARK, P.ATTENDANCE_MANAGE,
    P.SALARIES_VIEW, // can view payroll, cannot create/pay/void it
    P.EXPENSES_MANAGE,
    P.SHIFTS_VIEW, P.SHIFTS_MANAGE,
    P.REPORTS_VIEW,
    P.NOTIFICATIONS_VIEW,
    // deliberately excluded: USERS_MANAGE, SALARIES_MANAGE, CLOSINGS_MANAGE, SYSTEM_MANAGE
  ]),

  CASHIER: new Set([
    P.DASHBOARD_VIEW,
    P.INVENTORY_VIEW, P.ALERTS_VIEW, // view only, and costs are stripped in the controller
    P.SUPPLIERS_VIEW,
    P.CUSTOMERS_VIEW,
    P.ORDERS_VIEW, P.ORDERS_CREATE, P.ORDERS_UPDATE, P.ORDERS_CANCEL, // own orders only (controller-enforced)
    P.PAYMENTS_VIEW, P.PAYMENTS_CREATE,
    P.ATTENDANCE_MARK, // during own open shift only (controller-enforced)
    P.SHIFTS_VIEW,
    P.NOTIFICATIONS_VIEW,
  ]),
})

export function roleHasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false
}

export default ROLE_PERMISSIONS
