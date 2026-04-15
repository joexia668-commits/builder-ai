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
  await loginAsGuest(page);
  await createProjectAndNavigate(page, "[E2E] Snake Game");

  await submitPrompt(page, "做一个贪吃蛇游戏");

  // Wait for generation to complete — preview iframe body should have content
  const previewFrame = page.frameLocator("iframe").first();
  await expect(previewFrame.locator("body")).not.toBeEmpty({ timeout: 180000 });

  // Verify the game renders a canvas element or a named game container
  // Snake games are typically implemented with <canvas> or a CSS-grid board div
  const gameCanvas = previewFrame.locator("canvas");
  const gameContainer = previewFrame.locator(
    "[class*='game'],[class*='snake'],[class*='board'],[id*='game'],[id*='snake']"
  );

  // At least one of: canvas or a game-named container must be present
  await expect(gameCanvas.or(gameContainer).first()).toBeVisible({
    timeout: 30000,
  });
});
