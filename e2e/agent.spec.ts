import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { count, openApp, runPrompt, scene, shot } from "./helpers";

const RELAY = "ws://127.0.0.1:8787";

test.describe("MCP agent bridge", () => {
  test("an MCP client reads the board and edits it live through the room", async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const page = await ctx.newPage();
    await page.addInitScript((relay) => localStorage.setItem("lumen:settings", JSON.stringify({ provider: "anthropic", collabUrl: relay })), RELAY);
    await openApp(page);
    await runPrompt(page, "Idea -> Prototype -> Test");
    await expect(page.locator('[data-testid="toast"]')).toContainText("Drew 3 steps");

    // the human opens the agent dialog, which creates the room and shows the exact config to paste
    await page.locator('[data-testid="main-menu-trigger"]').click();
    await page.locator('[data-testid="connect-agent"]').click();
    const cfg = JSON.parse(await page.locator('[data-testid="agent-config"]').innerText());
    const env = cfg.mcpServers.lumen.env;
    expect(env.LUMEN_RELAY).toBe(RELAY);
    expect(env.LUMEN_ROOM).toMatch(/^[a-z2-7]{12}$/);
    await shot(page, "30-agent-dialog");
    await page.keyboard.press("Escape");

    // an MCP client (what Claude Desktop / Cursor do) launches the server over stdio
    const client = new Client({ name: "test-agent", version: "1" });
    await client.connect(new StdioClientTransport({ command: "node", args: ["server/mcp.mjs"], env: { ...process.env, ...env } as Record<string, string> }));
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name);
      expect(tools).toEqual(expect.arrayContaining(["read_board", "add_notes", "add_diagram", "add_mermaid", "add_data", "add_doc", "add_app", "apply_plan"]));

      const read = async () => ((await client.callTool({ name: "read_board", arguments: {} })) as any).content[0].text as string;
      await expect.poll(read, { timeout: 15_000 }).toContain("Prototype");
      expect(await read()).toContain("Idea → Prototype");

      const added: any = await client.callTool({ name: "add_notes", arguments: { title: "Agent ideas", notes: ["Ship a beta", "Interview five users"] } });
      expect(added.isError).toBeFalsy();
      await expect.poll(async () => (await scene(page)).filter((e) => e.kind === "note").length).toBe(2);
      await expect(page.locator('[data-testid="toast"]')).toContainText("Added 2 notes");

      const csv: any = await client.callTool({ name: "add_data", arguments: { title: "Signups", csv: "Week,Users\nW1,10\nW2,25\nW3,40" } });
      expect(csv.isError).toBeFalsy();
      await expect.poll(() => count(page, "app")).toBe(1);

      const bad: any = await client.callTool({ name: "add_data", arguments: { csv: "not a table" } });
      expect(bad.isError).toBe(true);
      expect(bad.content[0].text).toMatch(/Failed/);

      // the agent sees its own changes and the whole board
      await expect.poll(read, { timeout: 10_000 }).toContain("Ship a beta");
      // and the human can undo what the agent did
      await page.locator('[data-testid="presence"]').waitFor({ state: "attached" });
      await shot(page, "31-agent-edits");
    } finally {
      await client.close();
    }
  });

  test("with no browser open, the agent gets a clear error instead of hanging", async () => {
    test.setTimeout(60_000);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StdioClientTransport({ command: "node", args: ["server/mcp.mjs"], env: { ...process.env, LUMEN_RELAY: RELAY, LUMEN_ROOM: "emptyroomxyz1" } as Record<string, string> }));
    try {
      const r: any = await client.callTool({ name: "add_notes", arguments: { notes: ["x"] } });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("No one has this board open");
    } finally {
      await client.close();
    }
  });
});
