import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { applyCorsHeaders } from "../middleware/cors.js";
import { parseCommissionListBuffer } from "../services/commissionListParser.js";
import {
  confirmCommissionImport,
  previewCommissionImport,
} from "../services/commissionImportService.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const importMetaSchema = z
  .object({
    source: z.enum(["glovo", "bolt"]),
    applyMode: z.enum(["current", "week"]).default("current"),
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.applyMode === "week" && (!data.periodStart || !data.periodEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Period start and end are required for weekly import",
        path: ["periodStart"],
      });
    }
  });

const overrideEntrySchema = z.object({
  commission: z.union([z.number(), z.string()]).optional(),
  tax: z.union([z.number(), z.string()]).optional(),
});

const overridesSchema = z.record(overrideEntrySchema);

async function parseImportRequest(req) {
  if (!req.file) {
    throw new Error("Excel file is required");
  }

  const meta = importMetaSchema.parse({
    source: req.body.source,
    applyMode: req.body.applyMode || "current",
    periodStart: req.body.periodStart || undefined,
    periodEnd: req.body.periodEnd || undefined,
  });

  const rows = await parseCommissionListBuffer(req.file.buffer, meta.source);

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
    const { meta, rows } = await parseImportRequest(req);
    const preview = await previewCommissionImport({
      companyId: req.user.companyId,
      source: meta.source,
      rows,
      applyMode: meta.applyMode,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
    });

    res.json({
      ...preview,
      fileReference: req.file.originalname,
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      applyCorsHeaders(req, res);
      return res.status(400).json({ error: "Invalid overrides JSON" });
    }
    next(err);
  }
});

router.post("/confirm", upload.single("file"), async (req, res, next) => {
  try {
    const { meta, rows, overrides } = await parseImportRequest(req);
    const result = await confirmCommissionImport({
      companyId: req.user.companyId,
      source: meta.source,
      rows,
      overrides,
      userId: req.user.userId,
      applyMode: meta.applyMode,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      applyCorsHeaders(req, res);
      return res.status(400).json({ error: "Invalid overrides JSON" });
    }
    next(err);
  }
});

export default router;
