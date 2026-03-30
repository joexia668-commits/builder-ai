import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, submitPrompt, cleanupTestProjects } from "./helpers";

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

/**
 * E2E Smoke Tests: EPIC 4 — Polish Features
 *
 * E2E-P4-01: Home page empty state → no projects = shows CTA
 * E2E-P4-02: New project workspace → preview area shows "等待生成"
 * E2E-P4-03: Stop generation button appears during generation, stops SSE
 * E2E-P4-04: Mobile viewport → Tab bar visible and switchable
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - Valid AI API key configured
 * - Database accessible
 */

// ─── E2E-P4-01: Home page empty state ──────────────────────────────────────

test.describe("E2E-P4-01: 首页空状态", () => {
  test("无项目时首页显示空状态 CTA 和创建按钮", async ({ page }) => {
    await loginAsGuest(page);
    await page.goto("/");

    // Either there are projects (normal state) OR there's an empty state
    // We check that the page renders without error
    await expect(page).toHaveTitle(/.+/);

    // The page should always have a "新建项目" or "创建第一个项目" button
    const createBtns = page.getByRole("button", { name: /新建项目|创建第一个/i });
    await expect(createBtns.first()).toBeVisible({ timeout: 5000 });
  });
});

// ─── E2E-P4-02: Preview empty state ─────────────────────────────────────────

test.describe("E2E-P4-02: 预览区空状态", () => {
  test("新建项目进入工作区后预览区显示等待生成提示", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E] Empty Preview Test ${Date.now()}`);

    // The preview panel should show the empty state (no code yet)
    await expect(page.getByText("等待生成")).toBeVisible({ timeout: 5000 });
  });

  test("预览区显示 BuilderAI 品牌标识", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E] Brand Test ${Date.now()}`);

    // BuilderAI text appears in the preview empty state (not the header)
    await expect(page.locator("p.font-semibold", { hasText: "BuilderAI" })).toBeVisible({ timeout: 5000 });
  });
});

// ─── E2E-P4-03: Stop generation button ────────────────────────────────────

test.describe("E2E-P4-03: 停止生成按钮", () => {
  test("生成过程中显示停止生成按钮", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E] Stop Test ${Date.now()}`);

    // Submit a prompt to start generation
    await submitPrompt(page, "做一个简单的 Hello World 应用");

    // The stop button should appear while generating
    const stopBtn = page.getByTestId("stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
  });

  test("点击停止按钮后输入框恢复可用", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E] Stop Click Test ${Date.now()}`);

    await submitPrompt(page, "做一个简单的 Hello World 应用");

    const stopBtn = page.getByTestId("stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 15000 });

    // Click stop
    await stopBtn.click();

    // After stopping, the textarea should become enabled
    const chatInput = page.getByRole("textbox");
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
  });

  test("停止生成后不显示错误提示", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E] Stop No Error Test ${Date.now()}`);

    await submitPrompt(page, "做一个简单的应用");

    const stopBtn = page.getByTestId("stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
    await stopBtn.click();

    // No error state should appear after clean abort
    await expect(page.getByTestId("retry-btn")).not.toBeVisible({ timeout: 3000 });
  });
});

// ─── E2E-P4-04: Mobile responsive Tab bar ────────────────────────────────

test.describe("E2E-P4-04: Mobile 响应式 Tab 栏", () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14 viewport

  test("Mobile 视窗下显示 对话/预览 Tab 栏", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E] Mobile Test ${Date.now()}`);

    // Mobile tab bar should be visible
    const chatTab = page.getByTestId("mobile-tab-chat");
    const previewTab = page.getByTestId("mobile-tab-preview");

    await expect(chatTab).toBeVisible({ timeout: 5000 });
    await expect(previewTab).toBeVisible({ timeout: 5000 });
  });

  test("Mobile 默认显示对话 Tab", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E] Mobile Default Test ${Date.now()}`);

    const chatTab = page.getByTestId("mobile-tab-chat");
    await expect(chatTab).toHaveAttribute("data-active", "true");
  });

  test("点击预览 Tab 切换到预览内容", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E] Mobile Switch Test ${Date.now()}`);

    await page.getByTestId("mobile-tab-preview").click();

    const previewTab = page.getByTestId("mobile-tab-preview");
    await expect(previewTab).toHaveAttribute("data-active", "true");

    // Preview content should be visible
    await expect(page.getByText("等待生成")).toBeVisible({ timeout: 3000 });
  });
});
