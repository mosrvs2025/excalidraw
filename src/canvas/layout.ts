import dagre from "@dagrejs/dagre";
import type { DiagramLayout } from "../ai/schema";

export interface LNode {
  id: string;
  w: number;
  h: number;
}
export interface LEdge {
  from: string;
  to: string;
}
export type Positions = Map<string, { x: number; y: number }>;

const GAP_X = 70;
const GAP_Y = 56;

/** Lay a graph out. Returns top-left positions, normalised so the bbox starts at (0,0). */
export function layoutGraph(nodes: LNode[], edges: LEdge[], layout: DiagramLayout): Positions {
  if (!nodes.length) return new Map();
  const pos =
    layout === "mindmap"
      ? mindmap(nodes, edges)
      : layout === "tree-right" && edges.length <= nodes.length
        ? treeRight(nodes, edges)
        : layered(nodes, edges, layout);
  // normalise
  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  for (const p of pos.values()) {
    p.x -= minX;
    p.y -= minY;
  }
  return pos;
}

function layered(nodes: LNode[], edges: LEdge[], layout: DiagramLayout): Positions {
  const g = new dagre.graphlib.Graph();
  const horizontal = layout === "flow-right" || layout === "tree-right";
  g.setGraph({
    rankdir: horizontal ? "LR" : "TB",
    nodesep: horizontal ? GAP_Y : GAP_X * 0.6,
    ranksep: horizontal ? GAP_X : GAP_Y + 12,
    marginx: 0,
    marginy: 0,
    ranker: layout === "tree-right" ? "tight-tree" : "network-simplex",
  });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: n.w, height: n.h }));
  const ids = new Set(nodes.map((n) => n.id));
  edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).forEach((e) => g.setEdge(e.from, e.to));
  dagre.layout(g);
  const pos: Positions = new Map();
  for (const n of nodes) {
    const d = g.node(n.id);
    pos.set(n.id, { x: d.x - n.w / 2, y: d.y - n.h / 2 });
  }
  return pos;
}

export interface TreeInfo {
  root: string;
  children: Map<string, string[]>;
  depth: Map<string, number>;
  /** index of the root-child branch a node belongs to (root = -1) */
  branch: Map<string, number>;
}

/** Spanning tree rooted at the most connected node. Disconnected nodes hang off the root. */
export function analyzeTree(nodes: LNode[], edges: LEdge[]): TreeInfo {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  let root = nodes[0];
  for (const n of nodes) if (adj.get(n.id)!.length > adj.get(root.id)!.length) root = n;
  const children = new Map<string, string[]>();
  nodes.forEach((n) => children.set(n.id, []));
  const depth = new Map<string, number>([[root.id, 0]]);
  const seen = new Set([root.id]);
  const queue = [root.id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur)!) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      depth.set(nb, depth.get(cur)! + 1);
      children.get(cur)!.push(nb);
      queue.push(nb);
    }
  }
  for (const n of nodes)
    if (!seen.has(n.id)) {
      children.get(root.id)!.push(n.id);
      depth.set(n.id, 1);
    }
  const branch = new Map<string, number>([[root.id, -1]]);
  children.get(root.id)!.forEach((k, i) => {
    const stack = [k];
    while (stack.length) {
      const c = stack.pop()!;
      branch.set(c, i);
      stack.push(...children.get(c)!);
    }
  });
  return { root: root.id, children, depth, branch };
}

