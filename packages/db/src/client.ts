import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma 7 requires an explicit driver adapter for a direct database
 * connection — the constructor throws without one. `DATABASE_URL` is read
 * directly from `process.env` (not `@asm/config`) to match this file's
 * original scope; nothing else in this file needs full app-config
 * validation just to open a connection.
 */
const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });

/**
 * A single client per process. Next.js dev-server hot reload would otherwise
 * open a new pool on every edit until Postgres refuses connections.
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
