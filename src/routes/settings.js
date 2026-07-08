import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();

const currencySchema = z.object({
  currency: z.enum(["RON", "USD", "EUR"]),
});

router.use(authMiddleware);

router.get("/currency", async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { currency: true },
    });
    res.json({ currency: company?.currency ?? "RON" });
  } catch (err) {
    next(err);
  }
});

router.patch("/currency", validateBody(currencySchema), async (req, res, next) => {
  try {
    const company = await prisma.company.update({
      where: { id: req.user.companyId },
      data: { currency: req.body.currency },
      select: { id: true, name: true, slug: true, currency: true, logoUrl: true, primaryColor: true },
    });

    await prisma.auditLog.create({
      data: {
        companyId: req.user.companyId,
        userId: req.user.userId,
        action: "update",
        entityType: "Company",
        entityId: company.id,
        metadata: { currency: req.body.currency },
      },
    });

    res.json(company);
  } catch (err) {
    next(err);
  }
});

export default router;
