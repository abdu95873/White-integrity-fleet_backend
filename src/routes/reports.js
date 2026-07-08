import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { fetchReportData, getDashboardStats, resolveDateRange, toCsv, toExcel } from "../services/reportService.js";

const router = Router();

const reportQuerySchema = z.object({
  period: z.enum(["weekly", "monthly", "yearly"]).default("monthly"),
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().min(2000).max(2100).optional(),
  weekEnd: z.coerce.date().optional(),
  source: z.enum(["glovo", "bolt"]).optional(),
  courierId: z.string().optional(),
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
});

router.use(authMiddleware);

router.get("/dashboard", async (req, res, next) => {
  try {
    const stats = await getDashboardStats(req.user.companyId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

router.get("/", validateQuery(reportQuerySchema), async (req, res, next) => {
  try {
    const { period, month, year, weekEnd, source, courierId, format } = req.validatedQuery;

    const result = await fetchReportData({
      companyId: req.user.companyId,
      period,
      month,
      year,
      weekEnd,
      source,
      courierId,
    });

    const { label } = resolveDateRange({ period, month, year, weekEnd });
    const { rows, range } = result;

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="report-${label}.csv"`);
      return res.send(toCsv(rows));
    }

    if (format === "xlsx") {
      const buffer = await toExcel(rows);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="report-${label}.xlsx"`);
      return res.send(buffer);
    }

    res.json({ period, month, year, range, count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
