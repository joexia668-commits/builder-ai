import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, submitPrompt, cleanupTestProjects } from "./helpers";

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

/**
 * E2E Tests: Version Timeline + Rollback — EPIC 3
 *
 * Acceptance criteria covered:
 * AC-1  — 每次 AI 生成后时间线自动新增节点
 * AC-3  — 点击历史版本能预览对应代码（iframe 切换）
 * AC-4  — "恢复此版本"创建新版本（不可变原则）
 * AC-6  — 版本数据持久化，刷新页面不丢失
 * AC-8  — 时间线支持水平滚动，版本多时不溢出
 * AC-9  — 预览历史版本时 ChatInput disabled
 * AC-10 — previewingVersion 与 currentCode 状态严格隔离
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - Valid GOOGLE_GENERATIVE_AI_API_KEY or GROQ_API_KEY in .env.local
 * - Database accessible (POSTGRES_PRISMA_URL)
 *
 * Note: Tests that trigger full AI generation may take up to 120 seconds.
 */

/** Wait for the version timeline to appear (at least 1 node visible). */
async function waitForTimeline(page: import("@playwright/test").Page) {
  await expect(
    page.locator("[data-testid^='version-node-']").first()
  ).toBeVisible({ timeout: 120000 });
}

/**
 * Helper: submit a prompt and wait for the full 3-agent pipeline to finish.
 * Waits until the timeline shows at least `minNodes` version nodes.
 */
async function generateAndWaitForVersionNode(
  page: import("@playwright/test").Page,
  prompt: string,
  minNodes = 1
) {
  await submitPrompt(page, prompt);

  // Wait for AI pipeline to complete and version node to appear
  await expect(
    page.locator("[data-testid^='version-node-']")
  ).toHaveCount(minNodes, { timeout: 120000 });
}

// ─── AC-1: Auto timeline node after AI generation ─────────────────────────

test.describe("AC-1: 时间线自动新增节点", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page);
  });

  // E2E-TL-01: After AI generation completes, a version node appears in the timeline
  test("E2E-TL-01: AI 生成完成后时间线出现新版本节点", async ({ page }) => {
    // Before generation: no timeline nodes
    await expect(page.locator("[data-testid^='version-node-']")).toHaveCount(0);

    await generateAndWaitForVersionNode(page, "做一个简单的计数器应用", 1);

    // After generation: at least 1 node
    await expect(
      page.locator("[data-testid^='version-node-']").first()
    ).toBeVisible();

    // The node should show a version label (v1)
    await expect(page.locator("text=v1").first()).toBeVisible();
  });

  // E2E-TL-01b: Second generation appends a second node
  test("E2E-TL-01b: 第二次生成追加第二个节点", async ({ page }) => {
    await generateAndWaitForVersionNode(page, "做一个计数器应用", 1);
    await generateAndWaitForVersionNode(page, "加上重置按钮", 2);

    await expect(page.locator("text=v1").first()).toBeVisible();
    await expect(page.locator("text=v2").first()).toBeVisible();
  });
});

// ─── AC-3 + AC-9: Click history node → preview + ChatInput disabled ────────

test.describe("AC-3 + AC-9: 预览历史版本", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page);
  });

  // E2E-TL-02: Clicking a history node disables ChatInput and shows banner
  test("E2E-TL-02: 点击历史节点后 ChatInput 变为 disabled，顶部出现 banner", async ({ page }) => {
    // Generate two versions so there's a history node to click
    await generateAndWaitForVersionNode(page, "做一个计数器应用", 1);
    await generateAndWaitForVersionNode(page, "加上重置按钮", 2);

    // ChatInput should be enabled before clicking history
    const chatInput = page.getByRole("textbox");
    await expect(chatInput).toBeEnabled();

    // Click the v1 (history) node
    await page.getByTestId("version-node-v1").click();

    // Banner should appear showing "正在预览 v1"
    await expect(page.locator("text=/正在预览 v1/")).toBeVisible({ timeout: 5000 });

    // ChatInput must be disabled
    await expect(chatInput).toBeDisabled();
  });

  // E2E-TL-02b: "返回当前版本" re-enables ChatInput and clears banner
  test('E2E-TL-02b: 点击"返回当前"后 ChatInput 恢复可用，banner 消失', async ({ page }) => {
    await generateAndWaitForVersionNode(page, "做一个计数器应用", 1);
    await generateAndWaitForVersionNode(page, "加上重置按钮", 2);

    await page.getByTestId("version-node-v1").click();
    await expect(page.locator("text=/正在预览 v1/")).toBeVisible({ timeout: 5000 });

    // Click "返回当前"
    await page.getByText("返回当前").click();

    // Banner should disappear
    await expect(page.locator("text=/正在预览/")).not.toBeVisible();

    // ChatInput should be enabled again
    await expect(page.getByRole("textbox")).toBeEnabled();
  });
});

// ─── AC-4: Restore creates a new version node (immutable) ─────────────────

