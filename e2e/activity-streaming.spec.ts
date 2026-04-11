import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  createProjectAndNavigate,
  cleanupTestProjects,
} from "./helpers";

test.describe("Activity tab streaming", () => {
  test.afterAll(async ({ browser }) => {
    await cleanupTestProjects(browser);
  });

  test("auto-activates and shows streaming files during engineer generation", async ({
    page,
  }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, "[E2E] activity streaming");

    // Submit a simple prompt
    await page.getByPlaceholder(/告诉 AI/).fill("做一个计数器，包含增加、减少和重置按钮");
    await page.keyboard.press("Enter");

    // Activity tab should auto-activate within 3 seconds of generation start
    await expect(page.getByTestId("tab-activity")).toBeVisible();
    await expect(page.getByTestId("activity-panel")).toBeVisible({ timeout: 5000 });

    // At least one file segment should appear with a path marker
    await expect(page.locator("[data-testid='activity-panel'] pre").first()).toBeVisible({
      timeout: 30000,
    });

    // Wait for generation to complete (engineer can take 90s+ for full pipeline)
    await expect(page.getByTestId("tab-activity").locator(".animate-pulse")).toBeHidden({
      timeout: 180_000,
    });

    // Auto-switch back to Preview tab within 5s after completion
    await expect(page.locator("iframe")).toBeVisible({ timeout: 10_000 });
  });
});
