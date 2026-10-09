import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";

/**
 * Canvas context: turns raw Excalidraw elements into what a human (or a model)
 * actually sees — notes, labelled boxes, connections — instead of rectangles and
 * bound-text fragments. Both engines consume this and nothing else.
 */

export type ItemKind =
  | "note"
  | "text"
  | "shape"
  | "sketch"
  | "image"
  | "app"
  | "doc"
  | "embed"
  | "frame"
  | "flag";

export interface CanvasItem {
  alias: string;
  id: string;
  kind: ItemKind;
  text: string;
  shape?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  selected: boolean;
}
export interface CanvasEdge {
  from: string; // alias
  to: string; // alias
  label?: string;
  id: string;
}
export interface CanvasGraph {
  scope: "selection" | "canvas";
  items: CanvasItem[];
  edges: CanvasEdge[];
  aliasToId: Record<string, string>;
  idToAlias: Record<string, string>;
  bounds: { x: number; y: number; w: number; h: number } | null;
}

export interface LumenMeta {
  kind: "app" | "doc" | "note" | "flag" | "answer" | "title";
  title?: string;
  html?: string;
  markdown?: string;
  severity?: string;
  /** which prompt/engine produced it */
  origin?: string;
}
export const getMeta = (el: { customData?: Record<string, any> }): LumenMeta | undefined =>
  el.customData?.lumen;

const isText = (e: ExcalidrawElement): e is ExcalidrawTextElement => e.type === "text";

