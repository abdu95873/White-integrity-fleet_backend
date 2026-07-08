import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { parseExcelBuffer } from "../services/excelParser.js";
import { deletePaymentBatch, processExcelUpload } from "../services/paymentService.js";
import { formatPaymentRecord } from "../services/paymentFormat.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const uploadMetaSchema = z.object({
  source: z.enum(["glovo", "bolt"]),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

router.use(authMiddleware);

router.post("/", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Excel file is required" });
    }

    const meta = uploadMetaSchema.parse({
      source: req.body.source,
      periodStart: req.body.periodStart,
      periodEnd: req.body.periodEnd,
    });

    const rows = await parseExcelBuffer(req.file.buffer, meta.source);

    if (rows.length === 0) {
      return res.status(400).json({ error: "No valid courier rows found in file" });
    }

    const result = await processExcelUpload({
      companyId: req.user.companyId,
      source: meta.source,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
      rows,
      fileReference: req.file.originalname,
      uploadedById: req.user.userId,
    });

    res.status(201).json({
      batch: result.batch,
      recordsCreated: result.records.length,
      records: result.records.map((r) => {
        const formatted = formatPaymentRecord(r);
        return {
          id: formatted.id,
          courier: r.courier,
          periodCalculated: formatted.periodCalculated,
          commissionUsed: formatted.commissionUsed,
          taxUsed: formatted.taxUsed,
          commissionAmount: formatted.commissionAmount,
          taxAmount: formatted.taxAmount,
          calculatedGrandPayment: formatted.calculatedGrandPayment,
          previousDueAmount: formatted.previousDueAmount,
          totalPayable: formatted.totalPayable,
          status: formatted.status,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/batches", async (req, res, next) => {
  try {
    const source = req.query.source;
    const batches = await prisma.paymentBatch.findMany({
      where: {
        companyId: req.user.companyId,
        ...(source ? { source } : {}),
      },
      orderBy: { uploadedAt: "desc" },
      include: {
        _count: { select: { paymentRecords: true } },
        paymentRecords: { select: { status: true } },
      },
    });

    res.json(
      batches.map((batch) => ({
        id: batch.id,
        source: batch.source,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        uploadedAt: batch.uploadedAt,
        fileReference: batch.fileReference,
        recordCount: batch._count.paymentRecords,
        paidCount: batch.paymentRecords.filter((r) => r.status === "paid").length,
        pendingCount: batch.paymentRecords.filter((r) => r.status === "pending").length,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.delete("/batches/:id", async (req, res, next) => {
  try {
    const result = await deletePaymentBatch(
      req.params.id,
      req.user.companyId,
      req.user.userId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
