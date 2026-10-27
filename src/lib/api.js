/**
 * API client — cookie-based auth.
 *
 * The JWT lives in an HttpOnly cookie set by the API (see
 * server/middleware/sessionCookie.js). JavaScript never sees, stores, or
 * sends the token manually:
 *  - `withCredentials: true` tells the browser to attach the cookie to every
 *    request (and to accept Set-Cookie responses), including cross-origin.
 *  - There is deliberately NO Authorization-header interceptor and NOTHING
 *    is written to localStorage — a token there would be readable by any
 *    script on the page (XSS = instant session theft).
 * Session state is restored on page load via GET /auth/me (see App.jsx).
 */
import axios from 'axios'

const configuredApiUrl = import.meta.env.VITE_API_URL

const api = axios.create({
  baseURL: configuredApiUrl || '/api', // dev: Vite proxy (vite.config.js) forwards /api -> localhost:4000
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // send/receive the HttpOnly session cookie automatically
  timeout: 30_000,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Session expired, revoked, or cookie missing — return to login.
      // (No local cleanup needed: there is no token stored on the client.)
      // The /auth/me session-restore probe handles its own 401 in App.jsx,
      // so it is excluded here to avoid a redirect during initial load.
      const isRestoreProbe = (error.config?.url || '').includes('/auth/me')
      if (!isRestoreProbe && window.location.pathname !== '/login') window.location.assign('/login')
    }
    if (!error.response && !configuredApiUrl && import.meta.env.PROD) {
      error.userMessage = 'The production API is not configured. Set VITE_API_URL to the deployed backend URL followed by /api, then redeploy the frontend.'
    } else if (!error.response) {
      error.userMessage = 'The API server is unreachable. Check the backend deployment and network access.'
    }
    return Promise.reject(error)
  },
)

export default api
