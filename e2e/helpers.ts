import { expect, type Page } from "@playwright/test";

export const SHOTS = process.env.SHOTS_DIR || "test-results/shots";

export async function openApp(page: Page, path = "/") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.waitForSelector(".excalidraw-container");
  await page.waitForFunction(() => (window as any).__lumen?.api);
  await page.waitForTimeout(400);
  return errors;
}

export const scene = (page: Page) =>
  page.evaluate(() =>
    (window as any).__lumen.api.getSceneElements().map((e: any) => ({
      id: e.id, type: e.type, x: e.x, y: e.y, w: e.width, h: e.height, text: e.text, containerId: e.containerId,
      kind: e.customData?.lumen?.kind, lumen: e.customData?.lumen, startBinding: e.startBinding, endBinding: e.endBinding,
      frameId: e.frameId, isDeleted: e.isDeleted,
    })),
  );

export const count = async (page: Page, kind?: string) =>
  (await scene(page)).filter((e: any) => (kind ? e.kind === kind : true)).length;

export const toastText = (page: Page) => page.locator('[data-testid="toast"]').innerText();

export async function selectAll(page: Page) {
  await page.evaluate(() => {
    const api = (window as any).__lumen.api;
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(api.getSceneElements().map((e: any) => [e.id, true])) } });
  });
  await page.waitForTimeout(250);
}

export async function runPrompt(page: Page, text: string) {
  await page.locator('[data-testid="intent-input"]').fill(text);
  await page.locator('[data-testid="intent-input"]').press("Enter");
}

export async function waitIdle(page: Page) {
  await expect(page.locator(".dock-busy")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(250);
}

export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });
