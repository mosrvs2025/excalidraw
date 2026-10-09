import { expect, test } from "@playwright/test";
import { count, openApp, runPrompt, scene, selectAll, shot, toastText, waitIdle } from "./helpers";

test.describe("drawing + context-aware intents", () => {
  test("native drawing still works: rectangle, freehand sketch, text", async ({ page }) => {
    const errors = await openApp(page);
    await page.keyboard.press("r");
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(700, 420, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("p");
    await page.mouse.move(800, 300);
    await page.mouse.down();
    for (let i = 0; i < 12; i++) await page.mouse.move(800 + i * 12, 300 + Math.sin(i) * 30);
    await page.mouse.up();
    const els = await scene(page);
    expect(els.some((e) => e.type === "rectangle")).toBe(true);
    expect(els.some((e) => e.type === "freedraw")).toBe(true);
    // welcome screen got out of the way
    await expect(page.locator(".welcome")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a lone sketch is offered 'Make it real'", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("p");
    await page.mouse.move(600, 300);
    await page.mouse.down();
    for (let i = 0; i < 10; i++) await page.mouse.move(600 + i * 15, 300 + (i % 2) * 40);
    await page.mouse.up();
    await page.keyboard.press("v");
    await page.mouse.click(640, 320);
    await expect(page.locator('[data-testid="intent-app"]')).toBeVisible();
  });

  test("brain-dump → Cluster animates notes into labelled themes, and Undo restores", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-braindump"]').click();
    await expect(page.locator('[data-testid="intent-cluster"]')).toBeVisible();
    const before = await scene(page);
    const posBefore = before.filter((e) => e.kind === "note").map((e) => `${Math.round(e.x)},${Math.round(e.y)}`);
    await shot(page, "01-braindump");
    await page.locator('[data-testid="intent-cluster"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("themes");
    await page.waitForTimeout(900);
    const after = await scene(page);
    const titles = after.filter((e) => e.type === "text" && !e.containerId).map((e) => e.text);
    expect(titles).toEqual(expect.arrayContaining(["Pricing", "Onboarding", "Mobile"]));
    expect(titles.length).toBe(5);
    expect(after.filter((e) => e.kind === "lane")).toHaveLength(5);
    const posAfter = after.filter((e) => e.kind === "note").map((e) => `${Math.round(e.x)},${Math.round(e.y)}`);
    expect(posAfter).not.toEqual(posBefore);
    // every note's bound text moved with it
    for (const n of after.filter((e) => e.kind === "note")) {
      const t = after.find((e) => e.containerId === n.id)!;
      expect(t.x).toBeGreaterThanOrEqual(n.x);
      expect(t.x).toBeLessThanOrEqual(n.x + n.w);
    }
    await shot(page, "02-clustered");
    await page.locator('[data-testid="toast-undo"]').click();
    await page.waitForTimeout(500);
    const undone = await scene(page);
    expect(undone.filter((e) => e.kind === "lane")).toHaveLength(0);
    expect(undone.filter((e) => e.kind === "note").map((e) => `${Math.round(e.x)},${Math.round(e.y)}`)).toEqual(posBefore);
  });

  test("typed arrow syntax becomes a real diagram with bound arrows", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "Idea -> Prototype -> Test -> Ship");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Drew 4 steps");
    const els = await scene(page);
    expect(els.filter((e) => e.kind === "node")).toHaveLength(4);
    const arrows = els.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(3);
    for (const a of arrows) {
      expect(a.startBinding?.elementId).toBeTruthy();
      expect(a.endBinding?.elementId).toBeTruthy();
      expect(a.w + a.h).toBeGreaterThan(20); // real geometry, not Excalidraw's 100px default
    }
    await shot(page, "03-typed-diagram");
  });

  test("known boards by name: kanban / SWOT", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "kanban");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Kanban");
    expect(await count(page, "lane")).toBe(3);
    await runPrompt(page, "set up a SWOT");
    await waitIdle(page);
    expect(await count(page, "lane")).toBe(3 + 4);
  });

  test("outline → structured flow; selection chips adapt; Tidy / mind-map work", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-outline"]').click();
    await expect(page.locator('[data-testid="intent-flow"]')).toBeVisible();
    await page.locator('[data-testid="intent-flow"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("Structured");
    const els = await scene(page);
    const nodes = els.filter((e) => e.kind === "node");
    expect(nodes.length).toBe(10);
    // decision became a diamond with Yes / No branches
    expect(nodes.some((e) => e.type === "diamond")).toBe(true);
    const labels = els.filter((e) => e.type === "text" && e.containerId && els.find((a) => a.id === e.containerId)?.type === "arrow").map((e) => e.text);
    expect(labels).toEqual(expect.arrayContaining(["Yes", "No"]));
    await shot(page, "04-outline-structured");
    // mind map it instead
    await selectAll(page);
    await expect(page.locator('[data-testid="intent-app"]')).toBeVisible(); // a drawn graph → "Make it run"
    await page.locator('[data-testid="intent-input"]').fill("tidy this up horizontally");
    await page.locator('[data-testid="intent-input"]').press("Enter");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Tidied");
    await page.waitForTimeout(900);
    const moved = (await scene(page)).filter((e) => e.type === "arrow");
    expect(moved.every((a) => a.w + a.h > 10)).toBe(true);
  });

  test("Find gaps annotates real problems on the canvas", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-flow"]').click();
    await page.locator('[data-testid="intent-review"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("Flagged");
    const flags = (await scene(page)).filter((e) => e.kind === "flag");
    expect(flags.length).toBe(1);
    const text = (await scene(page)).find((e) => e.containerId === flags[0].id)!;
    expect(text.text).toContain("Decision has 1 exit");
    await shot(page, "05-find-gaps");
  });

  test("Explain answers as a note on the canvas, tethered to its source", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-flow"]').click();
    await page.locator('[data-testid="intent-explain"]').click();
    await expect(page.locator('[data-testid="toast"]')).toBeVisible();
    const els = await scene(page);
    const ans = els.find((e) => e.kind === "answer")!;
    expect(ans).toBeTruthy();
    const body = els.find((e) => e.containerId === ans.id)!;
    expect(body.text).toContain("flow of 7 steps");
    expect(body.text).toContain("decision");
    // a dashed tether arrow was drawn from the source
    expect(els.filter((e) => e.type === "arrow").length).toBeGreaterThan(6);
  });

  test("Mind map: outline becomes a radial map rooted at its title", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-outline"]').click();
    await page.locator('[data-testid="intent-mindmap"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("Mind-mapped");
    const els = await scene(page);
    const nodes = els.filter((e) => e.kind === "node");
    expect(nodes.length).toBe(10);
    const root = els.find((e) => e.type === "text" && e.text === "Launch plan")!;
    const rootBox = nodes.find((n) => n.id === root.containerId)!;
    // branches fan out on both sides of the root
    const cx = rootBox.x + rootBox.w / 2;
    expect(nodes.some((n) => n.x + n.w / 2 < cx - 50)).toBe(true);
    expect(nodes.some((n) => n.x + n.w / 2 > cx + 50)).toBe(true);
    await shot(page, "15-mindmap");
  });
});
