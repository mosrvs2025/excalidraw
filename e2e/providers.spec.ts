import { expect, test } from "@playwright/test";
import { openApp, runPrompt, scene, shot } from "./helpers";

const op = { say: "Mapped it.", ops: [{ op: "diagram", layout: "flow-down", nodes: [{ id: "a", label: "One" }, { id: "b", label: "Two" }], edges: [{ from: "a", to: "b" }] }] };

async function connect(page: any, provider: string, key: string, extra?: () => Promise<void>) {
  await page.locator('[data-testid="open-settings"]').click();
  await page.locator(`[data-testid="provider-${provider}"]`).click();
  if (extra) await extra();
  await page.locator('[data-testid="api-key"]').fill(key);
  await page.locator('[data-testid="settings-save"]').click();
}

test.describe("any AI provider (optional)", () => {
  test("first run: friendly popup, skippable, works with no AI at all", async ({ page }) => {
    await openApp(page, "/", { onboarding: true });
    await expect(page.locator('[data-testid="onboarding"]')).toBeVisible();
    await shot(page, "17-onboarding");
    await page.locator('[data-testid="onboarding-skip"]').click();
    await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0);
    await runPrompt(page, "Idea -> Build -> Ship");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Drew 3 steps");
    await page.reload();
    await page.waitForFunction(() => (window as any).__lumen?.api);
    await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0); // only once
    await expect(page.locator(".engine")).toContainText("Offline");
  });

  test("onboarding can connect a provider and test the connection", async ({ page }) => {
    await page.route("https://generativelanguage.googleapis.com/**", (r) =>
      r.fulfill({ json: { candidates: [{ content: { parts: [{ functionCall: { name: "canvas_plan", args: op } }] } }] } }),
    );
    await openApp(page, "/", { onboarding: true });
    await page.locator('[data-testid="onboarding-connect"]').click();
    await page.locator('[data-testid="provider-gemini"]').click();
    await page.locator('[data-testid="api-key"]').fill("AIza-test");
    await page.locator('[data-testid="test-connection"]').click();
    await expect(page.locator('[data-testid="test-result"]')).toContainText("Connected");
    await shot(page, "18-connect-gemini");
    await page.locator('[data-testid="onboarding-save"]').click();
    await expect(page.locator(".engine")).toContainText("Gemini");
  });

  test("OpenAI: forced function call, image attached, plan executed", async ({ page }) => {
    let body: any;
    let auth = "";
    await page.route("https://api.openai.com/v1/chat/completions", (r) => {
      body = r.request().postDataJSON();
      auth = r.request().headers()["authorization"];
      return r.fulfill({ json: { choices: [{ message: { tool_calls: [{ function: { name: "canvas_plan", arguments: JSON.stringify(op) } }] } }] } });
    });
    await openApp(page);
    await connect(page, "openai", "sk-openai-test");
    await expect(page.locator(".engine")).toContainText("GPT");
    await page.locator('[data-testid="starter-outline"]').click();
    await expect(page.locator('[data-testid="intent-flow"]')).toBeVisible();
    await runPrompt(page, "map this");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Mapped it.");
    expect(auth).toBe("Bearer sk-openai-test");
    expect(body.model).toBe("gpt-4o");
    expect(body.tool_choice.function.name).toBe("canvas_plan");
    expect(JSON.stringify(body.messages)).toContain("data:image/png;base64,");
    expect((await scene(page)).filter((e) => e.kind === "node")).toHaveLength(2);
  });

  test("Gemini: functionCall args become canvas ops, key sent in header", async ({ page }) => {
    let body: any;
    let hdr = "";
    await page.route("https://generativelanguage.googleapis.com/**", (r) => {
      body = r.request().postDataJSON();
      hdr = r.request().headers()["x-goog-api-key"];
      return r.fulfill({ json: { candidates: [{ content: { parts: [{ functionCall: { name: "canvas_plan", args: op } }] } }] } });
    });
    await openApp(page);
    await connect(page, "gemini", "AIza-test");
    await runPrompt(page, "two steps please");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Mapped it.");
    expect(hdr).toBe("AIza-test");
    expect(body.toolConfig.functionCallingConfig.mode).toBe("ANY");
    expect((await scene(page)).filter((e) => e.kind === "node")).toHaveLength(2);
  });

  test("Custom OpenAI-compatible endpoint (e.g. Ollama / OpenRouter), JSON-in-text fallback, no key needed", async ({ page }) => {
    let url = "";
    await page.route("http://localhost:11434/**", (r) => {
      url = r.request().url();
      return r.fulfill({ json: { choices: [{ message: { content: "Sure!\n```json\n" + JSON.stringify(op) + "\n```" } }] } });
    });
    await openApp(page);
    await page.locator('[data-testid="open-settings"]').click();
    await page.locator('[data-testid="provider-custom"]').click();
    await page.locator('[data-testid="base-url"]').fill("http://localhost:11434/v1/");
    await page.locator('[data-testid="model"]').fill("llama3.1");
    await page.locator('[data-testid="settings-save"]').click();
    await expect(page.locator(".engine")).toContainText("Custom");
    await runPrompt(page, "go");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Mapped it.");
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
  });

  test("a bad key shows the provider's error in Test connection, and the app still works offline", async ({ page }) => {
    await page.route("https://api.openai.com/v1/chat/completions", (r) => r.fulfill({ status: 401, json: { error: { message: "Incorrect API key provided" } } }));
    await openApp(page);
    await page.locator('[data-testid="open-settings"]').click();
    await page.locator('[data-testid="provider-openai"]').click();
    await page.locator('[data-testid="api-key"]').fill("sk-bad");
    await page.locator('[data-testid="test-connection"]').click();
    await expect(page.locator('[data-testid="test-result"]')).toContainText("Incorrect API key");
    await page.locator('[data-testid="settings-save"]').click();
    await runPrompt(page, "A -> B");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Drew 2 steps"); // fell back to offline
  });
});