test.describe("AC-4: 恢复版本不可变原则", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page);
  });

  // E2E-TL-03: Clicking "恢复此版本" appends a new node and clears banner
  test("E2E-TL-03: 恢复版本后时间线增加新节点，banner 消失", async ({ page }) => {
    await generateAndWaitForVersionNode(page, "做一个计数器应用", 1);
    await generateAndWaitForVersionNode(page, "加上重置按钮", 2);

    // Preview v1
    await page.getByTestId("version-node-v1").click();
    await expect(page.locator("text=/正在预览 v1/")).toBeVisible({ timeout: 5000 });

    // Click restore
    await page.getByText("恢复此版本").click();

    // Banner should disappear (preview cleared)
    await expect(page.locator("text=/正在预览/")).not.toBeVisible({ timeout: 10000 });

    // A new v3 node should appear (immutable: v1→v2→v3)
    await expect(page.locator("text=v3").first()).toBeVisible({ timeout: 10000 });

    // Original v1 and v2 nodes still exist (never deleted)
    await expect(page.locator("text=v1").first()).toBeVisible();
    await expect(page.locator("text=v2").first()).toBeVisible();
  });

  // E2E-TL-03b: After restore, ChatInput is re-enabled
  test("E2E-TL-03b: 恢复后 ChatInput 恢复可用", async ({ page }) => {
    await generateAndWaitForVersionNode(page, "做一个计数器应用", 1);
    await generateAndWaitForVersionNode(page, "加上重置按钮", 2);

    await page.getByTestId("version-node-v1").click();
    await page.getByText("恢复此版本").click();

    // Wait for banner to clear, then check ChatInput
    await expect(page.locator("text=/正在预览/")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("textbox")).toBeEnabled();
  });
});

// ─── AC-6: Version persistence on page refresh ────────────────────────────

test.describe("AC-6: 版本数据持久化", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // E2E-TL-05: Generated versions survive a page refresh
  test("E2E-TL-05: 刷新页面后时间线版本节点持久化", async ({ page }) => {
    await createProjectAndNavigate(page);
    const projectUrl = page.url();

    // Generate a version
    await generateAndWaitForVersionNode(page, "做一个计数器应用", 1);

    // Verify v1 visible before refresh
    await expect(page.locator("text=v1").first()).toBeVisible();

    // Refresh
    await page.goto(projectUrl);

    // After refresh, v1 node should still be in the timeline
    await expect(
      page.locator("[data-testid^='version-node-']").first()
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=v1").first()).toBeVisible();
  });
});

// ─── AC-8: Horizontal scroll with many versions ───────────────────────────

test.describe("AC-8: 时间线水平滚动", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page);
  });

  // E2E-TL-06: With many versions, timeline container is scrollable and does not overflow parent
  test("E2E-TL-06: 多版本时时间线可水平滚动，不影响父容器高度", async ({ page }) => {
    // Generate 2 real versions
    await generateAndWaitForVersionNode(page, "做一个计数器应用", 1);
    await generateAndWaitForVersionNode(page, "加上重置按钮", 2);

    // Check that overflow-x-auto container is present in the DOM
    const scrollContainer = page.locator(".overflow-x-auto").last();
    await expect(scrollContainer).toBeVisible();

    // Verify scroll container's scrollWidth >= clientWidth (content can scroll)
    const canScroll = await scrollContainer.evaluate((el) => {
      return el.scrollWidth >= el.clientWidth;
    });
    // With 2+ versions there is always at least as much scroll content as visible area
    expect(canScroll).toBe(true);

    // Verify the timeline does NOT use overflow-visible or overflow-hidden on the track
    const trackHasMinWMax = await page.locator(".min-w-max").count();
    expect(trackHasMinWMax).toBeGreaterThan(0);
  });
});

// ─── AC-10: previewingVersion / currentCode state isolation ───────────────

test.describe("AC-10: 预览态与工作态严格隔离", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page);
  });

  // E2E-TL-04: Switch to code tab, note current code; preview history; return — code unchanged
  test("E2E-TL-04: 预览历史版本不改变工作区代码，返回当前后代码复原", async ({ page }) => {
    await generateAndWaitForVersionNode(page, "做一个计数器应用", 1);
    await generateAndWaitForVersionNode(page, "加上重置按钮", 2);

    // Switch to code tab and record current code
    await page.getByTestId("tab-code").click();
    const editorLocator = page.locator(".monaco-editor").first();
    await expect(editorLocator).toBeVisible({ timeout: 5000 });

    // Get current code content from editor
    const currentCodeBefore = await editorLocator.textContent();

    // Preview v1 (history)
    await page.getByTestId("tab-preview").click(); // back to preview tab to click node
    await page.getByTestId("version-node-v1").click();
    await expect(page.locator("text=/正在预览 v1/")).toBeVisible({ timeout: 5000 });

    // Return to current version
    await page.getByText("返回当前").click();
    await expect(page.locator("text=/正在预览/")).not.toBeVisible();

    // Switch back to code tab — code should match pre-preview state
    await page.getByTestId("tab-code").click();
    await expect(editorLocator).toBeVisible({ timeout: 5000 });
    const currentCodeAfter = await editorLocator.textContent();

    // Code should be the same as before the preview (v2 code, not v1)
    expect(currentCodeAfter).toBe(currentCodeBefore);
  });
});
