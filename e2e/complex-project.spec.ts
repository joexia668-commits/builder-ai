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
  await loginAsGuest(page);
  await createProjectAndNavigate(page, "[E2E] Complex Admin");

  await submitPrompt(
    page,
    "做一个电商管理后台，有商品管理、订单列表、数据看板、用户管理"
  );

  // Complex multi-file projects emit layer/module progress text
  // e.g. "模块 1/4" or "正在生成 3/6 个文件"
  const progressText = page.locator("text=/模块.*\\d+\\/\\d+/");
  await expect(progressText).toBeVisible({ timeout: 120000 });

  // Wait for Engineer to finish — preview iframe body should have content
  const previewFrame = page.frameLocator("iframe").first();
  await expect(previewFrame.locator("body")).not.toBeEmpty({ timeout: 300000 });
});
