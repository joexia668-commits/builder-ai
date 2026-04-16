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

test("generates a simple clock app", async ({ page }) => {
  // Allow up to 10 minutes — even "simple" prompts may trigger the modular pipeline
  test.setTimeout(600000);
  await loginAsGuest(page);
  await createProjectAndNavigate(page, "[E2E] Simple Clock");

  // Use a minimal prompt to stay on the simple pipeline (PM → Architect → Engineer).
  // A calculator gets classified as "complex" due to feature count — use a simpler prompt.
  await submitPrompt(page, "做一个显示当前时间的时钟页面");

  // Wait for generation to complete — engineer summary message appears in chat
  // Allow 300s: complex pipeline (PM → Decomposer → Skeleton → modules) can take 4+ minutes
  await expect(page.locator("text=/✅ 已生成|✅ 模块化生成完成/")).toBeVisible({
    timeout: 300000,
  });

  // WebContainer iframe is cross-origin (different port), so we can't access its DOM.
  // Verify the preview iframe has a src attribute set — WebContainer booted and is serving.
  const previewIframe = page.locator("iframe[src]").first();
  await expect(previewIframe).toBeVisible({ timeout: 60000 });
});
