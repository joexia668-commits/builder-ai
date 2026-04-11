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
    // Diagnostic: print which host:port this Prisma client is talking to,
    // so prod logs unambiguously show whether the Vercel env var update
    // took effect (e.g. 5432=session vs 6543=transaction pooler mode).
    console.log(
      `[prisma:diag] DATABASE_URL host=${url.hostname} port=${url.port || "<default>"}`
    );
  } catch {
    // malformed URL — use as-is
  }

  const pool = new pg.Pool({
    connectionString,
    // Tuned for Vercel serverless + Supabase pgbouncer:
    //   max=2        —— serverless instances run few concurrent requests; keep
    //                   low to avoid exhausting Supabase free-tier pooler slots.
    //   idle=5000    —— evict connections quickly so frozen-then-unfrozen
    //                   Lambda instances don't hand out stale TCP sockets that
    //                   pgbouncer has already dropped (root cause of the
    //                   observed "Connection terminated due to connection
    //                   timeout" errors on /api/messages writes).
    //   connect=10s  —— don't block the function's 60s wall on pool acquisition.
    //   allowExitOnIdle=true —— don't keep the event loop alive after the
    //                   response is sent; lets the function return cleanly.
    max: 2,
    min: 0,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
  });

  // Swallow async pool errors so a single bad socket doesn't crash the
  // serverless instance; Prisma will surface the error on the next query.
  pool.on("error", (err) => {
    console.error("[prisma] idle pg pool error:", err.message);
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
