import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import {
  buildPaymentChartExcel,
  buildPaymentChartPdf,
} from "../services/paymentChartExportService.js";
import { fetchReportData, getDashboardStats, resolveDateRange, toCsv, toExcel } from "../services/reportService.js";

const router = Router();

const reportQuerySchema = z.object({
  period: z.enum(["weekly", "monthly", "yearly"]).default("monthly"),
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().min(2000).max(2100).optional(),
  weekEnd: z.coerce.date().optional(),
  source: z.enum(["glovo", "bolt"]).optional(),
  courierId: z.string().optional(),
  format: z.enum(["json", "csv", "xlsx", "pdf", "chart-xlsx"]).default("json"),
});

function buildFileLabel({ source, period, month, year, weekEnd, suffix }) {
  const { fileLabel } = resolveDateRange({ period, month, year, weekEnd });
  const platform = source ? `${source.toUpperCase()}-` : "";
  return `${platform}payment-chart-${fileLabel}.${suffix}`;
}

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

    if ((format === "pdf" || format === "chart-xlsx") && !source) {
      return res.status(400).json({
        error: "Platform (glovo or bolt) is required for payment chart export",
      });
    }

    const result = await fetchReportData({
      companyId: req.user.companyId,
      period,
      month,
      year,
      weekEnd,
      source,
      courierId,
    });

    const { fileLabel } = resolveDateRange({ period, month, year, weekEnd });
    const { rows, range } = result;

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="report-${fileLabel}.csv"`);
      return res.send(toCsv(rows));
    }

    if (format === "xlsx") {
      const buffer = await toExcel(rows);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="report-${fileLabel}.xlsx"`);
      return res.send(buffer);
    }

    if (format === "pdf" || format === "chart-xlsx") {
      const company = await prisma.company.findUnique({
        where: { id: req.user.companyId },
        select: { name: true },
      });

      const chartParams = {
        source,
        companyName: company?.name || "White Fleet",
        range,
        rows,
        reportDate: new Date(),
      };

      if (format === "pdf") {
        const buffer = await buildPaymentChartPdf(chartParams);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${buildFileLabel({ source, period, month, year, weekEnd, suffix: "pdf" })}"`
        );
        return res.send(buffer);
      }

      const buffer = await buildPaymentChartExcel(chartParams);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${buildFileLabel({ source, period, month, year, weekEnd, suffix: "xlsx" })}"`
      );
      return res.send(buffer);
    }

    res.json({ period, month, year, range, count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
