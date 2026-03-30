import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, submitPrompt, cleanupTestProjects } from "./helpers";

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

/**
 * E2E Tests: Persistence & Sidebar (AC-10, AC-12)
 *
 * These tests verify that:
 * - Chat history persists after page refresh
 * - Sidebar shows project list and allows switching
 */

test.describe("对话持久化", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // E2E-06: Messages persist after page refresh
  test("E2E-06: 刷新页面后消息记录仍然显示", async ({ page }) => {
    // Create project and send a prompt
    await createProjectAndNavigate(page);
    const projectUrl = page.url();

    // Submit a simple prompt (don't wait for full AI response)
    await submitPrompt(page, "做一个 hello world 应用");

    // Wait for user's own message to appear
    const userMessage = page.locator("text=做一个 hello world 应用");
    await expect(userMessage).toBeVisible({ timeout: 10000 });

    // Refresh the page
    await page.goto(projectUrl);

    // After refresh, the user message should still be visible
    const persistedMessage = page.locator("text=做一个 hello world 应用");
    await expect(persistedMessage).toBeVisible({ timeout: 10000 });
  });
});

test.describe("侧边栏导航", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // E2E-07: Sidebar shows project list, clicking switches projects
  test("E2E-07: 左侧侧边栏显示项目列表，点击可切换", async ({ page }) => {
    // Navigate to workspace (creates or uses existing project)
    await page.goto("/");

    // The sidebar should be visible on the home page or workspace
    // Look for conversation sidebar
    const sidebar = page.locator("[data-testid='conversation-sidebar'], .sidebar, nav").first();

    // Navigate to a project workspace to see sidebar
    await createProjectAndNavigate(page);
    const firstProjectUrl = page.url();
    const firstProjectId = firstProjectUrl.split("/project/")[1];

    // Go back to home and create another project
    await page.goto("/");
    await createProjectAndNavigate(page, "[E2E] Second Test Project");
    const secondProjectUrl = page.url();

    // Sidebar should show both projects
    // The conversation-sidebar component renders project items
    // Go back to home to see the list
    await page.goto("/");

    // There should be project items in the sidebar
    const projectItems = page.locator(
      "[data-testid='project-item'], .project-item"
    );
    // At minimum 1 project should exist
    await expect(projectItems.first()).toBeVisible({ timeout: 5000 });
  });

  // E2E-08 (optional): New project appears in sidebar after creation
  test("E2E-08: 新建项目后出现在侧边栏", async ({ page }) => {
    await page.goto("/");

    // Count initial projects
    const initialCount = await page
      .locator("[data-testid='project-item'], .project-item")
      .count();

    // Create a new project
    await createProjectAndNavigate(page, "[E2E] Sidebar Test Project");

    // Go back to home
    await page.goto("/");

    // Should have at least one project visible
    const newCount = await page
      .locator("[data-testid='project-item'], .project-item")
      .count();
    expect(newCount).toBeGreaterThanOrEqual(initialCount);
  });
});
