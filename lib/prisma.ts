// Prisma 7 uses driver adapters for database connections.
// Using @prisma/adapter-pg with conservative pool settings for Supabase.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

type PrismaClientType = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientType | undefined;
};

function createPrismaClient(): PrismaClientType {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[prisma] DATABASE_URL is not set — add it to Vercel environment variables"
    );
  }

  // Strip Prisma-only params that confuse the pg driver (pgbouncer, connection_limit, etc.)
  // Keep postgres-standard params like sslmode.
  const rawUrl = process.env.DATABASE_URL;
  let connectionString = rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete("pgbouncer");
    url.searchParams.delete("connection_limit");
    url.searchParams.delete("pool_timeout");
    connectionString = url.toString();
  } catch {
    // malformed URL — use as-is
  }

  const pool = new pg.Pool({
    connectionString,
    // Conservative pool settings — Supabase free tier limits direct connections
    max: 3,
    min: 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma: PrismaClientType =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
