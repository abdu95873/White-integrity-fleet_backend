import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { parseCommissionListBuffer } from "../src/services/commissionListParser.js";
import { confirmCommissionImport } from "../src/services/commissionImportService.js";

dotenv.config();

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.resolve(__dirname, "../../samples");

async function seedCouriers(companyId) {
  const files = [
    { source: "glovo", file: "glovo-commission-list.xlsx" },
    { source: "bolt", file: "bolt-commission-list.xlsx" },
  ];

  console.log("\nSeeding couriers from commission lists...");

  for (const { source, file } of files) {
    const filePath = path.join(samplesDir, file);
    if (!existsSync(filePath)) {
      console.log(`  Skipping ${file} (not found at ${filePath})`);
      continue;
    }

    const rows = await parseCommissionListBuffer(readFileSync(filePath), source);
    const result = await confirmCommissionImport({
      companyId,
      source,
      rows,
      userId: null,
    });

    console.log(
      `  ${source}: ${result.total} rows — ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged`
    );
  }
}

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

  await seedCouriers(company.id);

  const courierCount = await prisma.courier.count({ where: { companyId: company.id } });

  console.log("\nSeed complete:");
  console.log("  Admin:   admin@whiteintegrity.ro / admin123");
  console.log("  Manager: manager@whiteintegrity.ro / manager123");
  console.log("  Company slug: white-integrity-fleet");
  console.log(`  Couriers in DB: ${courierCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
