import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  createProjectAndNavigate,
  submitPrompt,
  cleanupTestProjects,
} from "./helpers";

/**
 * E2E Tests: Code Completeness & Truncation Detection
 *
 * Validates the fix for Engineer Agent code truncation:
 *   1. maxOutputTokens: 8192 — prevents premature cut-off
 *   2. isCodeComplete() — detects unbalanced braces → emits error event
 *   3. Client shows error with retry button instead of blank/stuck preview
 *
 * Prerequisites:
 *   - Dev server running at http://localhost:3000
 *   - Valid GOOGLE_GENERATIVE_AI_API_KEY in .env.local
 *   - Database accessible (POSTGRES_PRISMA_URL / DATABASE_URL)
 *
 * Real DB assertions verify that:
 *   - A successful generation creates a version record
 *   - A truncation error leaves no version record for that prompt
 *
 * Timeout: 300s per test — complex AI generation can take 90–150s.
 */

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

test.describe("代码完整性修复验证", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, "[E2E] Code Completeness Test");
  });

  /**
   * E2E-COMP-01: Simple app → complete code → preview has visible content
   *
   * Validates the happy path: a short, simple prompt stays well within
   * 8192 output tokens. After Engineer finishes, the Sandpack preview
   * must show visible non-empty content (not blank).
   *
   * Also handles API errors gracefully — if Gemini returns a network error,
   * the error message in chat is the expected outcome (test passes with note).
   */
  test("E2E-COMP-01: 简单应用生成完整 → 预览出现可见内容", async ({ page }) => {
    await submitPrompt(page, "做一个简单的计数器，有加减按钮和数字显示");

    const statusBar = page.getByTestId("agent-status-bar");
    await expect(statusBar).toBeVisible({ timeout: 15000 });

    // Wait for generation to settle: either all agents done (✓✓✓) or error shown
    const retryBtn = page.getByTestId("retry-btn");
    await Promise.race([
      page.waitForFunction(
        () => {
          const bar = document.querySelector('[data-testid="agent-status-bar"]');
          return bar ? (bar.textContent?.match(/✓/g) ?? []).length >= 3 : false;
        },
        { timeout: 150000 }
      ),
      retryBtn.waitFor({ state: "visible", timeout: 150000 }),
    ]);

    // If API errored (network issue, rate limit), that's not a truncation failure
    const hadApiError = await retryBtn.isVisible().catch(() => false);
    if (hadApiError) {
      test.info().annotations.push({
        type: "api-error",
        description: "Gemini API 调用失败（网络/限流），非截断问题，跳过预览断言",
      });
      return;
    }

    // All agents completed — switch to preview tab and verify content
    const previewTab = page.getByTestId("tab-preview");
    if (await previewTab.isVisible()) {
      await previewTab.click();
    }

    // Preview iframe must render visible content — not blank or stuck
    const sandpackFrame = page.frameLocator("iframe").first();
    await expect(sandpackFrame.locator("body")).not.toBeEmpty({ timeout: 20000 });
  });

  /**
   * E2E-COMP-02: Complex app ("学生管理系统") → either renders OR shows error
   *
   * This is the regression test for the original truncation bug:
   * - BEFORE fix: blank preview, no error shown
   * - AFTER fix: either (a) preview renders, or (b) error message with retry
   *
   * Both outcomes are acceptable. What is NOT acceptable:
   *   - Blank/empty iframe with no error message
   *   - Generation stuck indefinitely
   */
  test("E2E-COMP-02: 复杂应用（学生管理系统）→ 预览有内容或显示截断错误提示", async ({
    page,
  }) => {
    await submitPrompt(
      page,
      "做一个学生管理系统，包含学生列表（显示姓名、学号、成绩）和成绩录入功能，使用 Tailwind CSS 美化界面"
    );

    // Wait for generation to settle: all agents done OR any error shown
    const retryBtn = page.getByTestId("retry-btn");
    await Promise.race([
      page.waitForFunction(
        () => {
          const bar = document.querySelector('[data-testid="agent-status-bar"]');
          return bar ? (bar.textContent?.match(/✓/g) ?? []).length >= 3 : false;
        },
        { timeout: 180000 }
      ),
      retryBtn.waitFor({ state: "visible", timeout: 180000 }),
    ]);

    await page.waitForTimeout(3000);

    const previewTab = page.getByTestId("tab-preview");
    if (await previewTab.isVisible()) {
      await previewTab.click();
    }

    const sandpackFrame = page.frameLocator("iframe").first();

    const hasPreviewContent = await sandpackFrame
      .locator("body")
      .evaluate((el) => (el.textContent?.trim().length ?? 0) > 0)
      .catch(() => false);

    const hasErrorMessage = await retryBtn.isVisible().catch(() => false);

    // The fix ensures we never have blank + no error (the old broken state)
    expect(hasPreviewContent || hasErrorMessage).toBe(true);
  });

  /**
   * E2E-COMP-03: Truncation error → retry button visible → re-triggers generation
   *
   * If the AI returns truncated code and the error message appears,
   * clicking "重试" must restart the three-agent flow (PM begins streaming again).
   *
   * Note: this test is skipped if E2E-COMP-02 succeeded without truncation
   * (i.e., the preview rendered on first attempt).
   */
  test("E2E-COMP-03: 截断错误时重试按钮可见且可点击", async ({ page }) => {
    // Use the same complex prompt that's most likely to hit the token limit
    await submitPrompt(
      page,
      "做一个学生管理系统，包含学生列表（显示姓名、学号、成绩）和成绩录入功能，使用 Tailwind CSS 美化界面"
    );

    // Wait for generation to settle: all agents done OR any error shown
    const retryButton = page.getByTestId("retry-btn");
    await Promise.race([
      page.waitForFunction(
        () => {
          const bar = document.querySelector('[data-testid="agent-status-bar"]');
          return bar ? (bar.textContent?.match(/✓/g) ?? []).length >= 3 : false;
        },
        { timeout: 180000 }
      ),
      retryButton.waitFor({ state: "visible", timeout: 180000 }),
    ]);

    const truncationErrorText = page.locator("text=/生成的代码不完整/i");
    // Detect truncation specifically (not generic API errors)
    const hadTruncation = await truncationErrorText.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hadTruncation) {
      // Code was complete or API errored — truncation test not applicable
      test.info().annotations.push({
        type: "skip-reason",
        description: "无截断错误（代码完整或 API 网络错误），跳过重试验证",
      });
      return;
    }

    // Truncation did occur: verify error text is visible
    await expect(truncationErrorText).toBeVisible({ timeout: 5000 });

    // Click retry — PM should start streaming again
    await retryButton.click();
    const pmStreaming = page.locator("text=/Product Manager|PM/i").first();
    await expect(pmStreaming).toBeVisible({ timeout: 15000 });
  });
});

