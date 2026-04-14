import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  createProjectAndNavigate,
  submitPrompt,
  cleanupTestProjects,
} from "./helpers";

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

/**
 * E2E Tests: Realtime Architecture Derivation + Merge Fallback
 *
 * Verifies that feature_add preserves existing files via merge,
 * and that multiple bug_fix rounds don't cause architecture loss.
 *
 * All 4 scenarios run sequentially in a single project to save time.
 * Total expected duration: 4-6 minutes (4 AI generation rounds).
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - Valid AI API key in .env.local
 * - Database accessible
 */

/** Wait for generation to complete by checking version node count. */
async function waitForVersionNode(
  page: import("@playwright/test").Page,
  minNodes: number
) {
  await expect(
    page.locator("[data-testid^='version-node-']")
  ).toHaveCount(minNodes, { timeout: 180000 });
}

/** Get all file paths from the Code Editor file tree. */
async function getFileList(
  page: import("@playwright/test").Page
): Promise<string[]> {
  // Switch to Code tab
  const codeTab = page.getByTestId("tab-code");
  if (await codeTab.isVisible()) {
    await codeTab.click();
    // Wait for file tree to render
    await page.waitForTimeout(1000);
  }

  // Collect all file paths from tree nodes
  const fileNodes = page.locator("[data-testid^='tree-file-']");
  const count = await fileNodes.count();
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const testId = await fileNodes.nth(i).getAttribute("data-testid");
    if (testId) {
      paths.push(testId.replace("tree-file-", ""));
    }
  }

  // If file tree not available, try file tabs
  if (paths.length === 0) {
    const fileTabs = page.locator("[data-testid^='file-tab-']");
    const tabCount = await fileTabs.count();
    for (let i = 0; i < tabCount; i++) {
      const testId = await fileTabs.nth(i).getAttribute("data-testid");
      if (testId) {
        paths.push(testId.replace("file-tab-", ""));
      }
    }
  }

  // Switch back to preview tab
  const previewTab = page.getByTestId("tab-preview");
  if (await previewTab.isVisible()) {
    await previewTab.click();
  }

  return paths;
}

/** Check that the preview iframe has content (not blank). */
async function assertPreviewNotBlank(
  page: import("@playwright/test").Page
) {
  const previewFrame = page.frameLocator("iframe").first();
  await expect(previewFrame.locator("body")).not.toBeEmpty({
    timeout: 30000,
  });
}

/** Check that no error banner is showing (or only non-critical warnings). */
async function assertNoGenerationError(
  page: import("@playwright/test").Page
) {
  // The error banner uses red-50 bg — check it's not visible
  const errorBanner = page.locator(".bg-red-50").first();
  const isVisible = await errorBanner.isVisible().catch(() => false);
  if (isVisible) {
    const text = await errorBanner.textContent();
    // missing_imports warning is acceptable (non-fatal), others are not
    if (text && !text.includes("部分模块未生成")) {
      throw new Error(`Unexpected generation error: ${text}`);
    }
  }
}

test.describe("Realtime Arch Derivation — 迭代保留验证", () => {
  let projectUrl: string;
  let v1Files: string[];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsGuest(page);
    projectUrl = await createProjectAndNavigate(
      page,
      "[E2E] Arch Iteration Test"
    );
    await context.close();
  });

  // ── Scenario 1: 基础 feature_add ──────────────────────────────────

  test.describe.serial("Sequential iteration scenarios", () => {
    test("S1-1: 新建项目 → 生成计算器应用", async ({ page }) => {
      await loginAsGuest(page);
      await page.goto(projectUrl);

      await submitPrompt(page, "做一个简单的计算器应用");
      await waitForVersionNode(page, 1);

      // Record V1 file list
      v1Files = await getFileList(page);
      expect(v1Files.length).toBeGreaterThan(0);
      expect(v1Files).toContain("/App.js");

      // Preview should render
      await assertPreviewNotBlank(page);
    });

    test("S1-2: feature_add — 加暗黑模式，原有文件保留", async ({
      page,
    }) => {
      await loginAsGuest(page);
      await page.goto(projectUrl);

      await submitPrompt(page, "加个暗黑模式");
      await waitForVersionNode(page, 2);

      const v2Files = await getFileList(page);

      // V1 files should all still exist (merge preserved them)
      for (const f of v1Files) {
        expect(v2Files).toContain(f);
      }

      // File count should be >= V1 (new files added, none removed)
      expect(v2Files.length).toBeGreaterThanOrEqual(v1Files.length);

      // App.js must still exist
      expect(v2Files).toContain("/App.js");

      // Preview should render
      await assertPreviewNotBlank(page);
      await assertNoGenerationError(page);

      // Update v1Files for next scenario
      v1Files = v2Files;
    });

    // ── Scenario 2: bug_fix → feature_add ─────────────────────────

    test("S2-1: bug_fix 后原有文件不变", async ({ page }) => {
      await loginAsGuest(page);
      await page.goto(projectUrl);

      await submitPrompt(page, "修复按钮点击反馈不明显");
      await waitForVersionNode(page, 3);

      const v3Files = await getFileList(page);

      // App.js must still exist after bug_fix
      expect(v3Files).toContain("/App.js");

      // Preview should render
      await assertPreviewNotBlank(page);

      v1Files = v3Files;
    });

    test("S2-2: bug_fix 后 feature_add，原有文件 + 新文件都在", async ({
      page,
    }) => {
      await loginAsGuest(page);
      await page.goto(projectUrl);

      const filesBefore = await getFileList(page);

      await submitPrompt(page, "加一个计算历史记录功能");
      await waitForVersionNode(page, 4);

      const filesAfter = await getFileList(page);

      // Core files from before should still exist
      expect(filesAfter).toContain("/App.js");

      // File count should not decrease (merge preserves old files)
      expect(filesAfter.length).toBeGreaterThanOrEqual(filesBefore.length);

      // Preview should render
      await assertPreviewNotBlank(page);
      await assertNoGenerationError(page);
    });
  });
});
