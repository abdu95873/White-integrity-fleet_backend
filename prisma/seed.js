import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { slug: "white-integrity-fleet" },
    update: { currency: "RON" },
    create: {
      name: "White Integrity Fleet",
      slug: "white-integrity-fleet",
      primaryColor: "#ffffff",
      currency: "RON",
    },
  });

  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: {
      companyId_email: {
        companyId: company.id,
        email: "admin@whiteintegrity.ro",
      },
    },
    update: {},
    create: {
      companyId: company.id,
      email: "admin@whiteintegrity.ro",
      passwordHash,
      name: "Admin User",
      role: "admin",
    },
  });

  await prisma.user.upsert({
    where: {
      companyId_email: {
        companyId: company.id,
        email: "manager@whiteintegrity.ro",
      },
    },
    update: {},
    create: {
      companyId: company.id,
      email: "manager@whiteintegrity.ro",
      passwordHash: await bcrypt.hash("manager123", 10),
      name: "Manager User",
      role: "manager",
    },
  });

  console.log("Seed complete:");
  console.log("  Admin:   admin@whiteintegrity.ro / admin123");
  console.log("  Manager: manager@whiteintegrity.ro / manager123");
  console.log("  Company slug: white-integrity-fleet");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
