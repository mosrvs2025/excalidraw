import { expect, test } from "@playwright/test";
import { openApp, runPrompt, scene, shot } from "./helpers";

const plan = (input: any) => ({ content: [{ type: "tool_use", id: "tu_1", name: "canvas_plan", input }] });

test.describe("Claude engine (network mocked at the edge)", () => {
  test("bring-your-own-key: request carries canvas context + image, plan is executed", async ({ page }) => {
    let body: any;
    let headers: Record<string, string> = {};
    await page.route("https://api.anthropic.com/v1/messages", async (route) => {
      body = route.request().postDataJSON();
      headers = route.request().headers();
      await route.fulfill({
        json: plan({
          say: "Mapped your launch plan.",
          ops: [
            { op: "diagram", layout: "flow-right", title: "Launch", nodes: [{ id: "a", label: "Spec" }, { id: "b", label: "Build" }, { id: "c", label: "Ready?", shape: "diamond" }, { id: "d", label: "Ship" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d", label: "Yes" }] },
            { op: "answer", text: "Tip: add a rollback step." },
          ],
        }),
      });
    });
    await openApp(page);
    await page.locator('[data-testid="open-settings"]').click();
    await page.locator('[data-testid="api-key"]').fill("sk-ant-test");
    await page.locator('[data-testid="settings-save"]').click();
    await expect(page.locator(".engine")).toContainText("Claude");
    // something to look at, then ask in plain language
    await page.locator('[data-testid="starter-outline"]').click();
    await runPrompt(page, "make a launch plan out of this and tell me what's risky");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Mapped your launch plan.");
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(body.tool_choice).toEqual({ type: "tool", name: "canvas_plan" });
    const content = body.messages[0].content;
    expect(content.some((c: any) => c.type === "image" && c.source.data.length > 100)).toBe(true);
    const text = content.find((c: any) => c.type === "text").text;
    expect(text).toContain("Launch plan");
    expect(text).toContain("Request: make a launch plan");
    const els = await scene(page);
    expect(els.filter((e) => e.kind === "node")).toHaveLength(4);
    expect(els.some((e) => e.kind === "answer")).toBe(true);
    await shot(page, "14-claude-plan");
  });

  test("hosted mode: server proxy enables Claude for everyone, no key in the browser", async ({ page }) => {
    let posted: any;
    await page.route("**/api/ai", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
      posted = route.request().postDataJSON();
      return route.fulfill({ json: plan({ say: "Hosted ok.", ops: [{ op: "notes", items: [{ text: "from the server" }] }] }) });
    });
    await openApp(page);
    await expect(page.locator(".engine")).toContainText("Claude");
    await runPrompt(page, "brainstorm something");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Hosted ok.");
    expect(JSON.stringify(posted)).not.toContain("sk-ant");
    expect((await scene(page)).some((e) => e.text === "from the server")).toBe(true);
  });

  test("Claude failure degrades gracefully to the offline engine", async ({ page }) => {
    await page.route("https://api.anthropic.com/v1/messages", (r) => r.fulfill({ status: 529, json: { error: { message: "overloaded" } } }));
    await openApp(page);
    await page.locator('[data-testid="open-settings"]').click();
    await page.locator('[data-testid="api-key"]').fill("sk-ant-test");
    await page.locator('[data-testid="settings-save"]').click();
    await runPrompt(page, "Draft -> Review -> Publish");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Drew 3 steps");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Claude unavailable");
  });

  test("Claude can edit a selected live object in place", async ({ page }) => {
    await openApp(page);
    await runPrompt(page, "counter");
    await expect(page.locator('[data-testid="action-edit"]')).toBeVisible();
    let sent = "";
    await page.route("https://api.anthropic.com/v1/messages", async (route) => {
      sent = JSON.stringify(route.request().postDataJSON());
      await route.fulfill({ json: plan({ say: "Added a doubling button.", ops: [{ op: "app", title: "Counter 2", html: "<body><button id=d>Double</button></body>" }] }) });
    });
    await page.locator('[data-testid="open-settings"]').click();
    await page.locator('[data-testid="api-key"]').fill("sk-ant-test");
    await page.locator('[data-testid="settings-save"]').click();
    await runPrompt(page, "add a double button");
    await expect(page.locator('[data-testid="toast"]')).toContainText("doubling");
    expect(sent).toContain("current_html");
    const apps = (await scene(page)).filter((e) => e.kind === "app");
    expect(apps).toHaveLength(1); // edited in place, not duplicated
    expect(apps[0].lumen.title).toBe("Counter 2");
    await expect(page.frameLocator(".lo-body iframe").first().locator("#d")).toBeVisible();
  });
});
