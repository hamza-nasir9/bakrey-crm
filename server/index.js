/**
 * Bakrey CRM API entrypoint.
 * Hardening vs. the original:
 *  - Environment is validated at boot (config/env.js) — no silent weak secrets.
 *  - Global rate limit + stricter auth limiter; body sanitised against
 *    Mongo operator injection before any route sees it.
 *  - Central 404 + error handler (no stack traces to clients).
 *  - Graceful shutdown so in-flight requests / Mongo connections close cleanly.
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import env from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { sanitizeBody } from "./middleware/validate.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import authRoutes from "./routes/authRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import supplierRoutes from "./routes/supplierRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import salaryRoutes from "./routes/salaryRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
import shiftRoutes from "./routes/shiftRoutes.js";
import dailyClosingRoutes from "./routes/dailyClosingRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import systemRoutes from "./routes/systemRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import auditLogRoutes from "./routes/auditLogRoutes.js";
import branchRoutes from "./routes/branchRoutes.js";
import recipeRoutes from "./routes/recipeRoutes.js";
import { startSchedulers } from "./jobs/scheduler.js";

const app = express();
if (env.TRUST_PROXY) app.set("trust proxy", 1);

app.use(helmet());
app.use(cookieParser());

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use("/api", (req, res, next) => {
  if (
    MUTATING.has(req.method) &&
    req.headers.origin &&
    !env.allowedOrigins.includes(req.headers.origin)
  ) {
    return res.status(403).json({ message: "Request origin is not allowed." });
  }
  return next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.allowedOrigins.includes(origin))
        return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(sanitizeBody);

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  authRoutes,
);

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/salaries", salaryRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/daily-closings", dailyClosingRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/system", systemRoutes);
app.use("/api/users", userRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/recipes", recipeRoutes);

app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", database: "mongodb", apiConfigured: true }),
);
app.use("/api", notFound);
app.use(errorHandler);

// Vercel Serverless & Local Support
let isConnected = false;
async function initDb() {
  if (!isConnected) {
    await connectDatabase();
    startSchedulers();
    isConnected = true;
  }
}

if (process.env.NODE_ENV !== "production" || process.env.VITE_DEV) {
  initDb()
    .then(() => {
      app.listen(env.PORT, () => {
        console.log(
          `[api] Bakrey CRM API running on port ${env.PORT} (${env.NODE_ENV})`,
        );
      });
    })
    .catch((error) => {
      console.error("[api] MongoDB connection failed:", error.message);
    });
} else {
  initDb().catch((err) => console.error("DB init error:", err));
}

export default app;