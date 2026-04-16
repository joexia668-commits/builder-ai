import type { Browser, Page } from "@playwright/test";

/**
 * Login as a guest user via the guest login flow.
 * Handles both new guest creation and existing guest restoration.
 */
export async function loginAsGuest(page: Page): Promise<void> {
  await page.goto("/login");
  // Click "Try as Guest" button
  await page.getByRole("button", { name: /try as guest/i }).click();
  // Wait for redirect to home page after successful login
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 30000,
  });
}

/**
 * Create a new project and navigate to its workspace.
 * Returns the project URL.
 */
export async function createProjectAndNavigate(
  page: Page,
  projectName: string = "[E2E] Test Project"
): Promise<string> {
  await page.goto("/");
  // Use testid to uniquely target the sidebar "New Project" button
  const newProjectBtn = page.getByTestId("btn-new-project");
  await newProjectBtn.click();

  // Fill in project name if a dialog appears
  const nameInput = page.getByPlaceholder(/project name|项目名称/i);
  if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nameInput.fill(projectName);
    await page.getByRole("button", { name: /create|创建/i }).click();
  }

  // Wait for navigation to project workspace
  await page.waitForURL(/\/project\//, { timeout: 10000 });
  return page.url();
}

/**
 * Delete all [E2E] projects owned by the guest user.
 * Call this in afterAll to clean up data created during the test run.
 * Uses a fresh browser context so it works regardless of test state.
 */
export async function cleanupTestProjects(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAsGuest(page);
    const response = await page.request.get("/api/projects");
    if (!response.ok()) return;

    const projects: Array<{ id: string; name: string }> = await response.json();
    const testProjects = projects.filter((p) => p.name.startsWith("[E2E]"));

    await Promise.all(
      testProjects.map((p) => page.request.delete(`/api/projects/${p.id}`))
    );

    if (testProjects.length > 0) {
      console.log(`[afterAll] Cleaned up ${testProjects.length} [E2E] project(s)`);
    }
  } finally {
    await context.close();
  }
}

/**
 * Submit a prompt in the chat input and wait for streaming to start.
 */
export async function submitPrompt(
  page: Page,
  prompt: string
): Promise<void> {
  const chatInput = page.getByPlaceholder(
    /describe.*app|描述.*应用|输入需求/i
  );
  await chatInput.fill(prompt);
  await page.keyboard.press("Enter");
}
