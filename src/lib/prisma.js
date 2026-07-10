import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

function createClient(databaseUrl) {
  if (!databaseUrl) {
    return new PrismaClient();
  }

  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
}

function resolveDirectUrl() {
  if (process.env.DIRECT_URL) {
    return process.env.DIRECT_URL;
  }

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (databaseUrl.includes("-pooler.")) {
    return databaseUrl.replace("-pooler.", ".");
  }

  return databaseUrl;
}

export const prisma = globalForPrisma.prisma ?? createClient();

const directUrl = resolveDirectUrl();
export const prismaDirect =
  globalForPrisma.prismaDirect ??
  (directUrl && directUrl !== process.env.DATABASE_URL
    ? createClient(directUrl)
    : prisma);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDirect = prismaDirect;
}
