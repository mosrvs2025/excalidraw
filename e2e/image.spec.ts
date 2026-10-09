import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp, scene, shot } from "./helpers";

/** A 400×200 white image with a red square in the middle, inserted and selected. */
async function insertImage(page: Page) {
  await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400; c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 200);
    g.fillStyle = "#ff0000"; g.fillRect(150, 50, 100, 100);
    const L = (window as any).__lumen;
    L.api.addFiles([{ id: "src1", mimeType: "image/png", dataURL: c.toDataURL("image/png"), created: Date.now() }]);
    const [img] = L.restore([{ type: "image", id: "img1", x: 300, y: 250, width: 400, height: 200, fileId: "src1", status: "saved" }], null);
    L.api.updateScene({ elements: [img], appState: { selectedElementIds: { img1: true } }, captureUpdate: "IMMEDIATELY" });
  });
  await expect(page.locator('[data-testid="action-editimg"]')).toBeVisible();
}

const sample = (page: Page, x: number, y: number) =>
  page.evaluate(
    async ([x, y]) => {
      const L = (window as any).__lumen;
      const el = L.api.getSceneElements().find((e: any) => e.id === "img1");
      const f = L.api.getFiles()[el.fileId];
      const img = new Image();
      await new Promise((r) => ((img.onload = r), (img.src = f.dataURL)));
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(Math.round(x * img.width), Math.round(y * img.height), 1, 1).data;
      return { rgba: [...px], w: img.width, h: img.height, fileId: el.fileId, elW: el.width, elH: el.height };
    },
    [x, y],
  );

