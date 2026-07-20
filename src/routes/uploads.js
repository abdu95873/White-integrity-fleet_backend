import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { parseExcelBuffer } from "../services/excelParser.js";
import { deletePaymentBatch, processExcelUpload } from "../services/paymentService.js";
import { formatPaymentRecord } from "../services/paymentFormat.js";
import { previewExcelUpload } from "../services/uploadPreviewService.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const uploadMetaSchema = z.object({
  source: z.enum(["glovo", "bolt"]),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

const overrideEntrySchema = z.object({
  commission: z.union([z.number(), z.string()]).optional(),
  tax: z.union([z.number(), z.string()]).optional(),
});

const overridesSchema = z.record(overrideEntrySchema);

function formatUploadResponse(result) {
  return {
    batch: {
      id: result.batch.id,
      source: result.batch.source,
      periodStart: result.batch.periodStart,
      periodEnd: result.batch.periodEnd,
      fileReference: result.batch.fileReference,
      uploadedAt: result.batch.uploadedAt,
    },
    recordsCreated: result.records.length,
    records: result.records.map((r) => {
      const formatted = formatPaymentRecord(r);
      return {
        id: formatted.id,
        courier: {
          id: r.courier.id,
          name: r.courier.name,
          externalId: r.courier.externalId,
          source: r.courier.source,
        },
        commissionUsed: formatted.commissionUsed,
        taxAmount: formatted.taxAmount,
        previousDueAmount: formatted.previousDueAmount,
        totalPayable: formatted.totalPayable,
        status: formatted.status,
      };
    }),
  };
}

async function parseUploadRequest(req) {
  if (!req.file) {
    throw new Error("Excel file is required");
  }

  const meta = uploadMetaSchema.parse({
    source: req.body.source,
    periodStart: req.body.periodStart,
    periodEnd: req.body.periodEnd,
  });

  const rows = await parseExcelBuffer(req.file.buffer, meta.source);
  if (rows.length === 0) {
    throw new Error("No valid courier rows found in file");
  }

  let overrides = {};
  if (req.body.overrides) {
    const parsed =
      typeof req.body.overrides === "string"
        ? JSON.parse(req.body.overrides)
        : req.body.overrides;
    overrides = overridesSchema.parse(parsed);
  }

  return { meta, rows, overrides, fileReference: req.file.originalname };
}

router.use(authMiddleware);

router.post("/preview", upload.single("file"), async (req, res, next) => {
  try {
    const { meta, rows } = await parseUploadRequest(req);

    const preview = await previewExcelUpload({
      companyId: req.user.companyId,
      source: meta.source,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
      rows,
    });

    res.json({
      ...preview,
      fileReference: req.file.originalname,
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: "Invalid overrides JSON" });
    }
    next(err);
  }
});

router.post("/", upload.single("file"), async (req, res, next) => {
  try {
    const { meta, rows, overrides, fileReference } = await parseUploadRequest(req);

    const result = await processExcelUpload({
      companyId: req.user.companyId,
      source: meta.source,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
      rows,
      fileReference,
      uploadedById: req.user.userId,
      overrides,
    });

    res.status(201).json(formatUploadResponse(result));
  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: "Invalid overrides JSON" });
    }
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
