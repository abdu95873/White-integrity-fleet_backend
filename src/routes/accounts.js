import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { fetchAccountsSummary, fetchAllTimeAccounts, fetchOutstandingReceivables, fetchLatestPeriodDefaults } from "../services/accountsService.js";
import { recalculateAllPendingForCompany } from "../services/paymentService.js";

const router = Router();

const accountsQuerySchema = z.object({
  period: z.enum(["weekly", "monthly", "yearly"]).default("weekly"),
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().min(2000).max(2100).optional(),
  weekStart: z.string().optional(),
  weekEnd: z.string().optional(),
  source: z.enum(["glovo", "bolt"]).optional(),
});

router.use(authMiddleware);

router.get("/", validateQuery(accountsQuerySchema), async (req, res, next) => {
  try {
    const query = { ...req.validatedQuery };
    const companyId = req.user.companyId;

    if (query.period === "weekly" && !query.weekEnd) {
      const defaults = await fetchLatestPeriodDefaults(companyId);
      query.weekStart = defaults.weekStart;
      query.weekEnd = defaults.weekEnd;
    }

    const [periodData, allTime, outstandingReceivables, periodDefaults] = await Promise.all([
      fetchAccountsSummary({ companyId, ...query }),
      fetchAllTimeAccounts(companyId),
      fetchOutstandingReceivables(companyId),
      fetchLatestPeriodDefaults(companyId),
    ]);

    res.json({
      ...periodData,
      allTime,
      outstandingReceivables,
      periodDefaults,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/sync", async (req, res, next) => {
  try {
    const result = await recalculateAllPendingForCompany(req.user.companyId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
