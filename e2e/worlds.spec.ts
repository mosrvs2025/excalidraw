import { expect, test, type Page } from "@playwright/test";
import { count, openApp, scene, shot } from "./helpers";

const trail = (p: Page) => p.locator('[data-testid="crumb"]');
const portals = async (p: Page) => (await scene(p)).filter((e) => e.kind === "portal");
const settled = (p: Page) => p.waitForFunction(() => !document.querySelector('[data-testid="veil"]'), null, { timeout: 8000 });

/** Screen centre of an element, from the live scene + viewport. */
const centerOf = (p: Page, id: string) =>
  p.evaluate((id) => {
    const a = (window as any).__lumen.api;
    const s = a.getAppState();
    const e = a.getSceneElements().find((x: any) => x.id === id);
    return { x: (e.x + e.width / 2 + s.scrollX) * s.zoom.value + s.offsetLeft, y: (e.y + e.height / 2 + s.scrollY) * s.zoom.value + s.offsetTop };
  }, id);

async function brainDumpToWorld(page: Page) {
  await page.locator('[data-testid="starter-braindump"]').click();
  await expect(page.locator('[data-testid="intent-world"]')).toBeVisible();
  await page.locator('[data-testid="intent-world"]').click();
  await expect.poll(async () => (await portals(page)).length).toBe(1);
}

test.describe("worlds", () => {
  test("make a world from a drawing, step inside, find the trail, come back — preview included", async ({ page }) => {
    await openApp(page);
    await brainDumpToWorld(page);
    // everything selected moved inside; the doorway replaced it
    expect((await scene(page)).filter((e) => !e.isDeleted)).toHaveLength(1);
    await expect(page.locator('[data-testid="toast"]')).toContainText("is now a world");
    await expect(page.locator('[data-testid="portal"]')).toBeVisible();
    await shot(page, "40-portal");

    await page.locator('[data-testid="action-enter"]').click();
    await expect(page.locator('[data-testid="veil"]')).toBeVisible();
    await expect(trail(page)).toHaveCount(1);
    await settled(page);
    expect(await count(page, "note")).toBe(12); // the whole drawing is in there, fitted to the view
    await expect(trail(page).first()).toHaveText("My first board");
    await shot(page, "41-inside");

    await trail(page).first().click();
    await expect(trail(page)).toHaveCount(0);
    await settled(page);
    expect(await portals(page)).toHaveLength(1);
    await expect(page.locator('[data-testid="portal"] img')).toBeVisible(); // preview of the world
    await shot(page, "42-back");
  });

  test("zoom IS the navigation: ctrl+wheel into the portal dives in; zooming way out climbs back", async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page);
    await brainDumpToWorld(page);
    await page.keyboard.press("Escape");
    const p = (await portals(page))[0];
    // frame the doorway comfortably first
    await page.evaluate((id) => {
      const a = (window as any).__lumen.api;
      a.scrollToContent(a.getSceneElements().find((e: any) => e.id === id), { fitToViewport: true, viewportZoomFactor: 0.4, animate: false });
    }, p.id);
    await page.waitForTimeout(1700); // arrival cooldown
    const c = await centerOf(page, p.id);
    await page.mouse.move(c.x, c.y);
    await page.keyboard.down("Control");
    for (let i = 0; i < 40 && (await trail(page).count()) === 0; i++) {
      await page.mouse.wheel(0, -160);
      await page.waitForTimeout(70);
    }
    await page.keyboard.up("Control");
    await expect(trail(page)).toHaveCount(1, { timeout: 8000 });
    await settled(page);
    await page.waitForTimeout(1700);

    // zoom far out of the world → return to the parent, looking at the doorway
    const mid = await page.evaluate(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
    await page.mouse.move(mid.x, mid.y);
    await page.keyboard.down("Control");
    for (let i = 0; i < 60 && (await trail(page).count()) === 1; i++) {
      await page.mouse.wheel(0, 160);
      await page.waitForTimeout(70);
    }
    await page.keyboard.up("Control");
    await expect(trail(page)).toHaveCount(0, { timeout: 8000 });
    await settled(page);
    expect(await portals(page)).toHaveLength(1);
  });

  test("worlds nest: demo universe, three levels deep, Alt+arrows to travel", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-worlds"]').click();
    await expect.poll(async () => (await portals(page)).length).toBe(1);
    await expect(page.locator('[data-testid="portal"] img')).toBeVisible();
    await page.locator('[data-testid="action-enter"]').click();
    await expect(trail(page)).toHaveCount(1);
    await settled(page);
    expect((await portals(page))[0].lumen.title).toBe("Main Street"); // the planet holds a town…
    await page.evaluate(() => { const a = (window as any).__lumen.api; const e = a.getSceneElements().find((x: any) => x.customData?.lumen?.kind === "portal"); a.updateScene({ appState: { selectedElementIds: { [e.id]: true } } }); });
    await page.keyboard.press("Alt+ArrowDown"); // …enter it from the keyboard
    await expect(trail(page)).toHaveCount(2);
    await settled(page);
    expect((await scene(page)).some((e) => e.text?.includes("Café"))).toBe(true);
    await expect(trail(page).nth(1)).toHaveText("Little planet");
    await shot(page, "43-three-deep");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(trail(page)).toHaveCount(1);
    await settled(page);
    await page.keyboard.press("Alt+ArrowUp");
    await expect(trail(page)).toHaveCount(0);
    await settled(page);
  });

  test("a new empty world: gentle prompt, draw inside, the doorway's preview updates", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="main-menu-trigger"]').click();
    await page.locator('[data-testid="new-world"]').click();
    await expect.poll(async () => (await portals(page)).length).toBe(1);
    await expect(page.locator(".portal-sky")).toBeVisible(); // starfield until something exists inside
    await page.locator('[data-testid="action-enter"]').click();
    await expect(page.locator('[data-testid="world-hint"]')).toBeVisible();
    await settled(page);
    await page.keyboard.press("r");
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(700, 420, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('[data-testid="world-hint"]')).toHaveCount(0);
    await trail(page).first().click();
    await expect(trail(page)).toHaveCount(0);
    await settled(page);
    await expect(page.locator('[data-testid="portal"] img')).toBeVisible({ timeout: 8000 }); // the preview caught up
  });

  test("undo of 'make world' brings the drawing back out of the doorway", async ({ page }) => {
    await openApp(page);
    await brainDumpToWorld(page);
    await page.locator('[data-testid="toast-undo"]').click();
    await expect.poll(async () => await count(page, "note")).toBe(12);
    expect(await portals(page)).toHaveLength(0);
  });

  test("worlds survive a reload; renaming shows on the doorway and in the trail", async ({ page }) => {
    await openApp(page);
    await brainDumpToWorld(page);
    await page.locator('[data-testid="action-rename"]').click();
    await page.locator('[data-testid="rename-input"]').fill("Pricing ideas");
    await page.locator('[data-testid="rename-save"]').click();
    await expect(page.locator(".portal-label b")).toHaveText("Pricing ideas");
    await page.locator('[data-testid="action-enter"]').click();
    await expect(trail(page)).toHaveCount(1);
    await settled(page);
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForFunction(() => (window as any).__lumen?.api);
    await expect(trail(page)).toHaveCount(1); // still inside
    await expect(page.locator('[data-testid="project-name"]')).toHaveText("Pricing ideas");
    expect(await count(page, "note")).toBe(12);
    await trail(page).first().click();
    await expect(trail(page)).toHaveCount(0);
    await settled(page);
    expect(await portals(page)).toHaveLength(1);
  });
});
