import { expect, test } from "@playwright/test";
import { count, openApp, runPrompt, scene, shot } from "./helpers";

const CSV = "Region,Revenue,Units\nNorth,12000,40\nSouth,8500,31\nEast,15200,52\nWest,9900,35";

test.describe("data live objects", () => {
  test("pasting CSV into the prompt makes an interactive chart + table (sandboxed, state saved)", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, CSV);
    await expect(page.locator('[data-testid="toast"]')).toContainText("chart + table");
    expect(await count(page, "app")).toBe(1);
    const f = page.frameLocator(".lo-body iframe").first();
    await expect(f.locator("svg rect[rx='3']")).toHaveCount(4); // one bar per region
    await expect(f.locator("#sum")).toContainText("4 rows");
    await expect(f.locator("#sum")).toContainText("Σ 45.6k");
    await shot(page, "26-data-chart");
    // the iframe lives under a CSS scale(); dispatch events directly
    await f.locator("#type").selectOption("pie");
    await expect(f.locator("svg path")).toHaveCount(4);
    await f.locator("[data-tab=table]").dispatchEvent("click");
    await expect(f.locator("table tbody tr")).toHaveCount(4);
    await f.locator("th", { hasText: "Revenue" }).dispatchEvent("click");
    await expect(f.locator("table tbody tr").first()).toContainText("South"); // ascending: 8,500 first
    await expect.poll(async () => (await scene(page)).find((e) => e.kind === "app")?.lumen?.state?.tab).toBe("table");
    await shot(page, "27-data-table");
  });

  test("dropping a .csv file onto the canvas creates it at the drop point", async ({ page }) => {
    await openApp(page);
    await page.evaluate((csv) => {
      const dt = new DataTransfer();
      dt.items.add(new File([csv], "sales.csv", { type: "text/csv" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: 700, clientY: 400, bubbles: true, cancelable: true }));
    }, CSV);
    await expect(page.locator('[data-testid="toast"]')).toContainText("Added sales.csv");
    const app = (await scene(page)).find((e) => e.kind === "app")!;
    expect(app.lumen.title).toBe("sales");
  });

  test("CSV text on the canvas offers 'Chart this data'; garbage is refused politely", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("t");
    await page.mouse.click(500, 300);
    await page.keyboard.type("Month,Sales");
    for (const row of ["Jan,5", "Feb,7", "Mar,6", "Apr,9"]) {
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.type(row);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="intent-data"]')).toBeVisible();
    await page.locator('[data-testid="intent-data"]').click();
    await expect.poll(() => count(page, "app")).toBe(1);
    const f = page.frameLocator(".lo-body iframe").first();
    await expect(f.locator("svg path[stroke]")).toBeVisible(); // months → a line chart
    await runPrompt(page, "chart of this data");
    await expect(page.locator('[data-testid="toast"]')).toBeVisible();
  });
});

test.describe("discoverability", () => {
  test("⌘K palette: run a command, fall back to asking, navigate by keyboard", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Control+k");
    await expect(page.locator('[data-testid="palette"]')).toBeVisible();
    await shot(page, "28-palette");
    await page.locator('[data-testid="palette-input"]').fill("template: retro");
    await page.keyboard.press("ArrowDown"); // → second hit… wrap-around is fine; Enter runs the highlighted row
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Retrospective");
    expect(await count(page, "lane")).toBe(3);
    // free text that matches no command is run as a prompt
    await page.keyboard.press("Control+k");
    await page.locator('[data-testid="palette-input"]').fill("Spec -> Build -> Ship");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Drew 3 steps");
    await page.keyboard.press("Control+k");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="palette"]')).toHaveCount(0);
  });

  test("template gallery lists every scaffold and builds the picked one", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-testid="main-menu-trigger"]').click();
    await page.locator('[data-testid="templates"]').click();
    await expect(page.locator('[data-testid="gallery"] button')).toHaveCount(9);
    await shot(page, "29-templates");
    await page.locator('[data-testid="template-eisenhower"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText("Priority matrix ready");
    expect(await count(page, "lane")).toBe(4);
  });
});
