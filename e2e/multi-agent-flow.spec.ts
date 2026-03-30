import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, submitPrompt, cleanupTestProjects } from "./helpers";

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

/**
 * E2E Tests: Multi-Agent Flow (AC-1, AC-2, AC-3, AC-6, AC-9)
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - Valid GOOGLE_GENERATIVE_AI_API_KEY or GROQ_API_KEY in .env.local
 * - Database accessible (POSTGRES_PRISMA_URL)
 *
 * Note: These tests make real AI API calls. They may take 30–120 seconds.
 * Use PLAYWRIGHT_BASE_URL env var to override the default base URL.
 */

test.describe("Multi-Agent 协作流程", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page);
  });

  // E2E-01: PM message bubble appears first after prompt submission
  test("E2E-01: 提交 prompt 后首先出现 PM 消息气泡", async ({ page }) => {
    await submitPrompt(page, "做一个简单的计数器应用");

    // PM message should appear first — look for PM agent identifier
    // The agent-message component shows the agent role name
    const pmMessage = page.locator("text=Product Manager").first();
    await expect(pmMessage).toBeVisible({ timeout: 20000 });
  });

  // E2E-02: Handoff message appears after PM completes
  test("E2E-02: PM 完成后出现移交给架构师的文字", async ({ page }) => {
    await submitPrompt(page, "做一个简单的计数器应用");

    // Wait for the handoff transition text to appear
    // This is rendered by the chat area after PM streams its output
    const handoffText = page.locator(
      "text=/PM.*移交.*架构师|已将需求文档移交/i"
    );
    await expect(handoffText).toBeVisible({ timeout: 60000 });
  });

  // E2E-03: Handoff message appears after Architect completes
  test("E2E-03: Arch 完成后出现移交给工程师的文字", async ({ page }) => {
    await submitPrompt(page, "做一个简单的计数器应用");

    const handoffText = page.locator(
      "text=/架构师.*移交.*工程师|已将技术方案移交/i"
    );
    await expect(handoffText).toBeVisible({ timeout: 90000 });
  });

  // E2E-04: Preview iframe contains React component content after Engineer completes
  test("E2E-04: Engineer 完成后预览 iframe 中出现 React 组件内容", async ({
    page,
  }) => {
    await submitPrompt(page, "做一个简单的计数器应用");

    // Wait for engineer to finish (may take up to 90s for full 3-agent flow)
    // The preview frame iframe should have srcdoc content
    const previewFrame = page.frameLocator("iframe").first();

    // Wait for some content in the preview
    await expect(previewFrame.locator("body")).not.toBeEmpty({
      timeout: 120000,
    });
  });

  // E2E-05: Top status bar shows agent state changes in sequence
  test("E2E-05: 顶部状态栏三个 Agent 卡片状态依次变化", async ({ page }) => {
    await submitPrompt(page, "做一个简单的计数器应用");

    // Initially, PM should become active (thinking or streaming)
    // The status bar shows agent cards — check for active state
    // Agent cards show their role names
    const statusBar = page.getByTestId("agent-status-bar");
    await expect(statusBar).toBeVisible({ timeout: 10000 });

    // Verify all three agent names are shown in the status bar
    await expect(statusBar.locator("text=Product Manager")).toBeVisible();
    await expect(statusBar.locator("text=System Architect")).toBeVisible();
    await expect(statusBar.locator("text=Full-Stack Engineer")).toBeVisible();

    // Wait for PM to reach done state (✓ appears)
    await expect(statusBar.locator("text=✓").first()).toBeVisible({
      timeout: 60000,
    });
  });
});
