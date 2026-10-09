import { expect, test } from "@playwright/test";
import { count, openApp, runPrompt, scene, shot } from "./helpers";

test.describe("Mermaid", () => {
  test("typed Mermaid code is drawn as a native, editable diagram", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|Yes| C[Ship]\n  B -->|No| D[Fix]\n  D --> B");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Mermaid", { timeout: 20_000 });
    const els = await scene(page);
    const texts = els.filter((e) => e.type === "text").map((e) => e.text);
    expect(texts).toEqual(expect.arrayContaining(["Start", "Ready?", "Ship", "Fix"]));
    expect(els.filter((e) => e.type === "arrow").length).toBeGreaterThanOrEqual(4);
    await shot(page, "19-mermaid");
  });

  test("Mermaid text already on the canvas offers 'Draw this diagram'", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("t");
    await page.mouse.click(500, 300);
    await page.keyboard.type("sequenceDiagram");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Alice->>Bob: Hello");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="intent-mermaid"]')).toBeVisible();
    await page.locator('[data-testid="intent-mermaid"]').click();
    await expect.poll(async () => (await scene(page)).some((e) => e.text === "Hello"), { timeout: 20_000 }).toBe(true);
  });

  test("invalid Mermaid fails gracefully", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "flowchart TD\n  A[[[ -->");
    await expect(page.locator('[data-testid="toast"]')).toContainText(/didn't work|Couldn't/, { timeout: 20_000 });
  });
});

test("Read text: on-device OCR turns an image into a note, no AI key", async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1000; c.height = 220;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, 1000, 220);
    g.fillStyle = "#000"; g.font = "bold 80px Arial, sans-serif";
    g.fillText("LUMEN CANVAS 2026", 30, 130);
    const dataURL = c.toDataURL("image/png");
    const L = (window as any).__lumen;
    L.api.addFiles([{ id: "f1", mimeType: "image/png", dataURL, created: Date.now() }]);
    const [img] = L.restore([{ type: "image", x: 300, y: 300, width: 500, height: 110, fileId: "f1", status: "saved" }], null);
    L.api.updateScene({ elements: [img], appState: { selectedElementIds: { [img.id]: true } } });
  });
  await expect(page.locator('[data-testid="intent-ocr"]')).toBeVisible();
  await page.locator('[data-testid="intent-ocr"]').click();
  await expect.poll(async () => (await scene(page)).find((e) => e.kind === "answer") != null, { timeout: 100_000 }).toBe(true);
  const els = await scene(page);
  const ans = els.find((e) => e.kind === "answer")!;
  const body = (els.find((e) => e.containerId === ans.id)?.text ?? "").toUpperCase();
  expect(body).toContain("LUMEN");
  expect(body).toContain("2026");
  await shot(page, "20-ocr");
});

test.describe("live collaboration over the relay (two separate browsers)", () => {
  test("host shares a room, a second browser joins, edits sync both ways, link persists", async ({ browser }) => {
    const seed = (p: any) =>
      p.addInitScript(() => localStorage.setItem("lumen:settings", JSON.stringify({ provider: "anthropic", collabUrl: "ws://127.0.0.1:8787" })));
    const ctxA = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const a = await ctxA.newPage();
    await seed(a);
    await openApp(a);
    await runPrompt(a, "kanban");
    await expect(a.locator('[data-testid="toast"]')).toBeVisible();
    await a.locator('[data-testid="main-menu-trigger"]').click();
    await a.getByText("Share live…").click();
    await expect(a.locator('[data-testid="toast"]')).toContainText("Live link copied");
    const link = await a.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain("#room=");
    await expect(a.locator('[data-testid="live-badge"]')).toBeVisible();

    const b = await (await browser.newContext()).newPage(); // no shared storage: truly another "device"
    await seed(b);
    await openApp(b, link);
    await expect.poll(() => count(b, "lane"), { timeout: 15_000 }).toBe(3); // host's board arrives
    await expect(b.locator('[data-testid="presence"]')).toBeVisible({ timeout: 10_000 });

    await runPrompt(b, "Plan -> Build -> Launch");
    await expect.poll(async () => (await scene(a)).filter((e) => e.kind === "node").length, { timeout: 15_000 }).toBe(3);
    expect((await scene(a)).length).toBe((await scene(b)).length);
    await shot(b, "21-live-room-joiner");
  });

  test("without a relay configured, 'Share live' explains what's needed", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="main-menu-trigger"]').click();
    await page.getByText("Share live…").click();
    await expect(page.locator('[data-testid="collab-url"]')).toBeVisible();
  });
});
