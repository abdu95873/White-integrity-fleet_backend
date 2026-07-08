import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { confirmPayment } from "../services/paymentService.js";
import { formatPaymentRecord } from "../services/paymentFormat.js";
import { resolveDateRange } from "../services/reportService.js";

const router = Router();

const listQuerySchema = z.object({
  status: z.enum(["pending", "paid"]).optional(),
  batchId: z.string().optional(),
  courierId: z.string().optional(),
  source: z.enum(["glovo", "bolt"]).optional(),
  search: z.string().optional(),
  period: z.enum(["weekly", "monthly", "yearly"]).optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().min(2000).max(2100).optional(),
  weekEnd: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const confirmSchema = z.object({
  notes: z.string().optional(),
});

router.use(authMiddleware);

router.get("/", validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const { status, batchId, courierId, source, search, period, month, year, weekEnd, page, limit } =
      req.validatedQuery;

    let batchFilter = {};
    if (period) {
      const { start, end } = resolveDateRange({ period, month, year, weekEnd });
      batchFilter = {
        periodStart: { lte: end },
        periodEnd: { gte: start },
      };
    }

    const where = {
      courier: {
        companyId: req.user.companyId,
        ...(source ? { source } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { externalId: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      ...(status ? { status } : {}),
      ...(batchId ? { batchId } : {}),
      ...(courierId ? { courierId } : {}),
      ...(Object.keys(batchFilter).length ? { batch: batchFilter } : {}),
    };

    const [records, total] = await Promise.all([
      prisma.paymentRecord.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          courier: true,
          batch: true,
          paymentActions: {
            include: { confirmedBy: { select: { id: true, name: true, email: true } } },
          },
        },
      }),
      prisma.paymentRecord.count({ where }),
    ]);

    const range = period ? resolveDateRange({ period, month, year, weekEnd }) : null;

    res.json({
      data: records.map(formatPaymentRecord),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      ...(range ? { range: { start: range.start, end: range.end, label: range.label } } : {}),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/confirm", validateBody(confirmSchema), async (req, res, next) => {
  try {
    const record = await confirmPayment({
      paymentRecordId: req.params.id,
      confirmedById: req.user.userId,
      companyId: req.user.companyId,
      notes: req.body.notes,
    });

    res.json(formatPaymentRecord(record));
  } catch (err) {
    next(err);
  }
});

export default router;
