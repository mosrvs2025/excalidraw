import { expect, test } from "@playwright/test";
import { count, openApp, runPrompt, scene, selectAll, shot } from "./helpers";
import { readFileSync } from "node:fs";

const addFrames = (page: any, n: number) =>
  page.evaluate((n: number) => {
    const L = (window as any).__lumen;
    const frames = L.restore(
      Array.from({ length: n }, (_, i) => ({ type: "frame", id: `fr${i}`, name: `Slide ${i + 1}`, x: i * 1400, y: 0, width: 1000, height: 600 })),
      null,
    );
    const label = L.restore([{ type: "text", id: "t0", x: 100, y: 100, text: "Hello slide", fontSize: 48, frameId: "fr0" }], null);
    L.api.updateScene({ elements: [...frames, ...label] });
  }, n);

test.describe("present mode", () => {
  test("frames are slides: arrows navigate, chrome hides, Esc exits", async ({ page }) => {
    await openApp(page);
    await addFrames(page, 3);
    await page.locator('[data-testid="main-menu-trigger"]').click();
    await page.locator('[data-testid="present"]').click();
    await expect(page.locator('[data-testid="present-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="slide-counter"]')).toHaveText("1 / 3");
    await expect(page.locator('[data-testid="dock"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__lumen.api.getAppState().viewModeEnabled)).toBe(true);
    const x0 = await page.evaluate(() => (window as any).__lumen.api.getAppState().scrollX);
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-testid="slide-counter"]')).toHaveText("2 / 3");
    await expect.poll(() => page.evaluate(() => (window as any).__lumen.api.getAppState().scrollX)).not.toBe(x0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight"); // clamps at the last slide
    await expect(page.locator('[data-testid="slide-counter"]')).toHaveText("3 / 3");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator('[data-testid="slide-counter"]')).toHaveText("2 / 3");
    await page.waitForTimeout(800);
    await expect(page.locator(".layer-ui__wrapper")).toBeHidden();
    await shot(page, "22-present");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="present-bar"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__lumen.api.getAppState().viewModeEnabled)).toBe(false);
    await expect(page.locator('[data-testid="intent-input"]')).toBeVisible();
  });
});

test.describe("export & interop", () => {
  test("Markdown + JSON Canvas export; JSON Canvas import (Obsidian-style) with groups as frames", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "Plan -> Build -> Launch");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Drew 3 steps");
    const menu = async (id: string) => (await page.locator('[data-testid="main-menu-trigger"]').click(), page.locator(`[data-testid="${id}"]`));

    let [dl] = await Promise.all([page.waitForEvent("download"), (await menu("export-md")).click()]);
    expect(dl.suggestedFilename()).toBe("my-first-board.md");
    expect(readFileSync(await dl.path(), "utf8")).toContain("Build");

    [dl] = await Promise.all([page.waitForEvent("download"), (await menu("export-jsoncanvas")).click()]);
    const jc = JSON.parse(readFileSync(await dl.path(), "utf8"));
    expect(jc.nodes.map((n: any) => n.text).sort()).toEqual(["Build", "Launch", "Plan"]);
    expect(jc.edges).toHaveLength(2);

    // import an Obsidian-style canvas into a fresh project
    await page.locator('[data-testid="project-name"]').click();
    await page.locator('[data-testid="new-project"]').click();
    await page.waitForFunction(() => (window as any).__lumen?.api.getSceneElements().length === 0);
    const obsidian = {
      nodes: [
        { id: "a", type: "text", text: "# Research", x: 0, y: 0, width: 220, height: 90, color: "4" },
        { id: "b", type: "text", text: "Write it up", x: 400, y: 0, width: 220, height: 90 },
        { id: "g", type: "group", label: "Phase 1", x: -40, y: -40, width: 700, height: 180 },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", label: "then" }],
    };
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (await menu("import-jsoncanvas")).click()]);
    await chooser.setFiles({ name: "plan.canvas", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(obsidian)) });
    await expect(page.locator('[data-testid="toast"]')).toContainText("Imported plan.canvas");
    const els = await scene(page);
    expect(els.filter((e) => e.type === "frame")).toHaveLength(1);
    expect(els.filter((e) => e.type === "rectangle")).toHaveLength(2);
    const arrow = els.find((e) => e.type === "arrow")!;
    expect(arrow.startBinding?.elementId && arrow.endBinding?.elementId).toBeTruthy();
    expect(els.some((e) => e.text === "Research")).toBe(true);
    await shot(page, "23-jsoncanvas-import");
  });

  test("a live object can be saved as a standalone HTML file that runs on its own", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "counter");
    await expect(page.locator('[data-testid="action-download"]')).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid="action-download"]').click()]);
    expect(dl.suggestedFilename()).toBe("counter.html");
    const html = readFileSync(await dl.path(), "utf8");
    expect(html).toContain("window.lumen");
    // open the exported file as a normal page: the bridge degrades gracefully, the app works
    const p2 = await page.context().newPage();
    await p2.setContent(html);
    await p2.getByRole("button", { name: "+" }).click();
    await p2.getByRole("button", { name: "+" }).click();
    await expect(p2.locator("#n")).toHaveText("2");
  });
});

