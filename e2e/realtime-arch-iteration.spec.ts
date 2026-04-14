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
 * All scenarios run sequentially in a single project.
 * Total expected duration: 5-8 minutes (5+ AI generation rounds).
 *
 * Captures:
 * - Network requests to /api/generate (agent, context)
 * - Console warnings (pipeline diagnostics)
 * - File lists from Code Editor
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
  const codeTab = page.getByTestId("tab-code");
  if (await codeTab.isVisible()) {
    await codeTab.click();
    await page.waitForTimeout(1000);
  }

  const fileNodes = page.locator("[data-testid^='tree-file-']");
  const count = await fileNodes.count();
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const testId = await fileNodes.nth(i).getAttribute("data-testid");
    if (testId) {
      paths.push(testId.replace("tree-file-", ""));
    }
  }

  // Fallback: try file tabs
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

/** Check no fatal generation error (missing_imports warning is tolerated). */
async function assertNoFatalError(
  page: import("@playwright/test").Page
) {
  const errorBanner = page.locator(".bg-red-50").first();
  const isVisible = await errorBanner.isVisible().catch(() => false);
  if (isVisible) {
    const text = await errorBanner.textContent();
    // missing_imports is a non-fatal warning; others are fatal
    if (text && !text.includes("部分模块未生成")) {
      throw new Error(`Fatal generation error: ${text}`);
    }
  }
}

interface CapturedRequest {
  agent: string;
  context?: string;
  triageMode?: boolean;
}

/** Set up network + console listeners and return captured data. */
function setupCapture(page: import("@playwright/test").Page) {
  const requests: CapturedRequest[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  page.on("request", (req) => {
    if (req.url().includes("/api/generate") && req.method() === "POST") {
      try {
        const body = req.postDataJSON();
        requests.push({
          agent: body.agent,
          context: body.context,
          triageMode: body.triageMode,
        });
      } catch {
        // Non-JSON body, skip
      }
    }
  });

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "warning") warnings.push(text);
    if (msg.type() === "error") errors.push(text);
  });

  return { requests, warnings, errors };
}

