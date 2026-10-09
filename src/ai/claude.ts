import { graphForModel, type CanvasGraph } from "../canvas/context";
import { BASE_CSS } from "../live/runtime";
import { COLOR_NAMES, sanitizePlan, type Plan } from "./schema";
import type { Settings } from "./settings";

const SYSTEM = `You are the intelligence inside Lumen, an infinite whiteboard. You do not chat: you act on the canvas by returning a plan of operations through the canvas_plan tool. The human sees your "say" line in a small status bar and sees your ops appear on the canvas.

You are given a JSON description of what is on the canvas (or the user's current selection): items (notes, text, shapes, sketches, images, live apps, docs) with ids like "n3", their text, position and size, and the connections (arrows) between them. If an image of the selection is attached, it is exactly what the user sees — use it to read sketches and handwriting.

Principles
- Do the thing. Prefer acting over explaining. "say" is ONE short sentence (max ~16 words) describing what you did.
- Use the user's own words and structure; improve and complete them, don't discard them.
- Choose the ops that fit: 
  • diagram: flowcharts, trees, mind maps, org charts, journeys (layout: flow-down | flow-right | tree-right | mindmap). Give every node a short label (≤ 8 words). Use shape "diamond" for decisions with labelled edges (Yes/No). Keep ≤ 25 nodes unless asked for more.
  • mermaid: ONLY when the user supplied Mermaid code (or asks for a sequence/class/ER/gantt diagram that diagram cannot express): put valid Mermaid in the "code" field.
  • notes: separate sticky notes (1–2 short sentences each).
  • board: columns with notes (kanban, SWOT, retro, pros/cons, comparison).
  • cluster: re-organise EXISTING items by id into labelled groups (ids must be item ids from the context).
  • app: a working interactive prototype or tool as ONE self-contained HTML document (see below).
  • doc: a written document (Markdown) when the user wants prose, a spec, a summary, a brief.
  • answer: a single note answering a question about the canvas. Keep it under 120 words.
  • flag: annotate an existing item (by id) with a short critique; severity info|warn|error. Use for reviews.
  • connect: draw an arrow between two existing items. relayout: tidy existing connected items. restyle / delete: use sparingly and only when asked.
- Several ops are fine (e.g. a diagram plus a doc).
- Never put chat, apologies, or markdown fences in "say".

Live apps (op "app")
- A single complete HTML document with inline <style> and <script>. NO external resources, fonts, CDNs, fetches or images by URL. Everything must work offline inside a sandboxed iframe.
- Size: width 360–560, height 300–560. Make it responsive and polished: real interactions, hover/focus states, empty states, no lorem ipsum.
- Theme: CSS variables are provided: --bg --fg --mut --line --card --acc --acc2 --ok --bad, with dark mode applied via html[data-theme=dark]. Use them. Base styles for button/input are provided.
- State persists through window.lumen: read window.lumen.state (any JSON, may be null) on load and call window.lumen.save(obj) after changes. Do not use localStorage/cookies (sandboxed).
- If the user sketched a UI, reproduce its structure and labels faithfully and make every control work.

Colors available: ${COLOR_NAMES.join(", ")}.`;

