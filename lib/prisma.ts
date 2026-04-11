// Prisma 7 uses driver adapters for database connections.
// Using @prisma/adapter-pg with conservative pool settings for Supabase.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Regex matching transient network/pg errors worth retrying.
// Supavisor (Supabase's pooler) occasionally drops sockets mid-query even
// in transaction mode on free tier; pg-pool then fails to acquire a fresh
// connection within the timeout, producing the two-layer error
//   "Connection terminated due to connection timeout"
//     caused by "Connection terminated unexpectedly"
// Both messages contain "Connection terminated", so one pattern covers it.
const TRANSIENT_DB_ERROR_RE =
  /Connection terminated|ECONNRESET|socket hang up|write EPIPE|ETIMEDOUT/i;

function createBasePrismaClient() {
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

/**
 * Wrap a base Prisma client with a $extends query interceptor that retries
 * every operation up to 3 times on transient DB connection errors. Matches
 * `Connection terminated`, `ECONNRESET`, `socket hang up`, etc. All other
 * errors pass through untouched on the first attempt.
 *
 * Backoff: 100ms → 200ms → 400ms, plus up to 50ms jitter, to give Supavisor
 * a moment to evict the dead socket and hand out a fresh one.
 */
function withConnectionRetry<T extends PrismaClient>(base: T) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query, model, operation }) {
          const maxAttempts = 3;
          let lastErr: unknown;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              return await query(args);
            } catch (err) {
              lastErr = err;
              const msg = err instanceof Error ? err.message : "";
              const isTransient = TRANSIENT_DB_ERROR_RE.test(msg);
              if (attempt === maxAttempts || !isTransient) throw err;
              console.warn(
                `[prisma:retry] ${model}.${operation} attempt ${attempt}/${maxAttempts} after transient error: ${msg}`
              );
              const delay =
                100 * Math.pow(2, attempt - 1) + Math.random() * 50;
              await new Promise((r) => setTimeout(r, delay));
            }
          }
          throw lastErr;
        },
      },
    },
  });
}

// Create once, extend once. The extended client is what the rest of the app
// imports — TypeScript infers the extended type automatically.
const basePrismaClient = createBasePrismaClient();
const extendedPrismaClient = withConnectionRetry(basePrismaClient);

type ExtendedPrismaClient = typeof extendedPrismaClient;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma: ExtendedPrismaClient =
  globalForPrisma.prisma ?? extendedPrismaClient;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
