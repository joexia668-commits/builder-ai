import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, cleanupTestProjects } from "./helpers";

/**
 * E2E Smoke Tests: Sandpack Preview Rendering
 *
 * Verifies the code-editor → preview pipeline without AI generation.
 * No API keys or quota required. Should complete in < 15s.
 *
 * Regression coverage for:
 * - Wrong Sandpack file path (/App.jsx vs /App.js)
 * - CodeEditor debounce cancelled on tab switch (flush-on-unmount fix)
 * - sandpackKey not triggering Sandpack remount
 */

const STATIC_COMPONENT = `export default function App() {
  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white p-10 rounded-2xl shadow-xl text-center">
        <h1 className="text-4xl font-bold text-indigo-600">BuilderAI</h1>
        <p className="text-gray-500 mt-3 text-lg">预览正常运行</p>
      </div>
    </div>
  );
}`;

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

test.describe("Sandpack 预览渲染", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, "[E2E] Sandpack Smoke Test");
  });

  // SP-01: Pasting code in the code tab then switching to preview renders the component
  test("SP-01: 代码标签粘贴组件后切换到预览能正确渲染", async ({ page }) => {
    // Switch to the code tab
    await page.getByTestId("tab-code").click();

    // Clear existing content and paste the static component
    const editor = page.locator(".monaco-editor").first();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(STATIC_COMPONENT);

    // Switch to preview tab — triggers CodeEditor unmount flush
    await page.getByTestId("tab-preview").click();

    // The Sandpack iframe should load and render our component
    const sandpackFrame = page.frameLocator("iframe").first();
    await expect(sandpackFrame.locator("text=BuilderAI")).toBeVisible({
      timeout: 15000,
    });
    await expect(sandpackFrame.locator("text=预览正常运行")).toBeVisible({
      timeout: 5000,
    });
  });

  // SP-02: Preview does NOT show Sandpack template default "Hello world"
  test("SP-02: 预览不应显示 Sandpack 模板默认的 Hello world", async ({ page }) => {
    await page.getByTestId("tab-code").click();

    const editor = page.locator(".monaco-editor").first();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(STATIC_COMPONENT);

    await page.getByTestId("tab-preview").click();

    const sandpackFrame = page.frameLocator("iframe").first();
    // Wait for Sandpack to load, then assert the default is NOT shown
    await expect(sandpackFrame.locator("text=BuilderAI")).toBeVisible({
      timeout: 15000,
    });
    await expect(sandpackFrame.locator("text=Hello world")).not.toBeVisible();
  });
});