test.describe("Realtime Arch Derivation — 全场景迭代验证", () => {
  let projectUrl: string;

  test.describe.serial("Sequential iteration in single project", () => {
    // Shared state across sequential tests
    let v1FileCount = 0;
    let v1Files: string[] = [];

    // ── S1: 新建项目 + 生成 ────────────────────────────────────────

    test("S1: 新建项目 → 生成计算器应用", async ({ page }) => {
      await loginAsGuest(page);
      projectUrl = await createProjectAndNavigate(
        page,
        "[E2E] Arch Iteration Test"
      );

      const { requests } = setupCapture(page);

      await submitPrompt(page, "做一个简单的计算器应用");
      await waitForVersionNode(page, 1);

      v1Files = await getFileList(page);
      v1FileCount = v1Files.length;

      // Basic sanity
      expect(v1FileCount).toBeGreaterThan(0);
      expect(v1Files).toContain("/App.js");
      await assertPreviewNotBlank(page);

      // Verify full pipeline ran (PM + Architect + Engineer)
      const agents = requests.map((r) => r.agent);
      expect(agents).toContain("pm");
      expect(agents).toContain("architect");
      expect(agents).toContain("engineer");
    });

    // ── S2: feature_add（暗黑模式） ────────────────────────────────

    test("S2: feature_add — 加暗黑模式，原有文件保留", async ({ page }) => {
      await loginAsGuest(page);
      await page.goto(projectUrl);

      const { requests, warnings } = setupCapture(page);

      await submitPrompt(page, "加个暗黑模式");
      await waitForVersionNode(page, 2);

      const v2Files = await getFileList(page);

      // Merge verification: all V1 files should still exist
      for (const f of v1Files) {
        expect(v2Files).toContain(f);
      }
      expect(v2Files.length).toBeGreaterThanOrEqual(v1FileCount);
      expect(v2Files).toContain("/App.js");

      // Architect should have received real-time arch context
      const archReq = requests.find((r) => r.agent === "architect");
      expect(archReq?.context).toContain("从代码实时分析");

      // Pipeline warnings should include file lists
      const pipelineLog = warnings.find((w) => w.includes("[pipeline]"));
      expect(pipelineLog).toBeDefined();

      // Preview renders without fatal error
      await assertPreviewNotBlank(page);
      await assertNoFatalError(page);

      // Update shared state
      v1Files = v2Files;
      v1FileCount = v2Files.length;
    });

    // ── S3: bug_fix → 验证文件不变 ─────────────────────────────────

    test("S3: bug_fix — 修复后文件保留", async ({ page }) => {
      await loginAsGuest(page);
      await page.goto(projectUrl);

      const { requests } = setupCapture(page);

      await submitPrompt(page, "修复按钮点击反馈不明显");
      await waitForVersionNode(page, 3);

      const v3Files = await getFileList(page);

      // App.js must survive bug_fix
      expect(v3Files).toContain("/App.js");

      // bug_fix uses direct path — no PM or Architect
      const agents = requests.map((r) => r.agent);
      expect(agents).not.toContain("pm");
      expect(agents).not.toContain("architect");

      await assertPreviewNotBlank(page);

      v1Files = v3Files;
      v1FileCount = v3Files.length;
    });

    // ── S4: bug_fix 后 feature_add — merge 兜底 ───────────────────

    test("S4: bug_fix 后 feature_add — 原有文件 + 新文件都在", async ({
      page,
    }) => {
      await loginAsGuest(page);
      await page.goto(projectUrl);

      const { requests } = setupCapture(page);
      const filesBefore = v1Files;

      await submitPrompt(page, "加一个计算历史记录功能");
      await waitForVersionNode(page, 4);

      const filesAfter = await getFileList(page);

      // Core files preserved
      expect(filesAfter).toContain("/App.js");
      // File count should not decrease
      expect(filesAfter.length).toBeGreaterThanOrEqual(filesBefore.length);

      // Architect got real-time arch context (not stale archDecisions)
      const archReq = requests.find((r) => r.agent === "architect");
      expect(archReq?.context).toContain("从代码实时分析");

      await assertPreviewNotBlank(page);
      await assertNoFatalError(page);

      v1Files = filesAfter;
      v1FileCount = filesAfter.length;
    });

    // ── S5: 多轮 bug_fix → feature_add（FIFO eviction 场景） ──────

    test("S5: 多轮 bug_fix → feature_add — 架构不丢失", async ({
      page,
    }) => {
      await loginAsGuest(page);
      await page.goto(projectUrl);

      // Send 3 consecutive bug_fix rounds
      await submitPrompt(page, "修复数字按钮间距太小");
      await waitForVersionNode(page, 5);

      await submitPrompt(page, "修复清除按钮颜色不够醒目");
      await waitForVersionNode(page, 6);

      await submitPrompt(page, "修复历史记录显示格式");
      await waitForVersionNode(page, 7);

      // Now feature_add — this is the critical test
      const { requests, warnings } = setupCapture(page);
      const filesBeforeFeature = await getFileList(page);

      await submitPrompt(page, "加一个单位转换功能");
      await waitForVersionNode(page, 8);

      const filesAfter = await getFileList(page);

      // Core files must survive 3 bug_fix + 1 feature_add
      expect(filesAfter).toContain("/App.js");
      // File count should not decrease
      expect(filesAfter.length).toBeGreaterThanOrEqual(
        filesBeforeFeature.length
      );

      // Architect should have real-time context (deriveArchFromFiles worked)
      const archReq = requests.find((r) => r.agent === "architect");
      expect(archReq?.context).toContain("从代码实时分析");

      // No fatal errors
      await assertPreviewNotBlank(page);
      await assertNoFatalError(page);

      // Check console for pipeline diagnostics
      const pipelineWarnings = warnings.filter((w) =>
        w.includes("[pipeline]")
      );
      expect(pipelineWarnings.length).toBeGreaterThan(0);
    });
  });
});