export function buildGraph(
  elements: readonly ExcalidrawElement[],
  selectedIds: ReadonlySet<string> | readonly string[],
): CanvasGraph {
  const selected = new Set(selectedIds);
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const scope: CanvasGraph["scope"] = selected.size ? "selection" : "canvas";

  // selection → include frame children, and map bound text up to its container
  const included = new Set<string>();
  if (scope === "canvas") live.forEach((e) => included.add(e.id));
  else {
    for (const id of selected) {
      const e = byId.get(id);
      if (!e) continue;
      included.add(isText(e) && e.containerId && byId.has(e.containerId) ? e.containerId : id);
      if (e.type === "frame" || e.type === "magicframe")
        live.filter((c) => c.frameId === e.id).forEach((c) => included.add(c.id));
    }
  }

  const boundTextOf = (e: ExcalidrawElement): ExcalidrawTextElement | undefined => {
    const ref = e.boundElements?.find((b) => b.type === "text");
    const t = ref && byId.get(ref.id);
    return t && isText(t) ? t : undefined;
  };

  const items: CanvasItem[] = [];
  const aliasToId: Record<string, string> = {};
  const idToAlias: Record<string, string> = {};
  let n = 0;
  const addItem = (e: ExcalidrawElement, kind: ItemKind, text: string, shape?: string) => {
    const alias = `n${++n}`;
    aliasToId[alias] = e.id;
    idToAlias[e.id] = alias;
    items.push({
      alias,
      id: e.id,
      kind,
      text,
      shape,
      x: Math.round(e.x),
      y: Math.round(e.y),
      w: Math.round(e.width),
      h: Math.round(e.height),
      selected: selected.has(e.id),
    });
  };

  // stable reading order: top-to-bottom, left-to-right (with a row tolerance)
  const ordered = live
    .filter((e) => included.has(e.id))
    .sort((a, b) => (Math.abs(a.y - b.y) < 24 ? a.x - b.x : a.y - b.y));

  for (const e of ordered) {
    if (e.type === "arrow" || e.type === "line") continue;
    if (isText(e) && e.containerId && byId.has(e.containerId)) continue; // folded into container
    const meta = getMeta(e);
    switch (e.type) {
      case "text":
        addItem(e, "text", e.originalText ?? e.text);
        break;
      case "rectangle":
      case "ellipse":
      case "diamond": {
        const bt = boundTextOf(e);
        const t = bt?.originalText ?? bt?.text ?? "";
        const hasArrow = e.boundElements?.some((b) => b.type === "arrow");
        const kind: ItemKind =
          meta?.kind === "flag"
            ? "flag"
            : meta?.kind === "note" || (t && !hasArrow && e.type === "rectangle" && e.width < 360 && e.height < 360 && e.width / e.height < 2.2)
              ? "note"
              : "shape";
        addItem(e, kind, t, e.type);
        break;
      }
      case "freedraw":
        addItem(e, "sketch", "");
        break;
      case "image":
        addItem(e, "image", "");
        break;
      case "embeddable":
        addItem(
          e,
          meta?.kind === "app" ? "app" : meta?.kind === "doc" ? "doc" : "embed",
          meta?.title ?? "",
        );
        break;
      case "frame":
      case "magicframe":
        addItem(e, "frame", (e as any).name ?? "");
        break;
    }
  }

  const edges: CanvasEdge[] = [];
  for (const e of live) {
    if (e.type !== "arrow") continue;
    const a = e as any;
    const from = a.startBinding?.elementId && idToAlias[a.startBinding.elementId];
    const to = a.endBinding?.elementId && idToAlias[a.endBinding.elementId];
    if (from && to && from !== to)
      edges.push({ from, to, label: boundTextOf(e)?.originalText || boundTextOf(e)?.text || undefined, id: e.id });
  }

  let bounds: CanvasGraph["bounds"] = null;
  if (items.length) {
    const x1 = Math.min(...items.map((i) => i.x));
    const y1 = Math.min(...items.map((i) => i.y));
    const x2 = Math.max(...items.map((i) => i.x + i.w));
    const y2 = Math.max(...items.map((i) => i.y + i.h));
    bounds = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  return { scope, items, edges, aliasToId, idToAlias, bounds };
}

/* ───────────────────────── outline parsing ───────────────────────── */

export interface OutlineItem {
  text: string;
  depth: number;
}

/** Parse free text into an outline: bullets, numbering and indentation become depth. */
export function parseOutline(raw: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^(\s*)([-*•·>]+|\d+[.)]|[a-z][.)])?\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].replace(/\t/g, "  ").length;
    const text = m[3].trim();
    if (!text) continue;
    out.push({ text, depth: Math.floor(indent / 2) });
  }
  // normalize so the shallowest depth is 0 and no jump is greater than 1
  if (!out.length) return out;
  const min = Math.min(...out.map((o) => o.depth));
  let prev = 0;
  for (const o of out) {
    o.depth = Math.max(0, o.depth - min);
    o.depth = Math.min(o.depth, prev + 1);
    prev = o.depth;
  }
  return out;
}

/** All text in a graph as an outline, in reading order. */
export function graphOutline(g: CanvasGraph): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const i of g.items) {
    if (!i.text || (i.kind !== "text" && i.kind !== "note" && i.kind !== "shape")) continue;
    if (i.kind === "text" && i.text.includes("\n")) out.push(...parseOutline(i.text));
    else out.push({ text: i.text.replace(/\s*\n\s*/g, " ").trim(), depth: 0 });
  }
  return out;
}

/* ───────────────────────── selection profile ───────────────────────── */

export interface Profile {
  count: number;
  notes: number;
  texts: number;
  shapes: number;
  sketches: number;
  images: number;
  apps: number;
  docs: number;
  edges: number;
  outlineLines: number;
  multilineText: boolean;
}

export function profileOf(g: CanvasGraph): Profile {
  const c = (k: ItemKind) => g.items.filter((i) => i.kind === k).length;
  const outline = graphOutline(g);
  return {
    count: g.items.length,
    notes: c("note"),
    texts: c("text"),
    shapes: c("shape"),
    sketches: c("sketch"),
    images: c("image"),
    apps: c("app"),
    docs: c("doc"),
    edges: g.edges.length,
    outlineLines: outline.length,
    multilineText: g.items.some((i) => i.kind === "text" && i.text.includes("\n")),
  };
}

