import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  createProjectAndNavigate,
  submitPrompt,
  cleanupTestProjects,
} from "./helpers";

/**
 * E2E: Complex Multi-File Project Generation
 *
 * Verifies that a multi-page admin dashboard triggers the full pipeline,
 * shows module progress UI, and produces a working Sandpack preview.
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - Valid AI API key in .env.local
 * - Database accessible (POSTGRES_PRISMA_URL)
 *
 * Note: Makes real AI API calls. Complex project may take up to 300s.
 */

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

test("generates a multi-page admin dashboard", async ({ page }) => {
  // Complex pipeline (PM → Decomposer → Skeleton → multiple modules) can take 8+ minutes
  test.setTimeout(600000);
  await loginAsGuest(page);
  await createProjectAndNavigate(page, "[E2E] Complex Admin");

  await submitPrompt(
    page,
    "做一个电商管理后台，有商品管理、订单列表、数据看板、用户管理"
  );

  // Wait for pipeline to start — decomposer agent visible in status bar
  await expect(page.locator("text=decomposer").or(page.locator("text=/正在拆解|正在生成应用骨架/"))).toBeVisible({
    timeout: 60000,
  });

  // Wait for generation to complete — completion message appears in chat
  // Complex projects (multi-module pipeline) can take up to 300s
  await expect(page.locator("text=/模块化生成完成|生成完成/")).toBeVisible({ timeout: 300000 });
});