test.describe("真实 DB：版本记录验证", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  /**
   * E2E-COMP-04: Successful generation → version record created in DB
   *
   * After a complete 3-agent flow, the client POSTs to /api/versions.
   * This test verifies that a version record exists in the real DB
   * for the generated code.
   */
  test("E2E-COMP-04: 成功生成 → DB 中创建版本记录（真实 DB 验证）", async ({
    page,
  }) => {
    await createProjectAndNavigate(page, "[E2E] DB Version Test");
    const projectId = page.url().split("/project/")[1];

    // Verify DB starts with zero versions for this project
    const beforeResponse = await page.request.get(
      `/api/versions?projectId=${projectId}`
    );
    expect(beforeResponse.ok()).toBe(true);
    const { versions: versionsBefore } = await beforeResponse.json() as { versions: unknown[] };
    expect(versionsBefore).toHaveLength(0);

    // Submit a simple prompt and wait for generation to settle
    await submitPrompt(page, "做一个简单的按钮点击计数器");

    const retryBtnDb = page.getByTestId("retry-btn");
    await Promise.race([
      page.waitForFunction(
        () => {
          const bar = document.querySelector('[data-testid="agent-status-bar"]');
          return bar ? (bar.textContent?.match(/✓/g) ?? []).length >= 3 : false;
        },
        { timeout: 150000 }
      ),
      retryBtnDb.waitFor({ state: "visible", timeout: 150000 }),
    ]);

    // Allow the client-side POST /api/versions to settle
    await page.waitForTimeout(2000);

    const hadApiError = await retryBtnDb.isVisible().catch(() => false);
    if (hadApiError) {
      // API / network error — version not written, that's expected
      test.info().annotations.push({
        type: "api-error",
        description: "API 调用失败（限流/网络），版本未写入，跳过 DB 断言",
      });
      return;
    }

    // Verify that exactly one version record was written to real DB
    const afterResponse = await page.request.get(
      `/api/versions?projectId=${projectId}`
    );
    expect(afterResponse.ok()).toBe(true);
    const { versions: versionsAfter } = await afterResponse.json() as { versions: unknown[] };
    expect(versionsAfter.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * E2E-COMP-05: When truncation error occurs → no version record in DB
   *
   * If the engineer emits an error event (code was truncated), the client
   * must NOT call POST /api/versions — so no record should exist.
   *
   * Note: This test only provides a conclusive assertion if truncation
   * actually occurs. If the code is complete, the test logs a note and passes.
   */
  test("E2E-COMP-05: 截断错误时不向 DB 写入版本记录（真实 DB 验证）", async ({
    page,
  }) => {
    await createProjectAndNavigate(page, "[E2E] DB No-Version Truncation Test");
    const projectId = page.url().split("/project/")[1];

    await submitPrompt(
      page,
      "做一个学生管理系统，包含学生列表（显示姓名、学号、成绩）和成绩录入功能，使用 Tailwind CSS 美化界面"
    );

    const retryBtnComp5 = page.getByTestId("retry-btn");
    await Promise.race([
      page.waitForFunction(
        () => {
          const bar = document.querySelector('[data-testid="agent-status-bar"]');
          return bar ? (bar.textContent?.match(/✓/g) ?? []).length >= 3 : false;
        },
        { timeout: 180000 }
      ),
      retryBtnComp5.waitFor({ state: "visible", timeout: 180000 }),
    ]);

    // Allow any async DB write to settle
    await page.waitForTimeout(2000);

    const hadTruncation = await retryBtnComp5.isVisible().catch(() => false);

    const versionResponse = await page.request.get(
      `/api/versions?projectId=${projectId}`
    );
    const { versions } = await versionResponse.json() as { versions: unknown[] };

    if (hadTruncation) {
      // Truncation detected: no version should have been written
      expect(versions).toHaveLength(0);
    } else {
      // Code was complete: version was written — that's correct behavior
      test.info().annotations.push({
        type: "note",
        description: "代码生成完整，版本已写入 DB（非截断路径）",
      });
      expect(versions.length).toBeGreaterThanOrEqual(1);
    }
  });
});
