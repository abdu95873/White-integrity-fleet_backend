import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { addCommissionRate, addTaxAmount, recalculatePendingPaymentsForCourier } from "../services/paymentService.js";
import { formatPaymentRecord } from "../services/paymentFormat.js";
import { buildCourierListQuery, summarizeCourierRow } from "../services/courierListService.js";
import {
  fetchCourierPaymentHistoryRows,
  toCsv,
  toExcel,
} from "../services/reportService.js";

const router = Router();

const listQuerySchema = z.object({
  source: z.enum(["glovo", "bolt"]).optional(),
  period: z.enum(["weekly", "monthly", "yearly"]).optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().min(2000).max(2100).optional(),
  weekEnd: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const commissionRateSchema = z.object({
  value: z.number().min(0).max(100),
  effectiveFrom: z.coerce.date().optional(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
});

const taxAmountSchema = z.object({
  value: z.number().min(0),
  effectiveFrom: z.coerce.date().optional(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
});

const paymentHistoryExportSchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("xlsx"),
});

router.use(authMiddleware);

router.get("/", validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery;
    const { where, range, periodPaymentFilter, page, limit } = buildCourierListQuery({
      ...query,
      companyId: req.user.companyId,
    });

    const [couriers, total] = await Promise.all([
      prisma.courier.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: "asc" },
        include: {
          commissionHistory: { where: { effectiveTo: null }, take: 1 },
          taxHistory: { where: { effectiveTo: null }, take: 1 },
          paymentRecords: periodPaymentFilter
            ? { where: periodPaymentFilter, include: { batch: true } }
            : { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      prisma.courier.count({ where }),
    ]);

    const hasPeriodFilter = Boolean(periodPaymentFilter);

    res.json({
      data: couriers.map((c) => summarizeCourierRow(c, hasPeriodFilter)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      ...(range
        ? { range: { start: range.start, end: range.end, label: range.label } }
        : {}),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/payment-history", validateQuery(paymentHistoryExportSchema), async (req, res, next) => {
  try {
    const { format } = req.validatedQuery;
    const { courier, rows } = await fetchCourierPaymentHistoryRows(
      req.params.id,
      req.user.companyId
    );
    const safeId = courier.externalId.replace(/[^a-zA-Z0-9_-]+/g, "-");
    const filename = `${safeId}-payment-history`;

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      return res.send(toCsv(rows));
    }

    const buffer = await toExcel(rows, "Payment History");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const courier = await prisma.courier.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: {
        commissionHistory: { orderBy: { effectiveFrom: "desc" } },
        taxHistory: { orderBy: { effectiveFrom: "desc" } },
        paymentRecords: {
          orderBy: { createdAt: "desc" },
          include: {
            batch: true,
            paymentActions: {
              include: { confirmedBy: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });

    if (!courier) return res.status(404).json({ error: "Courier not found" });

    res.json({
      ...courier,
      commissionHistory: courier.commissionHistory.map((r) => ({
        ...r,
        value: Number(r.value),
      })),
      taxHistory: courier.taxHistory.map((r) => ({
        ...r,
        value: Number(r.value),
      })),
      paymentRecords: courier.paymentRecords.map(formatPaymentRecord),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/recalculate-pending", async (req, res, next) => {
  try {
    const result = await recalculatePendingPaymentsForCourier(
      req.params.id,
      req.user.companyId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/commission", validateBody(commissionRateSchema), async (req, res, next) => {
  try {
    const record = await addCommissionRate({
      courierId: req.params.id,
      companyId: req.user.companyId,
      value: req.body.value,
      effectiveFrom: req.body.effectiveFrom,
      periodStart: req.body.periodStart,
      periodEnd: req.body.periodEnd,
      userId: req.user.userId,
    });
    res.status(201).json({ ...record, value: Number(record.value) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/tax", validateBody(taxAmountSchema), async (req, res, next) => {
  try {
    const record = await addTaxAmount({
      courierId: req.params.id,
      companyId: req.user.companyId,
      value: req.body.value,
      effectiveFrom: req.body.effectiveFrom,
      periodStart: req.body.periodStart,
      periodEnd: req.body.periodEnd,
      userId: req.user.userId,
    });
    res.status(201).json({ ...record, value: Number(record.value) });
  } catch (err) {
    next(err);
  }
});

export default router;
