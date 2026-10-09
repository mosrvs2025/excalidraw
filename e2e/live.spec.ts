import { expect, test } from "@playwright/test";
import { count, openApp, runPrompt, scene, selectAll, shot } from "./helpers";

test.describe("live objects", () => {
  test("a drawn flowchart becomes a runnable walkthrough whose state persists on the canvas", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-flow"]').click();
    await selectAll(page);
    await page.locator('[data-testid="intent-app"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("walk through");
    expect(await count(page, "app")).toBe(1);
    const frame = page.frameLocator(".lo-body iframe").first();
    await expect(frame.locator(".cur")).toContainText("Visit landing page");
    await shot(page, "06-flow-runner");
    // the iframe is only interactive once activated (Excalidraw's native "click to interact")
    const box = (await page.locator(".excalidraw__embeddable-container").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => page.evaluate(() => (window as any).__lumen.api.getAppState().activeEmbeddable?.state)).toBe("active");
    // the iframe lives under a CSS scale() transform; Playwright's coordinate hit-testing is unreliable there, so dispatch the click
    await frame.getByRole("button", { name: /Next/ }).dispatchEvent("click");
    await expect(frame.locator(".cur")).toContainText("Sign up");
    // the iframe lives under a CSS scale() transform; Playwright's coordinate hit-testing is unreliable there, so dispatch the click
    await frame.getByRole("button", { name: /Next/ }).dispatchEvent("click");
    await expect(frame.locator(".cur")).toContainText("Email verified?");
    await expect(frame.getByRole("button", { name: /Yes/ })).toBeVisible();
    await expect(frame.getByRole("button", { name: /No/ })).toBeVisible();
    // state round-trips through the sandbox bridge into the element
    await expect.poll(async () => (await scene(page)).find((e) => e.kind === "app")?.lumen?.state?.path?.length).toBe(3);
  });

  test("typed 'pomodoro timer' builds a working live object; sandbox is isolated", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "a pomodoro timer");
    await expect(page.locator('[data-testid="toast"]')).toContainText("timer");
    const iframe = page.locator(".lo-body iframe").first();
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-forms");
    const frame = page.frameLocator(".lo-body iframe").first();
    await expect(frame.locator("#tx")).toHaveText("25:00");
    // sandboxed apps cannot read the host's storage or DOM
    const probe = await page.frames().find((f) => f !== page.mainFrame())!.evaluate(() => {
      let storage = "ok";
      try { localStorage.getItem("x"); } catch { storage = "blocked"; }
      let parent = "ok";
      try { void (window.parent as any).document.title; } catch { parent = "blocked"; }
      return { storage, parent };
    });
    expect(probe).toEqual({ storage: "blocked", parent: "blocked" });
  });

  test("code editor: edit a live object's source and apply it to the canvas", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "counter");
    await expect(page.locator('[data-testid="action-edit"]')).toBeVisible();
    await page.locator('[data-testid="action-edit"]').click();
    const src = page.locator('[data-testid="live-source"]');
    const html = await src.inputValue();
    expect(html).toContain("<script>");
    await src.fill(html.replace("Reset", "Zero it"));
    await page.locator('[data-testid="live-save"]').click();
    const frame = page.frameLocator(".lo-body iframe").first();
    await expect(frame.getByRole("button", { name: "Zero it" })).toBeVisible();
    await shot(page, "07-live-counter");
  });

  test("duplicate + document cards", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="starter-flow"]').click();
    await selectAll(page);
    await page.locator('[data-testid="intent-doc"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("document");
    expect(await count(page, "doc")).toBe(1);
    await expect(page.locator(".lo-doc h1")).toBeVisible();
    await expect(page.locator(".lo-doc ol li").first()).toBeVisible();
    await page.locator('[data-testid="action-dup"]').click();
    expect(await count(page, "doc")).toBe(2);
    await shot(page, "08-doc-card");
  });
});
