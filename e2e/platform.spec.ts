import { expect, test } from "@playwright/test";
import { count, openApp, runPrompt, scene, selectAll, shot, toastText, waitIdle } from "./helpers";

test.describe("persistence, history, projects", () => {
  test("work survives a reload (autosave) including live-object state", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "kanban");
    await expect(page.locator('[data-testid="toast"]')).toBeVisible();
    const n = (await scene(page)).length;
    await page.waitForTimeout(1200);
    await page.reload();
    await page.waitForFunction(() => (window as any).__lumen?.api);
    await page.waitForTimeout(600);
    expect((await scene(page)).length).toBe(n);
    await expect(page.locator(".welcome")).toHaveCount(0);
  });

  test("version history: AI actions checkpoint automatically and can be restored", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-braindump"]').click();
    await page.locator('[data-testid="intent-cluster"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("themes");
    await page.waitForTimeout(900);
    expect(await count(page, "lane")).toBe(5);
    await page.locator('[data-testid="open-history"]').click();
    const items = page.locator('[data-testid="version-item"]');
    await expect(items.first()).toContainText("Before: Group");
    await page.locator('[data-testid="checkpoint-name"]').fill("Clustered by Lumen");
    await page.locator('[data-testid="checkpoint-save"]').click();
    await expect(items.first()).toContainText("Clustered by Lumen");
    await shot(page, "09-history");
    // restore the pre-cluster state
    await items.nth(1).locator('[data-testid="version-restore"]').click();
    await page.waitForTimeout(500);
    expect(await count(page, "lane")).toBe(0);
    expect(await count(page, "note")).toBe(12);
    // …and we can go forward again via the checkpoint
    await page.locator('[data-testid="version-item"]').filter({ hasText: "Clustered by Lumen" }).locator('[data-testid="version-restore"]').click();
    await page.waitForTimeout(500);
    expect(await count(page, "lane")).toBe(5);
  });

  test("multiple projects: create, rename, switch, content isolated and persisted", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "kanban");
    await expect(page.locator('[data-testid="toast"]')).toBeVisible();
    await page.waitForTimeout(800);
    await page.locator('[data-testid="project-name"]').dblclick();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Roadmap");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="project-name"]')).toContainText("Roadmap");
    await page.locator('[data-testid="project-name"]').click();
    await page.locator('[data-testid="new-project"]').click();
    await page.waitForFunction(() => (window as any).__lumen?.api.getSceneElements().length === 0);
    await expect(page.locator(".welcome")).toBeVisible();
    await page.locator('[data-testid="project-name"]').click();
    await shot(page, "10-projects");
    await page.locator(".pmenu .open", { hasText: "Roadmap" }).click();
    await page.waitForFunction(() => (window as any).__lumen?.api.getSceneElements().length > 0);
    expect(await count(page, "lane")).toBe(3);
  });
});

test.describe("collaboration architecture", () => {
  test("two tabs of the same board sync live, with presence", async ({ context }) => {
    const a = await context.newPage();
    await openApp(a);
    const b = await context.newPage();
    await openApp(b);
    await expect(a.locator('[data-testid="presence"]')).toBeVisible({ timeout: 10_000 });
    await expect(b.locator('[data-testid="presence"]')).toBeVisible({ timeout: 10_000 });
    await runPrompt(a, "Plan -> Build -> Launch");
    await expect(a.locator('[data-testid="toast"]')).toBeVisible();
    await expect.poll(async () => (await scene(b)).filter((e) => e.kind === "node").length, { timeout: 10_000 }).toBe(3);
    // edits flow back the other way, without duplicating
    await runPrompt(b, "kanban");
    await expect.poll(async () => await count(a, "lane"), { timeout: 10_000 }).toBe(3);
    expect(await count(b, "node")).toBe(3);
    expect((await scene(a)).length).toBe((await scene(b)).length);
    await shot(a, "11-collab-a");
  });
});

test.describe("sharing", () => {
  test("share link: the board travels inside the URL and opens as a project in another browser", async ({ browser }) => {
    const a = await (await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })).newPage();
    await openApp(a);
    await runPrompt(a, "kanban");
    await expect(a.locator('[data-testid="toast"]')).toBeVisible();
    await a.waitForTimeout(500);
    await a.locator('[data-testid="main-menu-trigger"]').click();
    await a.getByText("Copy share link").click();
    await expect(a.locator('[data-testid="toast"]')).toContainText("Share link copied");
    const link = await a.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain("#board=");
    // a completely separate browser profile (no shared storage) opens it
    const b = await (await browser.newContext()).newPage();
    await openApp(b, link);
    await expect.poll(() => count(b, "lane")).toBe(3);
    expect(await b.evaluate(() => location.hash)).toBe(""); // fragment consumed
    await expect(b.locator('[data-testid="project-name"]')).toContainText("My first board");
    await shot(b, "16-shared-board");
  });
});

test.describe("responsive", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  test("phone layout: dock sits above the toolbar, nothing overflows", async ({ page }) => {
    await openApp(page);
    await shot(page, "12-mobile-welcome");
    await page.locator('[data-testid="starter-braindump"]').tap();
    await expect(page.locator('[data-testid="dock"]')).toBeVisible();
    const dock = (await page.locator('[data-testid="dock"]').boundingBox())!;
    expect(dock.x).toBeGreaterThanOrEqual(0);
    expect(dock.x + dock.width).toBeLessThanOrEqual(390);
    expect(dock.y + dock.height).toBeLessThan(780 - 60);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.locator('[data-testid="intent-cluster"]').tap();
    await expect(page.locator('[data-testid="toast"]')).toContainText("themes");
    await shot(page, "13-mobile-clustered");
  });
});
