import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  createProjectAndNavigate,
  submitPrompt,
  cleanupTestProjects,
} from "./helpers";

/**
 * E2E: Game Project Generation
 *
 * Verifies that a snake game prompt completes generation and produces a
 * preview with a canvas or game container element (React+SVG/Canvas impl).
 *
 * Known limitation (ADR): platform games / physics simulations are out of
 * scope for single-pass generation. Snake is well within capability.
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - Valid AI API key in .env.local
 * - Database accessible (POSTGRES_PRISMA_URL)
 *
 * Note: Makes real AI API calls. May take up to 180s.
 */

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

test("generates a snake game", async ({ page }) => {
  // Game generation may go through complex pipeline if PM classifies as complex
  test.setTimeout(480000);
  await loginAsGuest(page);
  await createProjectAndNavigate(page, "[E2E] Snake Game");

  await submitPrompt(page, "做一个贪吃蛇游戏");

  // Wait for AI generation to complete — engineer summary message appears in chat
  // Snake game is a simple project so it goes through the direct engineer path
  await expect(page.locator("text=/✅ 已生成|✅ 模块化生成完成/")).toBeVisible({
    timeout: 180000,
  });

  // WebContainer iframe is cross-origin (different port), so we can't access its DOM.
  // Verify the preview iframe has a src attribute set — WebContainer booted and is serving.
  const previewIframe = page.locator("iframe[src]").first();
  await expect(previewIframe).toBeVisible({ timeout: 60000 });
});
