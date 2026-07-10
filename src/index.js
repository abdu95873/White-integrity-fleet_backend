import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import authRoutes from "./routes/auth.js";
import courierRoutes from "./routes/couriers.js";
import paymentRoutes from "./routes/payments.js";
import reportRoutes from "./routes/reports.js";
import accountsRoutes from "./routes/accounts.js";
import settingsRoutes from "./routes/settings.js";
import uploadRoutes from "./routes/uploads.js";
import courierImportRoutes from "./routes/courierImport.js";
import { errorHandler } from "./middleware/errorHandler.js";

// Local .env should win over stale shell env vars (e.g. after commenting DATABASE_URL).
dotenv.config({ override: process.env.VERCEL !== "1" });

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;

  const allowed = new Set([FRONTEND_URL, ...EXTRA_ORIGINS]);
  if (allowed.has(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    return hostname.endsWith(".vercel.app") || hostname === "localhost";
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "white-integrity-fleet-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/couriers", courierRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/courier-import", courierImportRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/settings", settingsRoutes);

app.use(errorHandler);

export default app;

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
}
