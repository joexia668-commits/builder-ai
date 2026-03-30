import { config } from "dotenv";
import { resolve } from "path";

// Load .env before anything else
config({ path: resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

/**
 * Playwright globalSetup — runs once before any test starts.
 * Deletes all leftover [E2E] projects from previous runs so the
 * database starts each run clean.
 */
async function globalSetup() {
  const rawUrl = process.env.DATABASE_URL ?? "";
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

  const pool = new pg.Pool({ connectionString, max: 1 });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const { count } = await prisma.project.deleteMany({
      where: { name: { startsWith: "[E2E]" } },
    });
    if (count > 0) {
      console.log(`[global-setup] Removed ${count} stale [E2E] project(s) from previous runs`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

export default globalSetup;
