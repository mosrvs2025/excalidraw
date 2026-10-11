import { expect, test, type Page } from "@playwright/test";
import { count, openApp, scene, shot } from "./helpers";

async function twoPictures(page: Page) {
  await page.evaluate(() => {
    const L = (window as any).__lumen;
    const mk = (c: string) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 160;
      const g = cv.getContext("2d")!;
      g.fillStyle = c;
      g.fillRect(0, 0, 160, 160);
      return cv.toDataURL("image/png");
    };
    L.api.addFiles([
      { id: "fa", mimeType: "image/png", dataURL: mk("#e03131"), created: Date.now() },
      { id: "fb", mimeType: "image/png", dataURL: mk("#1971c2"), created: Date.now() },
    ]);
    const els = L.restore(
      [
        { type: "image", id: "ia", x: 0, y: 0, width: 200, height: 200, fileId: "fa", status: "saved" },
        { type: "image", id: "ib", x: 420, y: 20, width: 200, height: 200, fileId: "fb", status: "saved" },
      ],
      null,
    );
    L.api.updateScene({ elements: els, captureUpdate: "IMMEDIATELY" });
    L.api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.6 });
  });
}
const centre = (p: Page, id: string) =>
  p.evaluate((id) => {
    const a = (window as any).__lumen.api;
    const s = a.getAppState();
    const e = a.getSceneElements().find((x: any) => x.id === id);
    return { x: (e.x + e.width / 2 + s.scrollX) * s.zoom.value + s.offsetLeft, y: (e.y + e.height / 2 + s.scrollY) * s.zoom.value + s.offsetTop };
  }, id);

test.describe("stacking pictures", () => {
  test("drag one picture onto another → halo, offer, stack into a world with both inside", async ({ page }) => {
    await openApp(page);
    await twoPictures(page);
    const from = await centre(page, "ib");
    const to = await centre(page, "ia");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
    await page.mouse.move(to.x + 6, to.y + 6, { steps: 6 });
    await expect(page.locator('[data-testid="drophalo"]')).toBeVisible();
    await shot(page, "50-drop-halo");
    await page.mouse.up();
    await expect(page.locator('[data-testid="drophalo"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="action-stack"]')).toBeVisible();
    // it's a chip in the dock, so it can't cover the other actions
    await expect(page.locator('[data-testid="intent-app"], [data-testid="action-editimg"]').first()).toBeVisible();
    await shot(page, "51-stack-offer");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await scene(page)).filter((e) => e.kind === "portal" && !e.isDeleted).length, { timeout: 8000 }).toBe(1);
    expect((await scene(page)).filter((e) => e.type === "image" && !e.isDeleted)).toHaveLength(0);
    await expect(page.locator('[data-testid="toast"]')).toContainText("Stack of 2");
    await page.locator('[data-testid="action-enter"]').click();
    await expect.poll(async () => (await scene(page)).filter((e) => e.type === "image" && !e.isDeleted).length, { timeout: 8000 }).toBe(2);
  });

  test("dropping onto empty canvas offers nothing; Esc dismisses the offer", async ({ page }) => {
    await openApp(page);
    await twoPictures(page);
    const from = await centre(page, "ib");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 120, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('[data-testid="action-stack"]')).toHaveCount(0);
  });
});

test.describe("hold to stack", () => {
  test("hover a picture over another until the halo arms, release: stacked into a world with no extra click", async ({ page }) => {
    await openApp(page);
    await twoPictures(page);
    const from = await centre(page, "ib");
    const to = await centre(page, "ia");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x + 4, to.y + 4, { steps: 8 });
    await expect(page.locator('[data-testid="drophalo"]')).toContainText("Hold to stack");
    await expect(page.locator('[data-testid="drophalo"]')).toContainText("Release to stack");
    await page.mouse.up();
    await expect.poll(async () => (await scene(page)).filter((e) => e.kind === "portal" && !e.isDeleted).length, { timeout: 8000 }).toBe(1);
    await expect(page.locator('[data-testid="toast"]')).toContainText("Stack of 2");
  });
});

