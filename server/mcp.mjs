#!/usr/bin/env node
// Lumen MCP server: lets any MCP client (Claude Desktop, Cursor, …) read and edit a live Lumen board.
//
// The agent joins the board's live room as just another peer. It reads state from the same sync messages
// browsers exchange, and writes by sending a *plan* (the same ops Lumen's own AI produces) that an open browser
// executes on the canvas — so everything an agent does is undoable, versioned and visible to all collaborators.
//
//   LUMEN_RELAY=wss://your-relay  LUMEN_ROOM=<room id>  node server/mcp.mjs
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { boardToText, mergeElements, summarizeBoard } from "./board.mjs";

const RELAY = (process.env.LUMEN_RELAY || "").replace(/\/+$/, "");
const ROOM = process.env.LUMEN_ROOM || "";
if (!RELAY || !ROOM) {
  console.error("Set LUMEN_RELAY (wss://… relay address) and LUMEN_ROOM (the room id from 'Share live…').");
  process.exit(1);
}

const me = randomUUID().slice(0, 8);
const elements = new Map();
const peers = new Map(); // id → last seen
const pending = new Map(); // plan id → resolver
let ws;
let ready = Promise.resolve();

function connect() {
  ws = new WebSocket(`${RELAY}/room/${encodeURIComponent(ROOM)}`);
  ready = new Promise((res) => ws.once("open", res));
  ws.on("open", hello);
  ws.on("message", (data) => {
    let m;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!m || m.from === me) return;
    if (m.t === "scene" && Array.isArray(m.elements)) mergeElements(elements, m.elements);
    else if (m.t === "hello") {
      if (!m.agent) peers.set(m.from, Date.now());
      if (!peers.has("__seen:" + m.from)) (peers.set("__seen:" + m.from, 1), hello()); // answer newcomers so they re-send the board
    } else if (m.t === "leave") peers.delete(m.from);
    else if (m.t === "plan-result" && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id));
  });
  ws.on("close", () => setTimeout(connect, 1500));
  ws.on("error", () => ws.close());
}
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify({ from: me, ...m }));
const hello = () => send({ t: "hello", name: "Agent", color: "#7048e8", agent: true });
connect();
setInterval(hello, 2500).unref();

const humans = () => [...peers].filter(([k, t]) => !k.startsWith("__seen:") && Date.now() - t < 7000).length;
async function waitForBoard(ms = 2500) {
  await ready;
  const t0 = Date.now();
  while (!elements.size && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100));
}

async function applyPlan(ops, say) {
  await ready;
  if (humans() === 0) {
    await new Promise((r) => setTimeout(r, 1500));
    if (humans() === 0) return { ok: false, message: "No one has this board open. Open the live link in a browser — the canvas is rendered there." };
  }
  const id = randomUUID().slice(0, 8);
  const result = new Promise((res) => pending.set(id, res));
  send({ t: "plan", id, plan: { say: say || "Agent update", ops } });
  const timeout = new Promise((res) => setTimeout(() => res({ ok: false, message: "Timed out waiting for the board to apply the change." }), 25000));
  return Promise.race([result, timeout]);
}
const text = (s) => ({ content: [{ type: "text", text: s }] });
const outcome = (r) => ({ ...text(r.ok ? `Done. ${r.message || ""}`.trim() : `Failed: ${r.message}`), isError: !r.ok });

const server = new McpServer({ name: "lumen", version: "0.1.0" });

server.tool("read_board", "Read the current Lumen board: every object (id, kind, text, position) and the connections between them.", {}, async () => {
  await waitForBoard();
  return text(boardToText(summarizeBoard(elements)));
});

server.tool(
  "add_notes",
  "Add sticky notes to the board (placed in free space near the viewer).",
  { notes: z.array(z.string()).min(1).max(40), title: z.string().optional() },
  async ({ notes, title }) => outcome(await applyPlan([{ op: "notes", title, items: notes.map((t) => ({ text: t })) }], `Added ${notes.length} notes`)),
);

server.tool(
  "add_diagram",
  "Add a diagram (flowchart, tree or mind map). Nodes need unique ids and labels; use shape 'diamond' for decisions.",
  {
    title: z.string().optional(),
    layout: z.enum(["flow-down", "flow-right", "tree-right", "mindmap"]).default("flow-down"),
    nodes: z.array(z.object({ id: z.string(), label: z.string(), shape: z.enum(["box", "pill", "diamond", "ellipse", "note"]).optional() })).min(1).max(60),
    edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })).default([]),
  },
  async (a) => outcome(await applyPlan([{ op: "diagram", ...a }], `Added diagram${a.title ? `: ${a.title}` : ""}`)),
);

server.tool("add_mermaid", "Draw Mermaid code (flowchart, sequence, class, ER, gantt, …) as native, editable shapes.", { code: z.string() }, async ({ code }) =>
  outcome(await applyPlan([{ op: "mermaid", code }], "Drew a Mermaid diagram")),
);

server.tool("add_data", "Add an interactive table + chart from CSV text (header row first).", { csv: z.string(), title: z.string().default("Data") }, async ({ csv, title }) =>
  outcome(await applyPlan([{ op: "data", csv, title }], `Added data: ${title}`)),
);

server.tool("add_doc", "Add a document card (Markdown).", { title: z.string(), markdown: z.string() }, async ({ title, markdown }) =>
  outcome(await applyPlan([{ op: "doc", title, markdown }], `Added document: ${title}`)),
);

server.tool(
  "add_app",
  "Add a live interactive app: ONE self-contained HTML document (inline CSS/JS, no external resources). It runs sandboxed on the canvas. window.lumen.state / window.lumen.save(obj) persist state.",
  { title: z.string(), html: z.string(), width: z.number().optional(), height: z.number().optional() },
  async (a) => outcome(await applyPlan([{ op: "app", ...a }], `Added app: ${a.title}`)),
);

server.tool(
  "apply_plan",
  "Advanced: apply raw Lumen ops. Ops: diagram, mermaid, data, notes, board{columns}, app, doc, answer{text}, flag{target,text,severity}, connect{from,to,label}, restyle{ids,color}, relayout{layout}, delete{ids}. Element ids come from read_board.",
  { ops: z.array(z.record(z.any())).min(1).max(20), say: z.string().optional() },
  async ({ ops, say }) => outcome(await applyPlan(ops, say)),
);

await server.connect(new StdioServerTransport());
