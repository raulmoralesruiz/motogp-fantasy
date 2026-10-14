/**
 * Cliente Prisma (singleton). En dev, se guarda en globalThis para
 * sobrevivir al hot-reload de Next.js.
 */
import { PrismaClient } from "@prisma/client";

import { getServerEnv } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: getServerEnv().DATABASE_URL } },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