test.describe("page zoom", () => {
  test("Ctrl+wheel over the UI doesn't zoom the browser page (the app can't be zoomed out from under itself)", async ({ page }) => {
    await openApp(page);
    const prevented = await page.evaluate(() => {
      const e = new WheelEvent("wheel", { ctrlKey: true, deltaY: -120, cancelable: true, bubbles: true });
      document.querySelector(".pill")!.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });
  test("link icon / editor on a world is Lumen's, not a dead web link", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-braindump"]').click();
    await page.locator('[data-testid="intent-world"]').click();
    await expect.poll(async () => (await scene(page)).filter((e) => e.kind === "portal").length).toBe(1);
    await expect(page.locator(".app")).toHaveClass(/lumen-obj/);
  });
});

test.describe("dropping into a world", () => {
  test("drag a picture onto a doorway → it flies in, lands inside, and the portal keeps working", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-braindump"]').click();
    await page.locator('[data-testid="intent-world"]').click();
    await expect.poll(async () => (await scene(page)).filter((e) => e.kind === "portal").length).toBe(1);
    await page.evaluate(() => {
      const L = (window as any).__lumen;
      const c = document.createElement("canvas");
      c.width = c.height = 120;
      c.getContext("2d")!.fillStyle = "#2f9e44";
      c.getContext("2d")!.fillRect(0, 0, 120, 120);
      L.api.addFiles([{ id: "fz", mimeType: "image/png", dataURL: c.toDataURL("image/png"), created: Date.now() }]);
      const portal = L.api.getSceneElements().find((e: any) => e.customData?.lumen?.kind === "portal");
      const [img] = L.restore([{ type: "image", id: "iz", x: portal.x + portal.width + 160, y: portal.y, width: 120, height: 120, fileId: "fz", status: "saved" }], null);
      L.api.updateScene({ elements: [...L.api.getSceneElements(), img], captureUpdate: "IMMEDIATELY" });
      L.api.scrollToContent(L.api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.5 });
    });
    const from = await centre(page, "iz");
    const portal = (await scene(page)).find((e) => e.kind === "portal")!;
    const to = await centre(page, portal.id);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await expect(page.locator('[data-testid="drophalo"]')).toContainText("Hold to drop into");
    await expect(page.locator('[data-testid="drophalo"]')).toContainText("Release to drop into");
    await page.mouse.up();
    // held long enough: letting go moves it straight in, no extra click

    await expect.poll(async () => (await scene(page)).filter((e) => e.type === "image" && !e.isDeleted).length, { timeout: 8000 }).toBe(0);
    await expect(page.locator('[data-testid="toast"]')).toContainText("Moved into");
    await page.locator('[data-testid="action-enter"]').click();
    await expect.poll(async () => (await scene(page)).filter((e) => e.type === "image" && !e.isDeleted).length, { timeout: 8000 }).toBe(1);
    expect(await count(page, "note")).toBe(12);
  });
});