/* ───────────────────────── graph analysis ───────────────────────── */

export interface GraphIssue {
  alias: string;
  text: string;
  severity: "info" | "warn" | "error";
}

/** Deterministic structural review of a diagram. Works with no model at all. */
export function reviewGraph(g: CanvasGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const nodes = g.items.filter((i) => ["shape", "note"].includes(i.kind) && i.text);
  if (!nodes.length) return issues;
  const nodeSet = new Set(nodes.map((n) => n.alias));
  const out = new Map<string, CanvasEdge[]>();
  const inn = new Map<string, CanvasEdge[]>();
  for (const e of g.edges) {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) continue;
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    inn.set(e.to, [...(inn.get(e.to) ?? []), e]);
  }
  const connected = (a: string) => (out.get(a)?.length ?? 0) + (inn.get(a)?.length ?? 0) > 0;
  const hasAny = g.edges.length > 0;
  const sinks = nodes.filter((n) => connected(n.alias) && (out.get(n.alias)?.length ?? 0) === 0);

  for (const n of nodes) {
    const o = out.get(n.alias) ?? [];
    const i = inn.get(n.alias) ?? [];
    if (hasAny && !connected(n.alias))
      issues.push({ alias: n.alias, text: "Not connected to anything", severity: "warn" });
    else if (n.shape === "diamond") {
      if (o.length < 2 && hasAny)
        issues.push({
          alias: n.alias,
          text: `Decision has ${o.length} exit${o.length === 1 ? "" : "s"} — needs at least 2 branches`,
          severity: "error",
        });
      else if (o.some((e) => !e.label))
        issues.push({ alias: n.alias, text: "Unlabelled branches (yes/no?)", severity: "warn" });
    } else if (hasAny && sinks.length > 1 && o.length === 0 && i.length > 0) {
      // dead ends are fine for terminal nodes; only call out ones that don't look terminal
      if (!/\b(end|done|finish|complete|stop|success|fail|deliver|ship|launch|publish|exit|close)/i.test(n.text))
        issues.push({ alias: n.alias, text: "Dead end — where does this lead?", severity: "info" });
    }
  }
  // cycles with no exit
  const color = new Map<string, number>();
  let cycleAt: string | null = null;
  const visit = (a: string) => {
    color.set(a, 1);
    for (const e of out.get(a) ?? []) {
      const c = color.get(e.to) ?? 0;
      if (c === 1) cycleAt ??= e.to;
      else if (c === 0) visit(e.to);
    }
    color.set(a, 2);
  };
  nodes.forEach((n) => !color.get(n.alias) && visit(n.alias));
  if (cycleAt) {
    const hasExit = nodes.some((n) => (out.get(n.alias)?.length ?? 0) === 0 && connected(n.alias));
    if (!hasExit)
      issues.push({ alias: cycleAt, text: "Loop with no way out", severity: "error" });
  }
  // duplicate labels
  const seen = new Map<string, CanvasItem>();
  for (const n of nodes) {
    const k = n.text.toLowerCase().replace(/\s+/g, " ").trim();
    const prev = seen.get(k);
    if (prev) issues.push({ alias: n.alias, text: `Duplicate of “${prev.text}”`, severity: "info" });
    else seen.set(k, n);
  }
  return issues;
}

/** Compact JSON for a model prompt. */
export function graphForModel(g: CanvasGraph) {
  return {
    scope: g.scope,
    items: g.items.map((i) => ({
      id: i.alias,
      kind: i.kind,
      ...(i.text ? { text: i.text.slice(0, 300) } : {}),
      ...(i.shape && i.kind === "shape" ? { shape: i.shape } : {}),
      at: [i.x, i.y],
      size: [i.w, i.h],
    })),
    connections: g.edges.map((e) => ({ from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}) })),
  };
}
