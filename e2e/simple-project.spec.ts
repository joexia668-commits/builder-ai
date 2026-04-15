import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  createProjectAndNavigate,
  submitPrompt,
  cleanupTestProjects,
} from "./helpers";

/**
 * E2E Regression: Simple Project Generation
 *
 * Verifies that a simple single-page app (calculator) can be generated
 * end-to-end: prompt → PM → Architect → Engineer → Sandpack preview.
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - Valid AI API key in .env.local
 * - Database accessible (POSTGRES_PRISMA_URL)
 *
 * Note: Makes real AI API calls. May take up to 120s.
 */

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

test("generates a calculator app", async ({ page }) => {
  await loginAsGuest(page);
  await createProjectAndNavigate(page, "[E2E] Simple Calculator");

  await submitPrompt(page, "做一个简单的计算器");

  // Wait for generation to complete — the preview iframe appears when Engineer finishes
  // and Sandpack boots the dev server
  const previewFrame = page.frameLocator("iframe").first();
  await expect(previewFrame.locator("body")).not.toBeEmpty({ timeout: 180000 });
});