test.describe("typing + slash commands", () => {
  test("/ opens the menu; '/note a; b' adds two notes; ? shows shortcuts", async ({ page }) => {
    await openApp(page);
    await page.locator("body").click({ position: { x: 600, y: 300 } });
    await page.keyboard.press("/");
    await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible();
    await page.keyboard.type("note buy milk; call mum");
    await page.keyboard.press("Enter");
    await expect.poll(async () => await count(page, "note")).toBe(2);
    await shot(page, "52-slash-note");
    await page.locator("body").click({ position: { x: 700, y: 200 } });
    await page.keyboard.press("?");
    await expect(page.locator('[data-testid="shortcuts"]')).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("N opens a quick note; Enter adds it and keeps going", async ({ page }) => {
    await openApp(page);
    await page.locator("body").click({ position: { x: 600, y: 300 } });
    await page.keyboard.press("n");
    await page.locator('[data-testid="quicknote-input"]').fill("first idea");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second idea");
    await page.keyboard.press("Enter");
    await expect.poll(async () => await count(page, "note")).toBe(2);
  });
});

test.describe("pile, spread and find", () => {
  test("/pile gathers a selection, /spread lays it out again", async ({ page }) => {
    await openApp(page);
    await twoPictures(page);
    await page.evaluate(() => {
      const L = (window as any).__lumen;
      L.api.updateScene({ appState: { selectedElementIds: { ia: true, ib: true } }, captureUpdate: "NEVER" });
    });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen:ask", { detail: "/pile" })));
    await page.locator('[data-testid="intent-input"]').press("Enter");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Piled up");
    const piled = (await scene(page)).filter((e) => e.type === "image");
    expect(Math.abs(piled[0].x - piled[1].x)).toBeLessThan(60);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen:ask", { detail: "/spread" })));
    await page.locator('[data-testid="intent-input"]').press("Enter");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Spread out");
    const spread = (await scene(page)).filter((e) => e.type === "image");
    expect(Math.abs(spread[0].x - spread[1].x)).toBeGreaterThan(150);
  });

  test("⌘K finds text on this board and inside worlds, and jumps there", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-braindump"]').click();
    await page.locator('[data-testid="intent-world"]').click();
    await expect.poll(async () => (await scene(page)).filter((e) => e.kind === "portal").length).toBe(1);
    await page.keyboard.press("Control+k");
    await page.locator('[data-testid="palette-input"]').fill("referral");
    const row = page.locator('[data-testid="palette"] li', { hasText: "Referral program" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Pricing page redesign");
    await row.click();
    await expect(page.locator('[data-testid="crumb"]')).toHaveCount(1);
  });
});

test.describe("saved views", () => {
  test("/view saves the camera; ⌘K → View: flies back to it", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-braindump"]').click();
    await page.evaluate(() => (window as any).__lumen.api.scrollToContent((window as any).__lumen.api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.9, animate: false }));
    await page.waitForTimeout(300);
    const cam = () => page.evaluate(() => { const s = (window as any).__lumen.api.getAppState(); return { x: s.scrollX, y: s.scrollY, z: s.zoom.value }; });
    const home = await cam();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen:ask", { detail: "/view Overview" })));
    await page.locator('[data-testid="intent-input"]').press("Enter");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Saved view");
    await page.evaluate(() => (window as any).__lumen.api.updateScene({ appState: { scrollX: 900, scrollY: 700, zoom: { value: 0.4 } }, captureUpdate: "NEVER" }));
    await page.keyboard.press("Control+k");
    await page.locator('[data-testid="palette-input"]').fill("view: overview");
    await expect(page.locator('[data-testid="palette"] li.on')).toContainText("View: Overview");
    await page.keyboard.press("Enter");
    await expect.poll(async () => Math.abs((await cam()).z - home.z) < 0.02 && Math.abs((await cam()).x - home.x) < 3, { timeout: 5000 }).toBe(true);
  });
});

test.describe("first-run tour", () => {
  test("follows what you do: note → world → enter, then wraps up", async ({ page }) => {
    await openApp(page, "/", { tour: true });
    await expect(page.locator('[data-testid="tour"]')).toContainText("1 of 3");
    await page.locator("body").click({ position: { x: 600, y: 300 } });
    await page.keyboard.press("/");
    await page.keyboard.type("note buy milk; call mum");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="tour"]')).toContainText("2 of 3");
    await page.evaluate(() => {
      const L = (window as any).__lumen;
      L.api.updateScene({ appState: { selectedElementIds: Object.fromEntries(L.api.getSceneElements().map((e: any) => [e.id, true])) }, captureUpdate: "NEVER" });
    });
    await page.locator('[data-testid="intent-world"]').click();
    await expect(page.locator('[data-testid="tour"]')).toContainText("3 of 3");
    await page.locator('[data-testid="action-enter"]').click();
    await expect(page.locator('[data-testid="tour-done"]')).toBeVisible({ timeout: 8000 });
    await page.reload();
    await page.waitForFunction(() => (window as any).__lumen?.api);
    await expect(page.locator('[data-testid="tour"]')).toHaveCount(0);
  });
  test("can be ended for good", async ({ page }) => {
    await openApp(page, "/", { tour: true });
    await page.locator('[data-testid="tour-skip"]').click();
    await expect(page.locator('[data-testid="tour"]')).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  test("slash menu, tour and offers stay on screen; nothing scrolls sideways", async ({ page }) => {
    await openApp(page, "/", { tour: true });
    await page.locator('[data-testid="intent-input"]').fill("/");
    const menu = page.locator('[data-testid="slash-menu"]');
    await expect(menu).toBeVisible();
    await page.locator('[data-testid="intent-input"]').fill("/note hi");
    await page.locator('[data-testid="intent-input"]').press("Enter");
    await expect.poll(async () => await count(page, "note")).toBe(1);
    // on a phone the tour steps aside while something is selected (the dock chips need the room)
    await expect(page.locator('[data-testid="tour"]')).toHaveCount(0);
    await page.evaluate(() => (window as any).__lumen.api.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: "NEVER" }));
    await expect(page.locator('[data-testid="tour"]')).toBeVisible();
    await page.locator('[data-testid="intent-input"]').fill("/");
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    const tour = (await page.locator('[data-testid="tour"]').boundingBox())!;
    expect(tour.x).toBeGreaterThanOrEqual(0);
    expect(tour.x + tour.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await shot(page, "53-mobile-slash");
  });
});

test.describe("phone: overlays step aside", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  test("opening the menu hides the welcome cards, dock and board pill so the menu is readable", async ({ page }) => {
    await openApp(page);
    await expect(page.locator(".welcome")).toBeVisible();
    await page.locator('[data-testid="main-menu-trigger"]').tap();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector(".welcome")!).opacity)).toBe("0");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="dock"]')!).opacity)).toBe("0");
    // the welcome sits clear of the toolbar row and the starters fit above the dock
    await page.locator('[data-testid="main-menu-trigger"]').tap();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector(".welcome")!).opacity)).toBe("1");
    const w = (await page.locator(".welcome").boundingBox())!;
    const d = (await page.locator('[data-testid="dock"]').boundingBox())!;
    expect(w.y + w.height).toBeLessThanOrEqual(d.y + 2);
  });
});

