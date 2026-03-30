import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, cleanupTestProjects } from "./helpers";

/**
 * E2E Tests: EPIC 7 — 用户可选 AI 模型
 *
 * E-01: ChatInput 中显示模型选择器（AC-1）
 * E-02: 切换模型后刷新页面，选择保留（AC-2）
 * E-03: Header 偏好设置入口可见并打开 Dialog（AC-3）
 * E-04: Dialog 中切换全局模型，Toast 提示保存成功（AC-10）
 * E-05: 项目级模型与全局模型不同时，生成使用项目级（AC-4）
 * E-06: 生成进行中选择器置灰不可操作（AC-6）
 * E-07: 未配置 API Key 的模型在 Dropdown 中置灰（AC-5）
 */

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

test.describe("模型选择器 — ChatInput 显示（AC-1）", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // E-01: 工作区 ChatInput 显示模型选择器
  test("E-01: 工作区 ChatInput 中显示模型选择器", async ({ page }) => {
    await createProjectAndNavigate(page, "[E2E] Model Selection E-01");

    // The model selector should be visible in the ChatInput area
    const modelSelector = page.getByTestId("model-selector-trigger");
    await expect(modelSelector).toBeVisible({ timeout: 10000 });

    // Should show a model name (not empty)
    const selectedValue = await modelSelector.inputValue();
    expect(selectedValue).toBeTruthy();
    expect(selectedValue.length).toBeGreaterThan(0);
  });
});

test.describe("模型持久化 — 刷新保留选择（AC-2）", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // E-02: 切换模型 → 刷新 → 仍选中同一模型
  test("E-02: 切换模型后刷新页面，模型选择保留", async ({ page }) => {
    await createProjectAndNavigate(page, "[E2E] Model Selection E-02");
    const projectUrl = page.url();

    const modelSelector = page.getByTestId("model-selector-trigger");
    await expect(modelSelector).toBeVisible({ timeout: 10000 });

    // Get all available (non-disabled) options
    const options = await modelSelector.locator("option:not([disabled])").all();
    if (options.length < 2) {
      test.skip(); // Only one model configured — cannot test switching
      return;
    }

    // Switch to a different model (pick the last enabled option)
    const lastOption = options[options.length - 1];
    const targetModelId = await lastOption.getAttribute("value");
    expect(targetModelId).toBeTruthy();

    await modelSelector.selectOption(targetModelId!);

    // Wait for the selection to be saved (debounce / API call)
    await page.waitForTimeout(1500);

    // Refresh the page
    await page.goto(projectUrl);
    await page.waitForLoadState("networkidle");

    // Model selector should still show the chosen model
    const refreshedSelector = page.getByTestId("model-selector-trigger");
    await expect(refreshedSelector).toBeVisible({ timeout: 10000 });
    const persistedValue = await refreshedSelector.inputValue();
    expect(persistedValue).toBe(targetModelId);
  });
});

test.describe("Header 偏好设置 Dialog（AC-3 / AC-10）", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, "[E2E] Model Selection E-03");
  });

  // E-03: Header 中有偏好设置入口，点击打开 Dialog
  test("E-03: Header 用户菜单有偏好设置入口，点击打开 Dialog", async ({ page }) => {
    // Open user menu in header
    const userMenu = page.getByTestId("user-menu-trigger").or(
      page.getByRole("button", { name: /偏好|设置|preference/i })
    ).first();

    // If there's a dropdown menu, open it first
    const avatarOrMenu = page.getByTestId("user-avatar").or(userMenu).first();
    await avatarOrMenu.click({ timeout: 10000 });

    // Look for preferences menu item
    const prefItem = page.getByRole("menuitem", { name: /偏好设置|preference/i })
      .or(page.getByText(/偏好设置/i))
      .first();
    await expect(prefItem).toBeVisible({ timeout: 5000 });
    await prefItem.click();

    // Preferences dialog should open
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog should contain model selector
    const dialogModelSelector = dialog.getByTestId("model-selector-trigger");
    await expect(dialogModelSelector).toBeVisible({ timeout: 5000 });
  });

  // E-04: 在 Dialog 中切换全局模型，Toast 显示保存成功（AC-10）
  test("E-04: Dialog 中切换全局模型后 Toast 提示保存成功", async ({ page }) => {
    // Open user menu
    const avatarOrMenu = page.getByTestId("user-avatar")
      .or(page.getByTestId("user-menu-trigger"))
      .first();
    await avatarOrMenu.click({ timeout: 10000 });

    // Open preferences dialog
    const prefItem = page.getByRole("menuitem", { name: /偏好设置/i })
      .or(page.getByText(/偏好设置/i))
      .first();
    await expect(prefItem).toBeVisible({ timeout: 5000 });
    await prefItem.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Switch to a different available model
    const dialogModelSelector = dialog.getByTestId("model-selector-trigger");
    const options = await dialogModelSelector.locator("option:not([disabled])").all();
    if (options.length < 2) {
      test.skip();
      return;
    }

    const targetModelId = await options[options.length - 1].getAttribute("value");
    await dialogModelSelector.selectOption(targetModelId!);

    // Toast should appear with success message
    const toast = page.locator("[data-sonner-toast], [role='status'], .toast").first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/保存|success|成功/i);
  });
});

