import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, signToken } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  companySlug: z.string().min(1).optional(),
});

router.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password, companySlug } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        email,
        ...(companySlug ? { company: { slug: companySlug } } : {}),
      },
      include: { company: true },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken({
      userId: user.id,
      companyId: user.companyId,
      email: user.email,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company: {
          id: user.company.id,
          name: user.company.name,
          slug: user.company.slug,
          logoUrl: user.company.logoUrl,
          primaryColor: user.company.primaryColor,
          currency: user.company.currency,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { company: true },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      company: {
        id: user.company.id,
        name: user.company.name,
        slug: user.company.slug,
        logoUrl: user.company.logoUrl,
        primaryColor: user.company.primaryColor,
        currency: user.company.currency,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
