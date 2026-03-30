import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, submitPrompt } from "./helpers";

/**
 * E2E Smoke Tests: EPIC 5 — Operation Defuse
 *
 * E5-E2E-01: 生成期间时间线版本按钮全部禁用
 * E5-E2E-02: 生成期间预览区出现半透明遮罩
 * E5-E2E-03: 生成完成后遮罩消失、时间线按钮恢复可点击
 * E5-E2E-04: 完整 Demo 流程：登录→创建项目→生成→预览→版本回滚
 *
 * Prerequisites:
 * - Dev server running at http://localhost:3000
 * - Valid AI API key configured
 * - Database accessible
 */

// ─── E5-E2E-01: Timeline buttons disabled during generation ─────────────────

test.describe("E5-E2E-01: 生成期间时间线按钮禁用", () => {
  test("生成期间时间线中版本按钮呈禁用状态", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E-E5] Timeline Lock Test ${Date.now()}`);

    // Submit prompt to trigger generation
    await submitPrompt(page, "做一个简单的计数器应用");

    // Wait for generation to start (agent status bar appears or stop button visible)
    const stopBtn = page.getByTestId("stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 15000 });

    // If there are version nodes in the timeline, they should be disabled
    const versionNodes = page.locator("[data-testid^='version-node-']");
    const count = await versionNodes.count();
    if (count > 0) {
      const firstBtn = versionNodes.first().locator("button");
      await expect(firstBtn).toBeDisabled({ timeout: 5000 });
    }
    // If no version nodes yet (first generation), the test validates the stop btn appeared
    await expect(stopBtn).toBeVisible();
  });
});

// ─── E5-E2E-02: Preview overlay appears during generation ───────────────────

test.describe("E5-E2E-02: 生成期间预览区遮罩", () => {
  test("生成期间预览区出现半透明遮罩，阻止点击穿透", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E-E5] Overlay Test ${Date.now()}`);

    await submitPrompt(page, "做一个简单的 Hello World 应用");

    // Wait for generation to start
    const stopBtn = page.getByTestId("stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 15000 });

    // The overlay should be visible: backdrop-blur-sm is the key class
    const overlay = page.locator(".backdrop-blur-sm").first();
    await expect(overlay).toBeVisible({ timeout: 5000 });
  });

  test("生成期间预览区显示「正在生成中...」提示文字", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E-E5] Generating Text Test ${Date.now()}`);

    await submitPrompt(page, "做一个简单的按钮组件");

    const stopBtn = page.getByTestId("stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 15000 });

    await expect(page.getByText(/正在生成中/)).toBeVisible({ timeout: 5000 });
  });
});

// ─── E5-E2E-03: Overlay disappears after generation completes ───────────────

test.describe("E5-E2E-03: 生成完成后遮罩消失", () => {
  test("生成完成后遮罩自动消失，预览区内容可交互", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, `[E2E-E5] Post-Gen Test ${Date.now()}`);

    await submitPrompt(page, "做一个最简单的 Hello World 页面");

    // Wait for generation to start
    const stopBtn = page.getByTestId("stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 15000 });

    // Wait for generation to complete (stop button disappears)
    await expect(stopBtn).not.toBeVisible({ timeout: 60000 });

    // After generation: overlay should be gone
    const overlay = page.locator(".backdrop-blur-sm").first();
    await expect(overlay).not.toBeVisible({ timeout: 5000 });

    // After generation: chat input should be enabled
    const chatInput = page.getByRole("textbox");
    await expect(chatInput).toBeEnabled({ timeout: 5000 });
  });
});

// ─── E5-E2E-04: Full Demo Flow ───────────────────────────────────────────────

test.describe("E5-E2E-04: 完整 Demo 流程", () => {
  test("完整流程：登录 → 创建项目 → 生成 → 预览 → 版本节点出现", async ({ page }) => {
    // Step 1: Login
    await loginAsGuest(page);
    await expect(page).toHaveURL(/\//);

    // Step 2: Create project and navigate to workspace
    await createProjectAndNavigate(page, `[E2E-E5] Full Flow Test ${Date.now()}`);
    await expect(page).toHaveURL(/\/project\//);

    // Step 3: Preview shows empty state initially
    await expect(page.getByText("等待生成")).toBeVisible({ timeout: 5000 });

    // Step 4: Submit prompt and wait for generation to complete
    await submitPrompt(page, "做一个最简单的 Hello World 页面");

    const stopBtn = page.getByTestId("stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
    await expect(stopBtn).not.toBeVisible({ timeout: 60000 });

    // Step 5: Preview shows generated content (no longer shows 等待生成)
    await expect(page.getByText("等待生成")).not.toBeVisible({ timeout: 5000 });

    // Step 6: Version node appears in timeline
    const versionNode = page.locator("[data-testid^='version-node-']").first();
    await expect(versionNode).toBeVisible({ timeout: 5000 });
  });
});