test.describe("项目级模型优先于全局偏好（AC-4）", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // E-05: 项目设置了与全局不同的模型 → 项目工作区显示项目级模型
  test("E-05: 项目 preferredModel 覆盖全局偏好，在工作区中生效", async ({ page }) => {
    await createProjectAndNavigate(page, "[E2E] Model Selection E-05");
    const projectUrl = page.url();
    const projectId = projectUrl.split("/project/")[1];

    // Set project-level model via API
    const patchRes = await page.request.patch(`/api/projects/${projectId}`, {
      data: { preferredModel: "gemini-2.0-flash" },
    });
    // If the model isn't configured, this may return 200 but skip silently
    if (!patchRes.ok()) {
      test.skip();
      return;
    }

    // Reload project workspace
    await page.goto(projectUrl);
    await page.waitForLoadState("networkidle");

    // ChatInput model selector should reflect the project-level model
    const modelSelector = page.getByTestId("model-selector-trigger");
    await expect(modelSelector).toBeVisible({ timeout: 10000 });
    const selectedValue = await modelSelector.inputValue();
    expect(selectedValue).toBe("gemini-2.0-flash");
  });
});

test.describe("生成中选择器 disabled（AC-6）", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // E-06: 生成进行中 ModelSelector disabled
  test("E-06: 生成进行中，模型选择器变为 disabled", async ({ page }) => {
    await createProjectAndNavigate(page, "[E2E] Model Selection E-06");

    const modelSelector = page.getByTestId("model-selector-trigger");
    await expect(modelSelector).toBeVisible({ timeout: 10000 });

    // Verify it's enabled before generation
    await expect(modelSelector).not.toBeDisabled();

    // Trigger generation
    const chatInput = page.getByPlaceholder(/描述.*应用/i);
    await chatInput.fill("做一个简单的 Hello World 页面");
    await page.keyboard.press("Enter");

    // During generation, model selector should become disabled
    await expect(modelSelector).toBeDisabled({ timeout: 15000 });
  });
});

test.describe("未配置模型置灰（AC-5）", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // E-07: 未配置 API Key 的模型在 Dropdown 中 disabled
  test("E-07: 未配置 API Key 的模型在选择器中置灰不可选", async ({ page }) => {
    await createProjectAndNavigate(page, "[E2E] Model Selection E-07");

    const modelSelector = page.getByTestId("model-selector-trigger");
    await expect(modelSelector).toBeVisible({ timeout: 10000 });

    // There should be at least some disabled options (unconfigured providers)
    // Options with data-disabled="true" represent unconfigured models
    const disabledOptions = modelSelector.locator("option[disabled]");
    const enabledOptions = modelSelector.locator("option:not([disabled])");

    // At least one option should exist
    const enabledCount = await enabledOptions.count();
    expect(enabledCount).toBeGreaterThan(0);

    // If there are disabled options, verify they contain "(未配置)" text
    const disabledCount = await disabledOptions.count();
    if (disabledCount > 0) {
      const firstDisabledText = await disabledOptions.first().textContent();
      expect(firstDisabledText).toContain("未配置");
    }
  });
});