test.describe("image tools", () => {
  test("Edit image: preset applies, is one undo step, original restored", async ({ page }) => {
    await openApp(page);
    await insertImage(page);
    await page.locator('[data-testid="action-editimg"]').click();
    await expect(page.locator('[data-testid="image-editor"]')).toBeVisible();
    await expect(page.locator('[data-testid="adj-apply"]')).toBeDisabled(); // nothing to apply yet
    await page.locator('[data-testid="preset-B&W"]').click();
    await shot(page, "32-image-editor");
    await page.locator('[data-testid="adj-apply"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("Image updated");
    const after = await sample(page, 0.5, 0.5);
    expect(Math.abs(after.rgba[0] - after.rgba[1])).toBeLessThan(6); // the red square lost its colour
    expect(after.fileId).not.toBe("src1");
    await page.locator('[data-testid="toast-undo"]').click();
    await expect.poll(async () => (await sample(page, 0.5, 0.5)).fileId).toBe("src1");
    const orig = await sample(page, 0.5, 0.5);
    expect(orig.rgba.slice(0, 3)).toEqual([255, 0, 0]);
  });

  test("Editor: background removal crops tight to the subject", async ({ page }) => {
    await openApp(page);
    await insertImage(page);
    await page.locator('[data-testid="action-editimg"]').click();
    await page.locator('[data-testid="adj-bg"]').check();
    await page.locator('[data-testid="adj-apply"]').click();
    await expect.poll(async () => (await sample(page, 0.5, 0.5)).fileId).not.toBe("src1");
    const mid = await sample(page, 0.5, 0.5);
    expect(mid.rgba).toEqual([255, 0, 0, 255]);
    expect(mid.w).toBeLessThan(115); // 400×200 → just the 100×100 square (+ margin)
    expect(mid.elW).toBeLessThan(115); // the on-canvas box shrank with it
  });

  test("One click: 'Remove background' on a studio-style photo keeps the subject (incl. light details inside it) and crops to it", async ({ page }) => {
    await openApp(page);
    // soft grey backdrop with a vignette, a dark "sock" with a light stripe that matches the backdrop colour
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 300; c.height = 400;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(150, 200, 40, 150, 200, 260);
      grad.addColorStop(0, "#e4e1de"); grad.addColorStop(1, "#d3cfcb");
      g.fillStyle = grad; g.fillRect(0, 0, 300, 400);
      g.fillStyle = "#3a3a3a"; g.beginPath(); g.roundRect(100, 60, 90, 280, 30); g.fill(); // subject
      g.fillStyle = "#dedbd8"; g.fillRect(130, 150, 30, 60); // light detail inside the subject, same tone as the backdrop
      const L = (window as any).__lumen;
      L.api.addFiles([{ id: "src1", mimeType: "image/png", dataURL: c.toDataURL("image/png"), created: Date.now() }]);
      const [img] = L.restore([{ type: "image", id: "img1", x: 300, y: 150, width: 300, height: 400, fileId: "src1", status: "saved" }], null);
      L.api.updateScene({ elements: [img], appState: { selectedElementIds: { img1: true } }, captureUpdate: "IMMEDIATELY" });
    });
    await expect(page.locator('[data-testid="intent-cutout"]')).toBeVisible();
    await expect(page.locator('[data-testid="intent-cutout"]')).toHaveClass(/primary/);
    await page.locator('[data-testid="intent-cutout"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("Background removed");
    const body = await sample(page, 0.5, 0.2); // inside the subject, away from the stripe
    expect(body.rgba.slice(0, 3)).toEqual([58, 58, 58]);
    expect(body.rgba[3]).toBe(255);
    const stripe = await sample(page, 0.5, 0.5); // the light detail must survive: it isn't connected to the edge
    expect(stripe.rgba[3]).toBe(255);
    expect(body.w).toBeLessThan(110);
    expect(body.h).toBeLessThan(300);
    expect(body.elW).toBeLessThan(110); // box hugs the subject
    await page.waitForTimeout(900);
    await shot(page, "33-cutout");
    // …and it is now easy to move: drag it somewhere else
    const before = await page.evaluate(() => { const e = (window as any).__lumen.api.getSceneElements().find((x: any) => x.id === "img1"); return [e.x, e.y]; });
    await page.keyboard.press("Escape");
    const box = await page.evaluate(() => { const a = (window as any).__lumen.api; const s = a.getAppState(); const e = a.getSceneElements().find((x: any) => x.id === "img1"); return { x: (e.x + e.width / 2 + s.scrollX) * s.zoom.value + s.offsetLeft, y: (e.y + e.height / 2 + s.scrollY) * s.zoom.value + s.offsetTop }; });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 40, { steps: 6 });
    await page.mouse.up();
    const after = await page.evaluate(() => { const e = (window as any).__lumen.api.getSceneElements().find((x: any) => x.id === "img1"); return [e.x, e.y]; });
    expect(after[0] - before[0]).toBeGreaterThan(200);
    // undo restores the original photo
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await sample(page, 0.5, 0.5)).fileId).toBe("src1");
  });

  test("typing 'remove the background' with an image selected does the same", async ({ page }) => {
    await openApp(page);
    await insertImage(page);
    await page.locator('[data-testid="intent-input"]').fill("remove the background");
    await page.locator('[data-testid="intent-input"]').press("Enter");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Background removed");
  });

  test("Palette: dominant colours become swatches on the canvas", async ({ page }) => {
    await openApp(page);
    await insertImage(page);
    await expect(page.locator('[data-testid="intent-palette"]')).toBeVisible();
    await page.locator('[data-testid="intent-palette"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("colours");
    const els = await scene(page);
    const labels = els.filter((e) => e.containerId && els.find((c) => c.id === e.containerId)?.kind === "swatch").map((e) => e.text?.toLowerCase());
    expect(labels).toEqual(expect.arrayContaining(["#ffffff", "#ff0000"]));
    await shot(page, "34-palette");
  });
});

test.describe("PDF export", () => {
  test("one page per frame", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const L = (window as any).__lumen;
      const els = L.restore(
        [
          { type: "frame", id: "f1", name: "One", x: 0, y: 0, width: 600, height: 400 },
          { type: "frame", id: "f2", name: "Two", x: 800, y: 0, width: 600, height: 400 },
          { type: "frame", id: "f3", name: "Three", x: 1600, y: 0, width: 400, height: 600 },
          { type: "rectangle", id: "r1", x: 50, y: 50, width: 200, height: 100, frameId: "f1", backgroundColor: "#ffd666", fillStyle: "solid" },
        ],
        null,
      );
      L.api.updateScene({ elements: els });
    });
    await page.locator('[data-testid="main-menu-trigger"]').click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid="export-pdf"]').click()]);
    expect(dl.suggestedFilename()).toBe("my-first-board.pdf");
    const bytes = readFileSync(await dl.path());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(3);
    await expect(page.locator('[data-testid="toast"]')).toContainText("3 pages");
  });

  test("no frames → the whole board on one page", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("r");
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(600, 420, { steps: 5 });
    await page.mouse.up();
    await page.locator('[data-testid="main-menu-trigger"]').click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid="export-pdf"]').click()]);
    const txt = readFileSync(await dl.path()).toString("latin1");
    expect((txt.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });
});