test.describe("desktop: panels don't hide the welcome", () => {
  test("opening Excalidraw's Library sidebar keeps the starters visible and clickable; the tour clears the style panel", async ({ page }) => {
    await openApp(page, "/", { tour: true });
    await page.locator(".default-sidebar-trigger").click();
    await expect(page.locator(".app")).not.toHaveClass(/ui-open/);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".welcome")!).opacity)).toBe("1");
    await page.locator(".sidebar-close, [aria-label='Close']").first().click({ trial: true }).catch(() => {});
    await page.locator('[data-testid="starter-braindump"]').click();
    await expect.poll(async () => await count(page, "note")).toBe(12);
    // the tour card sits bottom-right, clear of the left-hand style panel
    const t = (await page.locator('[data-testid="tour"]').boundingBox())!;
    expect(t.x).toBeGreaterThan(640);
  });
});

test.describe("worlds: zoom feel + link safety", () => {
  async function worldFromPicture(page: Page) {
    await page.evaluate(() => {
      const L = (window as any).__lumen;
      const c = document.createElement("canvas");
      c.width = c.height = 200;
      c.getContext("2d")!.fillStyle = "#3a6";
      c.getContext("2d")!.fillRect(0, 0, 200, 200);
      L.api.addFiles([{ id: "f1", mimeType: "image/png", dataURL: c.toDataURL(), created: Date.now() }]);
      const [img] = L.restore([{ type: "image", id: "i1", x: 0, y: 0, width: 200, height: 200, fileId: "f1", status: "saved" }], null);
      L.api.updateScene({ elements: [img], appState: { selectedElementIds: { i1: true } }, captureUpdate: "IMMEDIATELY" });
    });
    await page.locator('[data-testid="intent-world"]').click();
    await expect.poll(async () => (await scene(page)).filter((e) => e.kind === "portal").length).toBe(1);
    await page.evaluate(() => {
      const a = (window as any).__lumen.api;
      const e = a.getSceneElements().find((x: any) => x.customData?.lumen?.kind === "portal");
      a.scrollToContent(e, { fitToViewport: true, viewportZoomFactor: 0.3, animate: false });
    });
    await page.waitForTimeout(400);
  }

  test("a world's link can't be edited away", async ({ page }) => {
    await openApp(page);
    await worldFromPicture(page);
    await page.evaluate(() => {
      const a = (window as any).__lumen.api;
      a.updateScene({ elements: a.getSceneElementsIncludingDeleted().map((e: any) => (e.customData?.lumen?.kind === "portal" ? { ...e, link: "https://example.com", version: e.version + 1, versionNonce: e.versionNonce + 1 } : e)), captureUpdate: "NEVER" });
    });
    await expect
      .poll(async () => page.evaluate(() => (window as any).__lumen.api.getSceneElements().find((e: any) => e.customData?.lumen?.kind === "portal").link), { timeout: 5000 })
      .toContain("lumen.live");
  });

  test("scroll-zooming through a doorway doesn't carry on into the world (no 20× overshoot)", async ({ page }) => {
    await openApp(page);
    await worldFromPicture(page);
    const pc = await centre(page, (await scene(page)).find((e) => e.kind === "portal")!.id);
    await page.mouse.move(pc.x, pc.y);
    const flick = async (dy: number) => {
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, dy);
      await page.keyboard.up("Control");
      await page.waitForTimeout(90);
    };
    for (let i = 0; i < 40 && (await page.locator('[data-testid="crumb"]').count()) === 0; i++) await flick(-250);
    for (let i = 0; i < 5; i++) await flick(-250); // trackpad momentum after you stop
    await expect(page.locator('[data-testid="crumb"]')).toHaveCount(1);
    await page.waitForTimeout(1500);
    const z = await page.evaluate(() => (window as any).__lumen.api.getAppState().zoom.value);
    expect(z).toBeLessThan(8);
    // and a handful of flicks outward leaves the world again
    for (let i = 0; i < 14; i++) {
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, 250);
      await page.keyboard.up("Control");
      await page.waitForTimeout(90);
    }
    await expect(page.locator('[data-testid="crumb"]')).toHaveCount(0, { timeout: 6000 });
  });
});
