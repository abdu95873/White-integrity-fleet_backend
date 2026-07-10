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
import { applyCorsHeaders, corsOptions } from "./middleware/cors.js";
import { errorHandler } from "./middleware/errorHandler.js";

// Local .env should win over stale shell env vars (e.g. after commenting DATABASE_URL).
dotenv.config({ override: process.env.VERCEL !== "1" });

const app = express();
const PORT = process.env.PORT || 5000;

app.use((req, res, next) => {
  applyCorsHeaders(req, res);
  next();
});
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "12mb" }));

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
