/**
 * The contract between "intent" and "canvas".
 * Any engine (Claude, the offline engine, a future local model) returns a Plan,
 * and the canvas executes it. Plans are plain data: easy to validate, log, replay and undo.
 */

export const COLOR_NAMES = [
  "yellow",
  "blue",
  "green",
  "pink",
  "purple",
  "orange",
  "gray",
  "red",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export type NodeShape = "box" | "pill" | "diamond" | "ellipse" | "note";

export interface DiagramNode {
  id: string;
  label: string;
  shape?: NodeShape;
  color?: ColorName;
}
export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export type DiagramLayout = "flow-down" | "flow-right" | "mindmap" | "tree-right";

export type Op =
  | {
      op: "diagram";
      layout: DiagramLayout;
      title?: string;
      nodes: DiagramNode[];
      edges: DiagramEdge[];
    }
  | { op: "notes"; title?: string; items: { text: string; color?: ColorName }[] }
  | {
      op: "board";
      title?: string;
      columns: { title: string; items: string[]; color?: ColorName }[];
    }
  | { op: "cluster"; groups: { title: string; ids: string[]; color?: ColorName }[] }
  | { op: "app"; title: string; html: string; width?: number; height?: number }
  | { op: "doc"; title: string; markdown: string }
  | { op: "answer"; text: string; title?: string }
  | { op: "flag"; target: string; text: string; severity?: "info" | "warn" | "error" }
  | { op: "connect"; from: string; to: string; label?: string }
  | { op: "restyle"; ids: string[]; color: ColorName }
  | { op: "relayout"; layout: DiagramLayout }
  | { op: "delete"; ids: string[] };

export interface Plan {
  /** One sentence telling the human what just happened. */
  say: string;
  ops: Op[];
  /** Which engine produced this plan. */
  engine?: "claude" | "offline";
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const color = (v: unknown): ColorName | undefined =>
  (COLOR_NAMES as readonly string[]).includes(v as string) ? (v as ColorName) : undefined;
const LAYOUTS: DiagramLayout[] = ["flow-down", "flow-right", "mindmap", "tree-right"];
const SHAPES: NodeShape[] = ["box", "pill", "diamond", "ellipse", "note"];

/**
 * Models are probabilistic; the canvas is not. Everything an engine returns is
 * coerced into well-formed ops here, and anything unusable is dropped.
 */
export function sanitizePlan(raw: unknown): Plan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ops: Op[] = [];
  for (const o of arr<Record<string, unknown>>(r.ops)) {
    if (!o || typeof o !== "object") continue;
    switch (o.op) {
      case "diagram": {
        const nodes = arr<Record<string, unknown>>(o.nodes)
          .filter((n) => n && isStr(n.id) && isStr(n.label))
          .slice(0, 80)
          .map((n) => ({
            id: String(n.id),
            label: String(n.label).slice(0, 160),
            shape: SHAPES.includes(n.shape as NodeShape) ? (n.shape as NodeShape) : undefined,
            color: color(n.color),
          }));
        const ids = new Set(nodes.map((n) => n.id));
        const edges = arr<Record<string, unknown>>(o.edges)
          .filter((e) => e && ids.has(String(e.from)) && ids.has(String(e.to)))
          .slice(0, 200)
          .map((e) => ({
            from: String(e.from),
            to: String(e.to),
            label: isStr(e.label) ? String(e.label).slice(0, 60) : undefined,
          }));
        if (nodes.length)
          ops.push({
            op: "diagram",
            layout: LAYOUTS.includes(o.layout as DiagramLayout)
              ? (o.layout as DiagramLayout)
              : "flow-down",
            title: isStr(o.title) ? o.title : undefined,
            nodes,
            edges,
          });
        break;
      }
      case "notes": {
        const items = arr<Record<string, unknown>>(o.items)
          .filter((i) => i && isStr(i.text))
          .slice(0, 60)
          .map((i) => ({ text: String(i.text).slice(0, 400), color: color(i.color) }));
        if (items.length)
          ops.push({ op: "notes", title: isStr(o.title) ? o.title : undefined, items });
        break;
      }
      case "board": {
        const columns = arr<Record<string, unknown>>(o.columns)
          .filter((c) => c && isStr(c.title))
          .slice(0, 8)
          .map((c) => ({
            title: String(c.title).slice(0, 60),
            items: arr(c.items).filter(isStr).map((x) => String(x).slice(0, 200)).slice(0, 20),
            color: color(c.color),
          }));
        if (columns.length)
          ops.push({ op: "board", title: isStr(o.title) ? o.title : undefined, columns });
        break;
      }
      case "cluster": {
        const groups = arr<Record<string, unknown>>(o.groups)
          .filter((g) => g && isStr(g.title))
          .map((g) => ({
            title: String(g.title).slice(0, 80),
            ids: arr(g.ids).map(String),
            color: color(g.color),
          }))
          .filter((g) => g.ids.length);
        if (groups.length) ops.push({ op: "cluster", groups });
        break;
      }
      case "app":
        if (isStr(o.html))
          ops.push({
            op: "app",
            title: isStr(o.title) ? o.title : "Live object",
            html: String(o.html).slice(0, 200_000),
            width: Number(o.width) || undefined,
            height: Number(o.height) || undefined,
          });
        break;
      case "doc":
        if (isStr(o.markdown))
          ops.push({
            op: "doc",
            title: isStr(o.title) ? o.title : "Document",
            markdown: String(o.markdown).slice(0, 50_000),
          });
        break;
      case "answer":
        if (isStr(o.text))
          ops.push({
            op: "answer",
            text: String(o.text).slice(0, 4000),
            title: isStr(o.title) ? o.title : undefined,
          });
        break;
      case "flag":
        if (isStr(o.target) && isStr(o.text))
          ops.push({
            op: "flag",
            target: String(o.target),
            text: String(o.text).slice(0, 240),
            severity: ["info", "warn", "error"].includes(o.severity as string)
              ? (o.severity as "info" | "warn" | "error")
              : "warn",
          });
        break;
      case "connect":
        if (isStr(o.from) && isStr(o.to))
          ops.push({
            op: "connect",
            from: String(o.from),
            to: String(o.to),
            label: isStr(o.label) ? String(o.label) : undefined,
          });
        break;
      case "restyle": {
        const c = color(o.color);
        if (c) ops.push({ op: "restyle", ids: arr(o.ids).map(String), color: c });
        break;
      }
      case "relayout":
        if (LAYOUTS.includes(o.layout as DiagramLayout))
          ops.push({ op: "relayout", layout: o.layout as DiagramLayout });
        break;
      case "delete":
        ops.push({ op: "delete", ids: arr(o.ids).map(String) });
        break;
    }
  }
  return {
    say: isStr(r.say) ? String(r.say).slice(0, 300) : ops.length ? "Done." : "Nothing to do.",
    ops,
  };
}
