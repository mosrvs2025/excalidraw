import { expect, test } from "@playwright/test";
import { openApp, runPrompt, scene } from "./helpers";

test("installable and fully usable offline after one visit", async ({ context, page }) => {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(async () => (await (await caches.open("lumen-v1")).keys()).length), { timeout: 15_000 }).toBeGreaterThan(5);
  const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((i: any) => i.sizes === "512x512")).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__lumen?.api);
  await runPrompt(page, "Think -> Sketch -> Ship");
  await expect(page.locator('[data-testid="toast"]')).toContainText("Drew 3 steps");
  expect((await scene(page)).filter((e) => e.kind === "node")).toHaveLength(3);
  await context.setOffline(false);
});