test.describe("rough → refined", () => {
  test("freehand rectangle, circle and line become clean shapes; Undo restores the strokes", async ({ page }) => {
    await openApp(page);
    const stroke = async (pts: [number, number][]) => {
      await page.keyboard.press("p");
      await page.mouse.move(...pts[0]);
      await page.mouse.down();
      for (const p of pts.slice(1)) await page.mouse.move(...p);
      await page.mouse.up();
    };
    const wob = (i: number) => Math.round(Math.sin(i * 3.1) * 3);
    const rect: [number, number][] = [];
    for (let t = 0; t <= 1; t += 0.05) rect.push([420 + 220 * t, 250 + wob(rect.length)]);
    for (let t = 0.05; t <= 1; t += 0.05) rect.push([640 + wob(rect.length), 250 + 140 * t]);
    for (let t = 0.05; t <= 1; t += 0.05) rect.push([640 - 220 * t, 390 + wob(rect.length)]);
    for (let t = 0.05; t <= 1; t += 0.05) rect.push([420 + wob(rect.length), 390 - 140 * t]);
    await stroke(rect);
    const circle: [number, number][] = Array.from({ length: 41 }, (_, i) => [850 + 80 * Math.cos((i / 40) * 6.283) + wob(i), 320 + 60 * Math.sin((i / 40) * 6.283) + wob(i + 5)]);
    await stroke(circle);
    const line: [number, number][] = Array.from({ length: 20 }, (_, i) => [420 + i * 20, 520 + wob(i)]);
    await stroke(line);
    expect((await scene(page)).filter((e) => e.type === "freedraw")).toHaveLength(3);
    await page.keyboard.press("v");
    await selectAll(page);
    await expect(page.locator('[data-testid="intent-refine"]')).toBeVisible();
    await shot(page, "24-rough");
    await page.locator('[data-testid="intent-refine"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("Cleaned up 3 shapes");
    const els = await scene(page);
    expect(els.filter((e) => e.type === "freedraw")).toHaveLength(0);
    expect(els.map((e) => e.type).sort()).toEqual(["arrow", "ellipse", "rectangle"]);
    await shot(page, "25-refined");
    await page.locator('[data-testid="toast-undo"]').click();
    await expect.poll(async () => (await scene(page)).filter((e) => e.type === "freedraw").length).toBe(3);
  });
});

test.describe("voice", () => {
  test("dictation: speak, words appear, the canvas acts when you stop", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).SpeechRecognition = class {
        onresult: any; onend: any; onerror: any;
        start() {
          setTimeout(() => this.onresult?.({ results: [Object.assign([{ transcript: "kanban" }], { isFinal: true })] }), 60);
          setTimeout(() => this.onend?.(), 120);
        }
        stop() { this.onend?.(); }
      };
    });
    await openApp(page);
    await page.locator('[data-testid="mic"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("Kanban");
    expect(await count(page, "lane")).toBe(3);
  });
  test("no mic button where speech recognition isn't supported", async ({ page }) => {
    await page.addInitScript(() => { delete (window as any).SpeechRecognition; delete (window as any).webkitSpeechRecognition; });
    await openApp(page);
    await expect(page.locator('[data-testid="mic"]')).toHaveCount(0);
  });
});
