import { getCashierDashboardData, getDashboardData } from '../services/dashboardService.js'
export async function dashboardSummary(req, res, next) {
  try {
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily'
    // Role check is redundant with the route middleware but kept here as a
    // second guard so this controller is safe even if the route is ever
    // wired up differently in the future.
    if (req.auth.role !== 'CASHIER' /* ADMIN + MANAGER get the full dashboard */) return res.json(await getDashboardData(period))
    res.json(await getCashierDashboardData(req.auth.sub))
  } catch (error) { next(error) }
}

/**
 * GET /api/dashboard/analytics?range=daily|weekly|monthly
 * Sales + Net Profit time series for the dashboard charts (Recharts).
 * Financial data: Admin/Manager only (enforced at the route as well).
 */
import { getAnalyticsSeries } from '../services/analyticsSeriesService.js'
export async function dashboardAnalytics(req, res, next) {
  try {
    const range = ['daily', 'weekly', 'monthly'].includes(req.query.range) ? req.query.range : 'daily'
    res.json(await getAnalyticsSeries(range))
  } catch (error) { next(error) }
}
