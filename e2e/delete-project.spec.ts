import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  createProjectAndNavigate,
  cleanupTestProjects,
} from "./helpers";

/**
 * E2E Tests: Delete Project (EPIC 6)
 *
 * AC-1:  主页项目卡片右上角有操作菜单，含"删除项目"选项
 * AC-2:  侧边栏项目行 hover 时出现删除按钮
 * AC-3:  点击删除弹出确认框，显示项目名称
 * AC-4:  取消确认框后，项目列表无任何变化
 * AC-5:  确认删除后，卡片/列表项即时消失，无整页刷新
 * AC-7:  在项目详情页删除当前项目后，自动跳转回首页
 */

test.afterAll(async ({ browser }) => {
  await cleanupTestProjects(browser);
});

test.describe("删除项目 — 主页卡片", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // AC-1: 主页卡片含操作菜单
  test("AC-1: 主页项目卡片有操作菜单，含删除项目选项", async ({ page }) => {
    await createProjectAndNavigate(page, "[E2E] Delete AC1 Project");
    await page.goto("/");

    // Hover over a project card to make the menu trigger visible
    const card = page.locator("[data-testid='project-card']").first();
    await card.hover();

    // Click dropdown trigger
    const menuBtn = card.locator("[aria-label='项目操作']");
    await menuBtn.click();

    // "删除项目" menu item should appear
    await expect(page.getByText("删除项目")).toBeVisible();
  });

  // AC-3: 弹出确认框显示项目名称
  test("AC-3: 确认框显示项目名称", async ({ page }) => {
    const projectName = "[E2E] Delete AC3 Project";
    await createProjectAndNavigate(page, projectName);
    await page.goto("/");

    const card = page.locator("[data-testid='project-card']").first();
    await card.hover();
    await card.locator("[aria-label='项目操作']").click();
    await page.getByText("删除项目").click();

    // AlertDialog should show project name
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText(new RegExp(projectName.replace(/\[/g, "\\[").replace(/\]/g, "\\]")))).toBeVisible();
  });

  // AC-4: 取消不影响列表
  test("AC-4: 取消确认框后项目列表不变", async ({ page }) => {
    const projectName = "[E2E] Delete AC4 Project";
    await createProjectAndNavigate(page, projectName);
    await page.goto("/");

    const cardsBefore = await page.locator("[data-testid='project-card']").count();

    const card = page.locator("[data-testid='project-card']").first();
    await card.hover();
    await card.locator("[aria-label='项目操作']").click();
    await page.getByText("删除项目").click();
    await page.getByRole("button", { name: "取消" }).click();

    // Dialog gone, project count unchanged
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    const cardsAfter = await page.locator("[data-testid='project-card']").count();
    expect(cardsAfter).toBe(cardsBefore);
  });

  // AC-5: 确认后卡片即时消失（乐观更新）
  test("AC-5: 确认删除后项目卡片即时消失", async ({ page }) => {
    const projectName = "[E2E] Delete AC5 Project";
    await createProjectAndNavigate(page, projectName);
    await page.goto("/");

    // Find the card for this specific project
    const card = page
      .locator("[data-testid='project-card']")
      .filter({ hasText: projectName });
    await expect(card).toBeVisible();

    await card.hover();
    await card.locator("[aria-label='项目操作']").click();
    await page.getByText("删除项目").click();
    await page.getByRole("button", { name: "删除" }).click();

    // Card should disappear without full page reload
    await expect(card).not.toBeVisible({ timeout: 5000 });
    // URL should still be /
    expect(page.url()).toContain("/");
    expect(page.url()).not.toContain("/project/");
  });
});

test.describe("删除项目 — 侧边栏", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  // AC-2: 侧边栏 hover 显示删除按钮
  test("AC-2: 侧边栏项目行 hover 时出现删除按钮", async ({ page }) => {
    await createProjectAndNavigate(page, "[E2E] Delete AC2 Sidebar");

    // In workspace, sidebar is visible
    const sidebarItem = page
      .locator("[data-testid='project-item']")
      .first();
    await sidebarItem.hover();

    const deleteBtn = sidebarItem.locator("[aria-label^='删除']");
    await expect(deleteBtn).toBeVisible();
  });

  // AC-7: 在项目详情页删除当前项目后跳转首页
  test("AC-7: 在项目详情页删除当前项目后跳转回首页", async ({ page }) => {
    await createProjectAndNavigate(page, "[E2E] Delete AC7 Redirect");
    const projectUrl = page.url();
    expect(projectUrl).toContain("/project/");

    // Use sidebar to delete the current project
    const sidebarItem = page
      .locator("[data-testid='project-item']")
      .first();
    await sidebarItem.hover();
    await sidebarItem.locator("[aria-label^='删除']").click();

    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "删除" }).click();

    // Should redirect to home
    await page.waitForURL("/", { timeout: 10000 });
    expect(page.url()).not.toContain("/project/");
  });
});
