/**
 * JSON Canvas (https://jsoncanvas.org) interop — the open format Obsidian's Canvas uses.
 * Export: notes/shapes/text/frames/arrows → nodes/groups/edges. Import: the reverse, as Excalidraw skeletons.
 */
import { PALETTE } from "./palette";
import { edgePoint } from "./placement";

const PRESET: Record<string, keyof typeof PALETTE> = { "1": "red", "2": "orange", "3": "yellow", "4": "green", "5": "blue", "6": "purple" };
const NAME_TO_PRESET = Object.fromEntries(Object.entries(PRESET).map(([k, v]) => [v, k]));

function presetFor(bg: string | undefined): string | undefined {
  if (!bg) return undefined;
  for (const [name, c] of Object.entries(PALETTE)) if (c.bg.toLowerCase() === bg.toLowerCase()) return NAME_TO_PRESET[name];
  return undefined;
}

export interface JsonCanvas {
  nodes: any[];
  edges: any[];
}

export function exportJsonCanvas(elements: readonly any[]): JsonCanvas {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const textOf = (e: any) => {
    const t = e.boundElements?.find((b: any) => b.type === "text");
    const te = t && byId.get(t.id);
    return te ? (te.originalText ?? te.text) : "";
  };
  const nodes: any[] = [];
  const nodeIds = new Set<string>();
  for (const e of live) {
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) continue;
    let node: any = null;
    if (["rectangle", "ellipse", "diamond"].includes(e.type)) {
      const text = textOf(e);
      if (!text && e.customData?.lumen?.kind === "lane") continue;
      node = { type: "text", text };
    } else if (e.type === "text") node = { type: "text", text: e.originalText ?? e.text };
    else if (e.type === "frame" || e.type === "magicframe") node = { type: "group", label: e.name ?? "" };
    else if (e.type === "embeddable" && e.customData?.lumen) {
      const m = e.customData.lumen;
      node = { type: "text", text: m.kind === "doc" ? (m.markdown ?? "") : `**${m.title ?? "Live object"}**\n\n_(interactive object — open in Lumen)_` };
    }
    if (!node) continue;
    const color = presetFor(e.backgroundColor);
    nodes.push({ id: e.id, ...node, x: Math.round(e.x), y: Math.round(e.y), width: Math.round(e.width), height: Math.round(e.height), ...(color ? { color } : {}) });
    nodeIds.add(e.id);
  }
  const edges: any[] = [];
  for (const e of live) {
    if (e.type !== "arrow") continue;
    const from = e.startBinding?.elementId;
    const to = e.endBinding?.elementId;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
    const label = textOf(e);
    edges.push({ id: e.id, fromNode: from, toNode: to, ...(label ? { label } : {}) });
  }
  return { nodes, edges };
}

/** Skeletons for convertToExcalidrawElements (plain data so this stays unit-testable). */
export function importJsonCanvas(data: any, idPrefix = "jc"): any[] {
  const nodes: any[] = Array.isArray(data?.nodes) ? data.nodes.filter((n: any) => n && typeof n.id === "string" && Number.isFinite(n.x) && Number.isFinite(n.y)).slice(0, 2000) : [];
  const edges: any[] = Array.isArray(data?.edges) ? data.edges.slice(0, 4000) : [];
  const pid = (id: string) => `${idPrefix}-${id}`;
  const colorOf = (c: any) => {
    if (typeof c === "string" && PRESET[c]) return PALETTE[PRESET[c]];
    if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) return { bg: c + "33", stroke: c };
    return PALETTE.gray;
  };
  const labelFor = (n: any) =>
    n.type === "text" ? String(n.text ?? "") : n.type === "link" ? String(n.url ?? "") : n.type === "file" ? String(n.file ?? "").split("/").pop() || "" : "";
  const out: any[] = [];
  const rect = new Map<string, any>();
  const groups = nodes.filter((n) => n.type === "group");
  for (const n of nodes) {
    const width = Math.max(40, Number(n.width) || 250);
    const height = Math.max(30, Number(n.height) || 60);
    rect.set(n.id, { x: n.x, y: n.y, width, height, type: "rectangle" });
    if (n.type === "group") continue;
    const c = colorOf(n.color);
    const text = labelFor(n).replace(/[#*_`>]/g, "").trim().slice(0, 600);
    out.push({
      type: "rectangle", id: pid(n.id), x: n.x, y: n.y, width, height,
      backgroundColor: c.bg, strokeColor: c.stroke, fillStyle: "solid", strokeWidth: 1.5, roughness: 0, roundness: { type: 3 },
      ...(text ? { label: { text, fontSize: 16, textAlign: "left", verticalAlign: "top" } } : {}),
      ...(n.type === "link" && /^https?:\/\//.test(n.url) ? { link: n.url } : {}),
      customData: { lumen: { kind: "note" } },
    });
  }
  for (const g of groups) {
    const r = rect.get(g.id);
    const children = nodes
      .filter((n) => n.type !== "group" && n.x >= r.x && n.y >= r.y && n.x + (n.width || 250) <= r.x + r.width + 1 && n.y + (n.height || 60) <= r.y + r.height + 1)
      .map((n) => pid(n.id));
    out.push({ type: "frame", id: pid(g.id), name: String(g.label ?? "Group"), children, x: r.x, y: r.y, width: r.width, height: r.height });
  }
  for (const e of edges) {
    const A = rect.get(e.fromNode);
    const B = rect.get(e.toNode);
    if (!A || !B) continue;
    const [x1, y1] = edgePoint(A, B.x + B.width / 2, B.y + B.height / 2, 4);
    const [x2, y2] = edgePoint(B, A.x + A.width / 2, A.y + A.height / 2, 4);
    out.push({
      type: "arrow", x: x1, y: y1, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
      points: [[0, 0], [x2 - x1, y2 - y1]],
      start: { id: pid(e.fromNode) }, end: { id: pid(e.toNode) },
      roughness: 0, strokeColor: "#495057", strokeWidth: 2, endArrowhead: e.toEnd === "none" ? null : "arrow",
      ...(e.label ? { label: { text: String(e.label).slice(0, 80), fontSize: 14 } } : {}),
    });
  }
  return out;
}