/** Left-to-right tidy tree that preserves sibling order (outline order stays reading order). */
function treeRight(nodes: LNode[], edges: LEdge[]): Positions {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  nodes.forEach((n) => children.set(n.id, []));
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to || hasParent.has(e.to)) continue;
    children.get(e.from)!.push(e.to);
    hasParent.add(e.to);
  }
  const seen = new Set<string>();
  const depthW: number[] = [];
  const sub = new Map<string, number>();
  const GAP = 20;
  const measure = (id: string, depth: number): number => {
    seen.add(id);
    const n = byId.get(id)!;
    depthW[depth] = Math.max(depthW[depth] ?? 0, n.w);
    const kids = children.get(id)!.filter((k) => !seen.has(k));
    children.set(id, kids);
    const kh = kids.length ? kids.reduce((s, k) => s + measure(k, depth + 1), 0) + (kids.length - 1) * GAP : 0;
    const h = Math.max(n.h, kh);
    sub.set(id, h);
    return h;
  };
  const roots = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);
  let total = 0;
  const topRoots: string[] = [];
  for (const r of roots.length ? roots : [nodes[0].id]) if (!seen.has(r)) (topRoots.push(r), (total += measure(r, 0) + GAP * 2));
  for (const n of nodes) if (!seen.has(n.id)) (topRoots.push(n.id), (total += measure(n.id, 0) + GAP * 2));
  const xAt: number[] = [];
  let x = 0;
  depthW.forEach((w, d) => {
    xAt[d] = x;
    x += w + GAP * 3.5;
  });
  const pos: Positions = new Map();
  const place = (id: string, depth: number, top: number) => {
    const n = byId.get(id)!;
    const h = sub.get(id)!;
    pos.set(id, { x: xAt[depth], y: top + h / 2 - n.h / 2 });
    const kids = children.get(id)!;
    const kh = kids.length ? kids.reduce((s, k) => s + sub.get(k)!, 0) + (kids.length - 1) * GAP : 0;
    let y = top + (h - kh) / 2;
    for (const k of kids) {
      place(k, depth + 1, y);
      y += sub.get(k)! + GAP;
    }
  };
  let cursor = 0;
  for (const r of topRoots) {
    place(r, 0, cursor);
    cursor += sub.get(r)! + GAP * 2;
  }
  return pos;
}

function mindmap(nodes: LNode[], edges: LEdge[]): Positions {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { root: rootId, children } = analyzeTree(nodes, edges);
  const root = byId.get(rootId)!;

  const subtreeH = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = children.get(id)!;
    const own = byId.get(id)!.h;
    const kh = kids.length ? kids.reduce((s, k) => s + measure(k), 0) + (kids.length - 1) * 18 : 0;
    const h = Math.max(own, kh);
    subtreeH.set(id, h);
    return h;
  };
  measure(root.id);

  // split root children into two balanced sides
  const left: string[] = [];
  const right: string[] = [];
  let lh = 0;
  let rh = 0;
  for (const k of children.get(root.id)!) {
    if (rh <= lh) {
      right.push(k);
      rh += subtreeH.get(k)!;
    } else {
      left.push(k);
      lh += subtreeH.get(k)!;
    }
  }

  const pos: Positions = new Map();
  pos.set(root.id, { x: -root.w / 2, y: -root.h / 2 });

  const place = (id: string, x: number, cy: number, dir: 1 | -1) => {
    const n = byId.get(id)!;
    const left = dir === 1 ? x : x - n.w;
    pos.set(id, { x: left, y: cy - n.h / 2 });
    const kids = children.get(id)!;
    if (!kids.length) return;
    const total = kids.reduce((s, k) => s + subtreeH.get(k)!, 0) + (kids.length - 1) * 18;
    let y = cy - total / 2;
    const nextX = dir === 1 ? x + n.w + GAP_X * 0.8 : x - n.w - GAP_X * 0.8;
    for (const k of kids) {
      const h = subtreeH.get(k)!;
      place(k, nextX, y + h / 2, dir);
      y += h + 18;
    }
  };
  const side = (ids: string[], dir: 1 | -1) => {
    if (!ids.length) return;
    const total = ids.reduce((s, k) => s + subtreeH.get(k)!, 0) + (ids.length - 1) * 18;
    let y = -total / 2;
    const x0 = dir === 1 ? root.w / 2 + GAP_X : -root.w / 2 - GAP_X;
    for (const k of ids) {
      const h = subtreeH.get(k)!;
      place(k, x0, y + h / 2, dir);
      y += h + 18;
    }
  };
  side(right, 1);
  side(left, -1);
  return pos;
}

/** Rough text size model for Excalifont/Nunito-ish at a given font size. */
export function measureLabel(label: string, fontSize = 18, maxChars = 24) {
  const lines = wrapText(label, maxChars);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return {
    text: lines.join("\n"),
    lines: lines.length,
    w: Math.ceil(longest * fontSize * 0.56),
    h: Math.ceil(lines.length * fontSize * 1.25),
  };
}

export function wrapText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + " " + word).length <= maxChars) line += " " + word;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/** Grid placement for n boxes of the same size. */
export function gridPositions(count: number, w: number, h: number, gap = 24, cols?: number) {
  const c = cols ?? Math.max(1, Math.ceil(Math.sqrt(count * 1.4)));
  return Array.from({ length: count }, (_, i) => ({
    x: (i % c) * (w + gap),
    y: Math.floor(i / c) * (h + gap),
  }));
}
