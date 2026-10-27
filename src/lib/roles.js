/**
 * Frontend mirror of the backend RBAC matrix (server/security/permissions.js).
 * This only controls what the UI *shows* — the API enforces everything for real.
 * Keep the two in sync when you change a rule.
 */
export const ROUTE_ROLES = {
  '/dashboard': ['ADMIN', 'MANAGER', 'CASHIER'],
  '/inventory': ['ADMIN', 'MANAGER', 'CASHIER'],
  '/suppliers': ['ADMIN', 'MANAGER', 'CASHIER'],
  '/customers': ['ADMIN', 'MANAGER', 'CASHIER'],
  '/orders': ['ADMIN', 'MANAGER', 'CASHIER'],
  '/payments': ['ADMIN', 'MANAGER', 'CASHIER'],
  '/attendance': ['ADMIN', 'MANAGER', 'CASHIER'],
  '/shifts': ['ADMIN', 'MANAGER', 'CASHIER'],
  '/employees': ['ADMIN', 'MANAGER'],
  '/expenses': ['ADMIN', 'MANAGER'],
  '/reports': ['ADMIN', 'MANAGER'],
  '/salaries': ['ADMIN', 'MANAGER'], // manager = view only; API blocks create/pay/void
  '/audit-logs': ['ADMIN', 'MANAGER'],
  '/branches': ['ADMIN', 'MANAGER'],
  '/recipes': ['ADMIN', 'MANAGER'],
  '/daily-closing': ['ADMIN'],
  '/system': ['ADMIN'],
  '/users': ['ADMIN'],
}

export const canAccess = (user, path) => {
  const roles = ROUTE_ROLES[path]
  return !roles || (Boolean(user) && roles.includes(user.role))
}

export const isPrivileged = (user) => user?.role === 'ADMIN' || user?.role === 'MANAGER'