const TOOL = {
  name: "canvas_plan",
  description: "Return the operations to perform on the canvas.",
  input_schema: {
    type: "object",
    required: ["say", "ops"],
    properties: {
      say: { type: "string", description: "One short sentence about what you did." },
      ops: {
        type: "array",
        items: {
          type: "object",
          required: ["op"],
          properties: {
            op: { type: "string", enum: ["diagram", "mermaid", "notes", "board", "cluster", "app", "doc", "answer", "flag", "connect", "relayout", "restyle", "delete"] },
            title: { type: "string" },
            layout: { type: "string", enum: ["flow-down", "flow-right", "tree-right", "mindmap"] },
            nodes: { type: "array", items: { type: "object", required: ["id", "label"], properties: { id: { type: "string" }, label: { type: "string" }, shape: { type: "string", enum: ["box", "pill", "diamond", "ellipse", "note"] }, color: { type: "string", enum: [...COLOR_NAMES] } } } },
            edges: { type: "array", items: { type: "object", required: ["from", "to"], properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } } } },
            items: { type: "array", items: { type: "object", required: ["text"], properties: { text: { type: "string" }, color: { type: "string", enum: [...COLOR_NAMES] } } } },
            columns: { type: "array", items: { type: "object", required: ["title", "items"], properties: { title: { type: "string" }, items: { type: "array", items: { type: "string" } }, color: { type: "string", enum: [...COLOR_NAMES] } } } },
            groups: { type: "array", items: { type: "object", required: ["title", "ids"], properties: { title: { type: "string" }, ids: { type: "array", items: { type: "string" } } } } },
            code: { type: "string", description: "Mermaid source for op mermaid" },
            html: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
            markdown: { type: "string" },
            text: { type: "string" },
            target: { type: "string" },
            severity: { type: "string", enum: ["info", "warn", "error"] },
            from: { type: "string" },
            to: { type: "string" },
            label: { type: "string" },
            ids: { type: "array", items: { type: "string" } },
            color: { type: "string", enum: [...COLOR_NAMES] },
          },
        },
      },
    },
  },
};

export interface ClaudeRequest {
  prompt: string;
  graph: CanvasGraph;
  /** PNG of the selection, base64 (no data: prefix) */
  imageBase64?: string;
  /** an existing live object being edited */
  editing?: { title?: string; html?: string; markdown?: string };
}

export function buildUserText(req: ClaudeRequest) {
  const ctx = JSON.stringify(graphForModel(req.graph));
  let text = `Canvas context (${req.graph.scope === "selection" ? "the user's current selection" : "the whole canvas — nothing is selected"}):\n${ctx}\n\n`;
  if (req.editing?.html)
    text += `The selection includes a live app titled "${req.editing.title ?? ""}". Its current HTML is below. When the request is about changing it, return an "app" op with the COMPLETE updated document (keep what works).\n<current_html>\n${req.editing.html.slice(0, 60000)}\n</current_html>\n\n`;
  if (req.editing?.markdown)
    text += `The selection includes a document titled "${req.editing.title ?? ""}". Current Markdown:\n<current_markdown>\n${req.editing.markdown.slice(0, 30000)}\n</current_markdown>\nWhen the request is about changing it, return a "doc" op with the COMPLETE updated document.\n\n`;
  return text + `Request: ${req.prompt}`;
}

export const systemPrompt = () => SYSTEM + `\n\nAvailable base CSS for apps (already injected; you may override):\n${BASE_CSS.slice(0, 1500)}`;
export { TOOL };

export function buildPayload(req: ClaudeRequest) {
  const content: any[] = [];
  if (req.imageBase64)
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: req.imageBase64 } });
  content.push({ type: "text", text: buildUserText(req) });
  return {
    max_tokens: 8000,
    system: systemPrompt(),
    messages: [{ role: "user", content }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "canvas_plan" },
  };
}

export function parseResponse(json: any): Plan {
  const block = json?.content?.find?.((c: any) => c.type === "tool_use" && c.name === "canvas_plan");
  if (!block) throw new Error(json?.error?.message || "Claude returned no plan");
  const plan = sanitizePlan(block.input);
  plan.engine = "claude";
  return plan;
}

/** Ask the server proxy whether a hosted key is configured. */
export async function probeServer(): Promise<boolean> {
  try {
    const r = await fetch("/api/ai", { method: "GET" });
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j.enabled);
  } catch {
    return false;
  }
}

export async function askClaude(req: ClaudeRequest, settings: Settings, viaServer: boolean, signal?: AbortSignal): Promise<Plan> {
  const payload = buildPayload(req);
  let res: Response;
  if (settings.apiKey) {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: settings.model, ...payload }),
    });
  } else if (viaServer) {
    res = await fetch("/api/ai", { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } else {
    throw new Error("Claude is not configured");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || json?.error || `Claude request failed (${res.status})`);
  return parseResponse(json);
}
