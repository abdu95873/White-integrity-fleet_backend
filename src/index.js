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
import { errorHandler } from "./middleware/errorHandler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "white-integrity-fleet-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/couriers", courierRoutes);
app.use("/api/uploads", uploadRoutes);
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
