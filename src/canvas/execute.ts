import {
  convertToExcalidrawElements,
  CaptureUpdateAction,
  newElementWith,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ColorName, DiagramNode, Op, Plan } from "../ai/schema";
import { buildGraph, getMeta, type CanvasGraph, type LumenMeta } from "./context";
import {
  analyzeTree,
  gridPositions,
  layoutGraph,
  measureLabel,
  type LEdge,
  type LNode,
} from "./layout";
import { BRANCH_CYCLE, PALETTE } from "./palette";

/* Fonts: 5 = Excalifont (hand), 6 = Nunito (clean) */
const FONT_HAND = 5;
const FONT_CLEAN = 6;

export const LIVE_HOST = "https://lumen.live";
export const liveLink = (id: string) => `${LIVE_HOST}/o/${id}`;

let counter = 0;
export const uid = (p = "l") =>
  `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Sk = ExcalidrawElementSkeleton;
interface Placed {
  sk: Sk[];
  w: number;
  h: number;
  /** ids of "primary" elements the user should end up selecting */
  focus: string[];
}

/* ───────────────────────── element builders (pure) ───────────────────────── */

export function buildDiagram(
  op: Extract<Op, { op: "diagram" }>,
  ox: number,
  oy: number,
): Placed {
  const run = uid("d");
  const nid = (id: string) => `${run}-${id}`;
  const edgesIdx: LEdge[] = op.edges.map((e) => ({ from: e.from, to: e.to }));
  const hasIncoming = new Set(op.edges.map((e) => e.to));
  const hasOutgoing = new Set(op.edges.map((e) => e.from));
  const flowish = op.layout !== "mindmap";

  // size nodes
  const sized = op.nodes.map((n) => {
    const shape = n.shape ?? "box";
    const m = measureLabel(n.label, 18, shape === "diamond" ? 16 : 26);
    let w = Math.max(128, m.w + 44);
    let h = Math.max(56, m.h + 30);
    if (shape === "diamond") {
      w = Math.max(160, m.w * 1.55 + 40);
      h = Math.max(96, m.h * 1.9 + 36);
    } else if (shape === "ellipse") {
      w = Math.max(140, m.w * 1.3 + 40);
      h = Math.max(72, m.h * 1.5 + 30);
    } else if (shape === "note") {
      w = Math.max(170, m.w + 40);
      h = Math.max(110, m.h + 50);
    }
    return { node: n, shape, m, w: Math.ceil(w), h: Math.ceil(h) };
  });
  const lnodes: LNode[] = sized.map((s) => ({ id: s.node.id, w: s.w, h: s.h }));
  const pos = layoutGraph(lnodes, edgesIdx, op.layout);
  const tree = op.layout === "mindmap" ? analyzeTree(lnodes, edgesIdx) : null;

  const titleH = op.title ? 56 : 0;
  const sk: Sk[] = [];
  let maxX = 0;
  let maxY = 0;
  const colorOf = (s: (typeof sized)[number]): ColorName => {
    if (s.node.color) return s.node.color;
    if (tree) {
      if (tree.root === s.node.id) return "purple";
      return BRANCH_CYCLE[(tree.branch.get(s.node.id) ?? 0) % BRANCH_CYCLE.length];
    }
    if (s.shape === "diamond") return "yellow";
    if (s.shape === "note") return "yellow";
    if (!hasIncoming.has(s.node.id) && hasOutgoing.has(s.node.id)) return "green";
    if (hasIncoming.has(s.node.id) && !hasOutgoing.has(s.node.id) && op.edges.length > 1) return "gray";
    return "blue";
  };

  for (const s of sized) {
    const p = pos.get(s.node.id)!;
    const x = ox + p.x;
    const y = oy + titleH + p.y;
    maxX = Math.max(maxX, p.x + s.w);
    maxY = Math.max(maxY, p.y + s.h);
    const c = PALETTE[colorOf(s)];
    const isRoot = tree?.root === s.node.id;
    const terminal =
      flowish &&
      s.shape === "box" &&
      !s.node.shape &&
      op.edges.length > 1 &&
      (!hasIncoming.has(s.node.id) || !hasOutgoing.has(s.node.id));
    sk.push({
      type: s.shape === "diamond" ? "diamond" : s.shape === "ellipse" ? "ellipse" : "rectangle",
      id: nid(s.node.id),
      x,
      y,
      width: s.w,
      height: s.h,
      backgroundColor: c.bg,
      strokeColor: c.stroke,
      fillStyle: "solid",
      strokeWidth: isRoot ? 3 : 2,
      roughness: 0,
      roundness:
        s.shape === "diamond" || s.shape === "ellipse"
          ? null
          : s.shape === "pill" || terminal || isRoot
            ? { type: 2, value: 0.5 }
            : { type: 3 },
      label: {
        text: s.m.text,
        fontSize: isRoot ? 22 : 18,
        fontFamily: s.shape === "note" ? FONT_HAND : FONT_CLEAN,
      },
      customData: { lumen: { kind: "node" } },
    } as Sk);
  }
  const rectOf = (id: string) => {
    const s = sized.find((q) => q.node.id === id)!;
    const p = pos.get(id)!;
    return { x: ox + p.x, y: oy + titleH + p.y, width: s.w, height: s.h, type: s.shape } as unknown as El;
  };
  const pairs = new Set(op.edges.map((e) => `${e.from}>${e.to}`));
  for (const e of op.edges) {
    if (!pos.has(e.from) || !pos.has(e.to)) continue;
    const A = rectOf(e.from);
    const B = rectOf(e.to);
    // opposite edges between the same pair would overlap exactly — nudge each sideways
    const twoWay = pairs.has(`${e.to}>${e.from}`);
    const acx = A.x + A.width / 2;
    const acy = A.y + A.height / 2;
    const bcx = B.x + B.width / 2;
    const bcy = B.y + B.height / 2;
    const len = Math.hypot(bcx - acx, bcy - acy) || 1;
    // two-way pairs bow out to opposite sides so both stay readable
    const bow = twoWay ? 34 : 0;
    const nx = (-(bcy - acy) / len) * bow;
    const ny = ((bcx - acx) / len) * bow;
    const [x1, y1] = edgePoint(A, bcx + nx, bcy + ny, 4);
    const [x2, y2] = edgePoint(B, acx + nx, acy + ny, 4);
    const branchColor = tree
      ? PALETTE[BRANCH_CYCLE[(tree.branch.get(e.to) ?? tree.branch.get(e.from) ?? 0) % BRANCH_CYCLE.length]].stroke
      : "#495057";
    sk.push({
      type: "arrow",
      x: x1,
      y: y1,
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      points: twoWay
        ? [
            [0, 0],
            [(x2 - x1) / 2 + nx, (y2 - y1) / 2 + ny],
            [x2 - x1, y2 - y1],
          ]
        : [
            [0, 0],
            [x2 - x1, y2 - y1],
          ],
      ...(twoWay ? { roundness: { type: 2 } } : {}),
      start: { id: nid(e.from) },
      end: { id: nid(e.to) },
      strokeColor: branchColor,
      strokeWidth: 2,
      roughness: 0,
      endArrowhead: tree ? null : "arrow",
      ...(e.label ? { label: { text: e.label, fontSize: 15, fontFamily: FONT_CLEAN } } : {}),
    } as Sk);
  }
  if (op.title)
    sk.push({
      type: "text",
      x: ox,
      y: oy,
      text: op.title,
      fontSize: 30,
      fontFamily: FONT_CLEAN,
      strokeColor: "#1e1e1e",
    } as Sk);
  return { sk, w: maxX, h: maxY + titleH, focus: sized.map((s) => nid(s.node.id)) };
}

export function buildNotes(op: Extract<Op, { op: "notes" }>, ox: number, oy: number): Placed {
  const rot: ColorName[] = ["yellow", "pink", "blue", "green", "orange", "purple"];
  const sizes = op.items.map((i) => measureLabel(i.text, 20, 22));
  const W = 200;
  const H = Math.max(130, ...sizes.map((m) => m.h + 56));
  const titleH = op.title ? 56 : 0;
  const grid = gridPositions(op.items.length, W, H, 22);
  const sk: Sk[] = [];
  const focus: string[] = [];
  let maxX = 0;
  let maxY = 0;
  op.items.forEach((it, i) => {
    const id = uid("n");
    const c = PALETTE[it.color ?? rot[i % rot.length]];
    focus.push(id);
    maxX = Math.max(maxX, grid[i].x + W);
    maxY = Math.max(maxY, grid[i].y + H);
    sk.push({
      type: "rectangle",
      id,
      x: ox + grid[i].x,
      y: oy + titleH + grid[i].y,
      width: W,
      height: H,
      backgroundColor: c.bg,
      strokeColor: c.stroke,
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 1,
      roundness: { type: 3 },
      label: { text: sizes[i].text, fontSize: 20, fontFamily: FONT_HAND },
      customData: { lumen: { kind: "note" } },
    } as Sk);
  });
  if (op.title)
    sk.push({
      type: "text",
      x: ox,
      y: oy,
      text: op.title,
      fontSize: 30,
      fontFamily: FONT_CLEAN,
    } as Sk);
  return { sk, w: maxX, h: maxY + titleH, focus };
}

export function buildBoard(op: Extract<Op, { op: "board" }>, ox: number, oy: number): Placed {
  const rot: ColorName[] = ["blue", "yellow", "green", "pink", "purple", "orange", "gray", "red"];
  const W = 210;
  const PAD = 16;
  const HEAD = 62;
  const titleH = op.title ? 58 : 0;
  const sk: Sk[] = [];
  const focus: string[] = [];
  let x = ox;
  let maxH = 0;
  op.columns.forEach((col, ci) => {
    const c = PALETTE[col.color ?? rot[ci % rot.length]];
    let y = oy + titleH + HEAD;
    const items = col.items.length ? col.items : [""];
    const cards = items.map((t) => {
      const m = measureLabel(t || " ", 18, 20);
      return { t, m, h: Math.max(78, m.h + 40) };
    });
    const laneH = HEAD + cards.reduce((s, k) => s + k.h + 14, 0) + PAD - 6;
    maxH = Math.max(maxH, laneH);
    sk.push({
      type: "rectangle",
      x,
      y: oy + titleH,
      width: W + PAD * 2,
      height: laneH,
      backgroundColor: c.bg + "66",
      strokeColor: c.stroke,
      strokeStyle: "dashed",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
      customData: { lumen: { kind: "lane" } },
    } as Sk);
    sk.push({
      type: "text",
      x: x + PAD,
      y: oy + titleH + 18,
      text: col.title,
      fontSize: 22,
      fontFamily: FONT_CLEAN,
      strokeColor: c.stroke,
    } as Sk);
    for (const k of cards) {
      const id = uid("c");
      focus.push(id);
      sk.push({
        type: "rectangle",
        id,
        x: x + PAD,
        y,
        width: W,
        height: k.h,
        backgroundColor: c.bg,
        strokeColor: c.stroke,
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 1,
        roundness: { type: 3 },
        ...(k.t ? { label: { text: k.m.text, fontSize: 18, fontFamily: FONT_HAND } } : {}),
        customData: { lumen: { kind: "note" } },
      } as Sk);
      y += k.h + 14;
    }
    x += W + PAD * 2 + 20;
  });
  if (op.title)
    sk.push({ type: "text", x: ox, y: oy, text: op.title, fontSize: 30, fontFamily: FONT_CLEAN } as Sk);
  return { sk, w: x - ox - 20, h: maxH + titleH, focus };
}

export function buildLive(
  kind: "app" | "doc",
  meta: LumenMeta,
  w: number,
  h: number,
  ox: number,
  oy: number,
): Placed {
  const id = uid("o");
  return {
    sk: [
      {
        type: "embeddable",
        id,
        x: ox,
        y: oy,
        width: w,
        height: h,
        link: liveLink(id),
        roughness: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        roundness: { type: 3 },
        customData: { lumen: { ...meta, kind } },
      } as unknown as Sk,
    ],
    w,
    h,
    focus: [id],
  };
}

export function buildAnswer(
  op: Extract<Op, { op: "answer" }>,
  ox: number,
  oy: number,
): Placed {
  const m = measureLabel(op.text, 20, 34);
  const w = Math.max(240, Math.min(460, m.w + 48));
  const h = Math.max(110, m.h + 56 + (op.title ? 30 : 0));
  const id = uid("a");
  const text = (op.title ? op.title + "\n\n" : "") + m.text;
  return {
    sk: [
      {
        type: "rectangle",
        id,
        x: ox,
        y: oy,
        width: w,
        height: h,
        backgroundColor: PALETTE.yellow.bg,
        strokeColor: PALETTE.yellow.stroke,
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 1,
        roundness: { type: 3 },
        strokeStyle: "solid",
        label: { text, fontSize: 18, fontFamily: FONT_HAND, textAlign: "left", verticalAlign: "top" },
        customData: { lumen: { kind: "answer" } },
      } as Sk,
    ],
    w,
    h,
    focus: [id],
  };
}

/* ───────────────────────── geometry helpers ───────────────────────── */

type El = ExcalidrawElement;

/** Point on element's outline along the ray from its centre toward (tx,ty). */
function edgePoint(e: El, tx: number, ty: number, gap = 6): [number, number] {
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const hw = e.width / 2;
  const hh = e.height / 2;
  let t: number;
  if (e.type === "ellipse") {
    t = 1 / Math.sqrt((ux * ux) / (hw * hw) + (uy * uy) / (hh * hh));
  } else if (e.type === "diamond") {
    t = 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh);
  } else {
    t = Math.min(hw / (Math.abs(ux) || 1e-9), hh / (Math.abs(uy) || 1e-9));
  }
  return [cx + ux * (t + gap), cy + uy * (t + gap)];
}

/** Re-route a straight bound arrow between its two endpoints after they moved. */
function routeArrow(arrow: El, a: El, b: El): Partial<El> {
  const [x1, y1] = edgePoint(a, b.x + b.width / 2, b.y + b.height / 2);
  const [x2, y2] = edgePoint(b, a.x + a.width / 2, a.y + a.height / 2);
  return {
    x: x1,
    y: y1,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    points: [
      [0, 0],
      [x2 - x1, y2 - y1],
    ],
  } as any;
}

/** Excalidraw measures text with the real font; make sure it is loaded before we build elements. */
export async function ensureFonts(sample = "") {
  if (typeof document === "undefined" || !document.fonts) return;
  const chars = (sample + " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?!.,:;-").slice(0, 600);
  try {
    await Promise.race([
      Promise.all([document.fonts.load("20px Excalifont", chars), document.fonts.load("18px Nunito", chars)]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to whatever is available */
  }
}

/* ───────────────────────── executor ───────────────────────── */

export interface ExecResult {
  created: string[];
  touched: string[];
  flagged: number;
}

interface Ctx {
  api: ExcalidrawImperativeAPI;
  graph: CanvasGraph;
  els: El[];
  created: El[];
  moves: Map<string, { x: number; y: number }>;
  touched: Set<string>;
  flagged: number;
  cursor: { x: number; y: number };
}

const byId = (els: readonly El[]) => new Map(els.map((e) => [e.id, e]));

function addSkeleton(ctx: Ctx, placed: Placed) {
  // embeddables are "iframe-like": the converter expects complete elements, so restore() fills defaults
  const embeds = placed.sk.filter((s) => s.type === "embeddable");
  const rest = placed.sk.filter((s) => s.type !== "embeddable");
  const made = [
    ...convertToExcalidrawElements(rest, { regenerateIds: false }),
    ...(restoreElements(embeds as any, null) as unknown as El[]),
  ];
  ctx.els.push(...made);
  ctx.created.push(...made);
  return made;
}

function setDims(ctx: Ctx, placed: Placed) {
  ctx.cursor.y += placed.h + 90;
}

export async function executePlan(
  api: ExcalidrawImperativeAPI,
  plan: Plan,
  opts: {
    graph: CanvasGraph;
    anchor: { x: number; y: number };
    /** "center" anchors are viewport centres; "corner" anchors are top-left origins */
    anchorMode: "center" | "corner";
    animate?: boolean;
  },
): Promise<ExecResult> {
  await ensureFonts(JSON.stringify(plan.ops).slice(0, 4000));
  const ctx: Ctx = {
    api,
    graph: opts.graph,
    els: [...api.getSceneElementsIncludingDeleted()] as El[],
    created: [],
    moves: new Map(),
    touched: new Set(),
    flagged: 0,
    cursor: { ...opts.anchor },
  };
  // for centre anchors we need op size before choosing origin
  const originFor = (w: number, h: number) =>
    opts.anchorMode === "center"
      ? { x: ctx.cursor.x - w / 2, y: ctx.cursor.y - h / 2 }
      : { x: ctx.cursor.x, y: ctx.cursor.y };

  const place = (build: (ox: number, oy: number) => Placed, measure: (() => { w: number; h: number })) => {
    // two-pass: measure with (0,0), then rebuild at the real origin
    const m = measure();
    const o = originFor(m.w, m.h);
    const placed = build(o.x, o.y);
    addSkeleton(ctx, placed);
    if (opts.anchorMode === "center") ctx.cursor.y += placed.h + 90;
    else setDims(ctx, placed);
    return placed;
  };

  let firstCreateAnchored = false;
  void firstCreateAnchored;

  for (const op of plan.ops) {
    switch (op.op) {
      case "diagram": {
        place(
          (ox, oy) => buildDiagram(op, ox, oy),
          () => {
            const p = buildDiagram(op, 0, 0);
            return { w: p.w, h: p.h };
          },
        );
        break;
      }
      case "notes":
        place(
          (ox, oy) => buildNotes(op, ox, oy),
          () => {
            const p = buildNotes(op, 0, 0);
            return { w: p.w, h: p.h };
          },
        );
        break;
      case "board":
        place(
          (ox, oy) => buildBoard(op, ox, oy),
          () => {
            const p = buildBoard(op, 0, 0);
            return { w: p.w, h: p.h };
          },
        );
        break;
      case "app": {
        const w = Math.min(900, Math.max(260, op.width ?? 440));
        const h = Math.min(800, Math.max(200, op.height ?? 360));
        place(
          (ox, oy) => buildLive("app", { kind: "app", title: op.title, html: op.html }, w, h, ox, oy),
          () => ({ w, h }),
        );
        break;
      }
      case "doc":
        place(
          (ox, oy) => buildLive("doc", { kind: "doc", title: op.title, markdown: op.markdown }, 440, 540, ox, oy),
          () => ({ w: 440, h: 540 }),
        );
        break;
      case "answer": {
        const p = place(
          (ox, oy) => buildAnswer(op, ox, oy),
          () => {
            const p = buildAnswer(op, 0, 0);
            return { w: p.w, h: p.h };
          },
        );
        // dashed tether back to what was asked about
        const srcItem = opts.graph.scope === "selection" ? opts.graph.items[0] : undefined;
        const made = ctx.els.find((e) => e.id === p.focus[0]);
        if (srcItem && made) {
          const src = ctx.els.find((e) => e.id === srcItem.id)!;
          const [x1, y1] = edgePoint(src, made.x, made.y + made.height / 2, 8);
          const [x2, y2] = edgePoint(made, src.x + src.width / 2, src.y + src.height / 2, 8);
          const arrows = convertToExcalidrawElements([
            {
              type: "arrow",
              x: x1,
              y: y1,
              width: x2 - x1,
              height: y2 - y1,
              points: [[0, 0], [x2 - x1, y2 - y1]],
              strokeStyle: "dashed",
              strokeColor: PALETTE.yellow.stroke,
              roughness: 1,
              endArrowhead: "arrow",
            } as Sk,
          ]);
          ctx.els.push(...arrows);
          ctx.created.push(...arrows);
        }
        break;
      }
      case "flag": {
        const id = ctx.graph.aliasToId[op.target];
        const t = id && ctx.els.find((e) => e.id === id);
        if (!t) break;
        const sev = op.severity ?? "warn";
        const c = PALETTE[sev === "error" ? "red" : sev === "warn" ? "orange" : "blue"];
        const m = measureLabel((sev === "error" ? "✕ " : sev === "warn" ? "⚠ " : "ℹ ") + op.text, 15, 30);
        const w = Math.max(120, m.w + 28);
        const h = m.h + 20;
        // pin the flag in the first free spot around its target: right, left, above, below
        const others = ctx.els.filter((e) => !e.isDeleted && e.id !== t.id && !(e as any).containerId && e.type !== "arrow" && e.type !== "line");
        const hits = (x: number, y: number) =>
          others.some((e) => x < e.x + e.width + 8 && x + w > e.x - 8 && y < e.y + e.height + 8 && y + h > e.y - 8);
        const spots: [number, number][] = [
          [t.x + t.width + 18, t.y + t.height / 2 - h / 2],
          [t.x - w - 18, t.y + t.height / 2 - h / 2],
          [t.x + t.width / 2 - w / 2, t.y - h - 16],
          [t.x + t.width / 2 - w / 2, t.y + t.height + 16],
        ];
        const [fx, fy] = spots.find(([x, y]) => !hits(x, y)) ?? spots[0];
        const made = addSkeleton(ctx, {
          sk: [
            {
              type: "rectangle",
              x: fx,
              y: fy,
              width: w,
              height: h,
              backgroundColor: c.bg,
              strokeColor: c.stroke,
              fillStyle: "solid",
              strokeWidth: 1.5,
              roughness: 0,
              roundness: { type: 3 },
              label: { text: m.text, fontSize: 15, fontFamily: FONT_CLEAN },
              customData: { lumen: { kind: "flag", severity: sev } },
            } as Sk,
          ],
          w,
          h,
          focus: [],
        });
        void made;
        ctx.flagged++;
        break;
      }
      case "connect": {
        const a = ctx.els.find((e) => e.id === (ctx.graph.aliasToId[op.from] ?? op.from));
        const b = ctx.els.find((e) => e.id === (ctx.graph.aliasToId[op.to] ?? op.to));
        if (!a || !b) break;
        const [x1, y1] = edgePoint(a, b.x + b.width / 2, b.y + b.height / 2);
        const [x2, y2] = edgePoint(b, a.x + a.width / 2, a.y + a.height / 2);
        const made = convertToExcalidrawElements([
          {
            type: "arrow",
            x: x1,
            y: y1,
            width: x2 - x1,
            height: y2 - y1,
            points: [[0, 0], [x2 - x1, y2 - y1]],
            roughness: 0,
            endArrowhead: "arrow",
            ...(op.label ? { label: { text: op.label, fontSize: 15 } } : {}),
          } as Sk,
        ]);
        const arrow = made.find((e) => e.type === "arrow")!;
        const bound = {
          ...arrow,
          startBinding: { elementId: a.id, focus: 0, gap: 6 },
          endBinding: { elementId: b.id, focus: 0, gap: 6 },
        } as El;
        ctx.els[ctx.els.indexOf(a)] = newElementWith(a, {
          boundElements: [...(a.boundElements ?? []), { id: arrow.id, type: "arrow" }],
        });
        ctx.els[ctx.els.indexOf(b)] = newElementWith(b, {
          boundElements: [...(b.boundElements ?? []), { id: arrow.id, type: "arrow" }],
        });
        const finalMade = made.map((e) => (e.id === arrow.id ? bound : e));
        ctx.els.push(...finalMade);
        ctx.created.push(...finalMade);
        break;
      }
      case "restyle": {
        for (const alias of op.ids) {
          const id = ctx.graph.aliasToId[alias] ?? alias;
          const i = ctx.els.findIndex((e) => e.id === id);
          if (i < 0) continue;
          const pal = PALETTE[op.color];
          ctx.els[i] = newElementWith(ctx.els[i], {
            backgroundColor: pal.bg,
            strokeColor: pal.stroke,
            fillStyle: "solid",
          } as any);
          ctx.touched.add(id);
        }
        break;
      }
      case "delete": {
        const kill = new Set(op.ids.map((a) => ctx.graph.aliasToId[a] ?? a));
        for (const e of [...ctx.els]) {
          const bound = (e as any).containerId && kill.has((e as any).containerId);
          const arrowLinked =
            e.type === "arrow" &&
            (kill.has((e as any).startBinding?.elementId) || kill.has((e as any).endBinding?.elementId));
          if (kill.has(e.id) || bound || arrowLinked) {
            const i = ctx.els.indexOf(e);
            ctx.els[i] = newElementWith(e, { isDeleted: true });
            ctx.touched.add(e.id);
          }
        }
        break;
      }
      case "cluster":
        planCluster(ctx, op);
        break;
      case "relayout":
        planRelayout(ctx, op.layout);
        break;
    }
  }

  const createdIds = ctx.created.map((e) => e.id);
  const animate = opts.animate !== false && ctx.moves.size > 0;

  if (!animate) {
    commit(ctx, 1);
    api.updateScene({
      elements: ctx.els,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  } else {
    await animateMoves(ctx);
  }
  return { created: createdIds, touched: [...ctx.touched, ...ctx.moves.keys()], flagged: ctx.flagged };
}

/* ───────────────────────── cluster + relayout ───────────────────────── */

function planCluster(ctx: Ctx, op: Extract<Op, { op: "cluster" }>) {
  const rot: ColorName[] = ["yellow", "blue", "green", "pink", "purple", "orange"];
  const idx = byId(ctx.els);
  const origin = ctx.graph.bounds ?? { x: ctx.cursor.x, y: ctx.cursor.y, w: 0, h: 0 };
  const sample = op.groups.flatMap((g) => g.ids.map((a) => idx.get(ctx.graph.aliasToId[a]))).find(Boolean);
  const W = Math.max(190, ...op.groups.flatMap((g) => g.ids.map((a) => idx.get(ctx.graph.aliasToId[a])?.width ?? 0)));
  const GAP = 18;
  const PAD = 18;
  const HEAD = 64;
  void sample;
  let x = origin.x;
  const lanes: Sk[] = [];
  op.groups.forEach((g, gi) => {
    const col = PALETTE[g.color ?? rot[gi % rot.length]];
    let y = origin.y + HEAD;
    for (const a of g.ids) {
      const el = idx.get(ctx.graph.aliasToId[a]);
      if (!el) continue;
      ctx.moves.set(el.id, { x: x + PAD + (W - el.width) / 2, y });
      y += el.height + GAP;
      // recolour notes into the lane colour so groups read at a glance
      const i = ctx.els.findIndex((e) => e.id === el.id);
      if (el.type === "rectangle" && getMeta(el)?.kind === "note")
        ctx.els[i] = newElementWith(el, { backgroundColor: col.bg, strokeColor: col.stroke } as any);
    }
    const laneH = Math.max(120, y - origin.y - HEAD + PAD + HEAD - GAP + 4);
    lanes.push({
      type: "rectangle",
      x,
      y: origin.y,
      width: W + PAD * 2,
      height: laneH,
      backgroundColor: col.bg + "55",
      strokeColor: col.stroke,
      strokeStyle: "dashed",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      opacity: 60,
      roundness: { type: 3 },
      customData: { lumen: { kind: "lane" } },
    } as Sk);
    lanes.push({
      type: "text",
      x: x + PAD,
      y: origin.y + 16,
      text: g.title,
      fontSize: 22,
      fontFamily: FONT_CLEAN,
      strokeColor: col.stroke,
    } as Sk);
    x += W + PAD * 2 + 28;
  });
  const made = convertToExcalidrawElements(lanes);
  // lanes go to the back so notes stay on top
  ctx.els.unshift(...made);
  ctx.created.push(...made);
}

function planRelayout(ctx: Ctx, layout: Extract<Op, { op: "relayout" }>["layout"]) {
  const idx = byId(ctx.els);
  const nodes = ctx.graph.items.filter((i) => ["shape", "note"].includes(i.kind));
  if (nodes.length < 2) return;
  const lnodes: LNode[] = nodes.map((n) => ({ id: n.id, w: n.w, h: n.h }));
  const ledges = ctx.graph.edges.map((e) => ({
    from: ctx.graph.aliasToId[e.from],
    to: ctx.graph.aliasToId[e.to],
  }));
  const pos = layoutGraph(lnodes, ledges, layout);
  const b = ctx.graph.bounds!;
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    if (idx.get(n.id)) ctx.moves.set(n.id, { x: b.x + p.x, y: b.y + p.y });
  }
}

/* ───────────────────────── commit + animation ───────────────────────── */

/** Apply moves at progress t∈[0,1], carrying bound text and re-routing bound arrows. */
function commit(ctx: Ctx, t: number, base?: Map<string, El>) {
  if (!ctx.moves.size) return;
  const start = base ?? byId(ctx.els);
  const idx = new Map<string, number>(ctx.els.map((e, i) => [e.id, i]));
  const ease = 1 - Math.pow(1 - t, 3);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [id, to] of ctx.moves) {
    const from = start.get(id);
    const i = idx.get(id);
    if (!from || i === undefined) continue;
    const x = from.x + (to.x - from.x) * ease;
    const y = from.y + (to.y - from.y) * ease;
    pos.set(id, { x, y });
    ctx.els[i] = newElementWith(ctx.els[i], { x, y });
    for (const bnd of from.boundElements ?? []) {
      if (bnd.type !== "text") continue;
      const ti = idx.get(bnd.id);
      const t0 = start.get(bnd.id);
      if (ti === undefined || !t0) continue;
      ctx.els[ti] = newElementWith(ctx.els[ti], {
        x: t0.x + (x - from.x),
        y: t0.y + (y - from.y),
      });
    }
  }
  // arrows between moved things
  const cur = byId(ctx.els);
  for (const e of ctx.els) {
    if (e.type !== "arrow" || e.isDeleted) continue;
    const s = (e as any).startBinding?.elementId;
    const en = (e as any).endBinding?.elementId;
    if (!s || !en || (!ctx.moves.has(s) && !ctx.moves.has(en))) continue;
    const a = cur.get(s);
    const b = cur.get(en);
    if (!a || !b) continue;
    const i = idx.get(e.id)!;
    const patch = routeArrow(e, a, b);
    ctx.els[i] = newElementWith(ctx.els[i], patch as any);
    const label = e.boundElements?.find((x) => x.type === "text");
    if (label) {
      const li = idx.get(label.id);
      if (li !== undefined) {
        const lt = ctx.els[li] as any;
        const ax = (patch as any).x + ((patch as any).points[1][0] ?? 0) / 2;
        const ay = (patch as any).y + ((patch as any).points[1][1] ?? 0) / 2;
        ctx.els[li] = newElementWith(ctx.els[li], { x: ax - lt.width / 2, y: ay - lt.height / 2 });
      }
    }
  }
}

/**
 * Animate moves while keeping exactly ONE undo step for the whole action.
 * Excalidraw records history deltas against its last snapshot, so frames can't be "folded" into a final commit.
 * Instead: commit the final scene (one history entry: before → after), let the store record it, then rewind the
 * *view* to the start with NEVER-captured frames and tween back to the final state. Undo reverts the whole action.
 */
async function animateMoves(ctx: Ctx): Promise<void> {
  const base = byId(ctx.els);
  const baseEls = [...ctx.els];
  const DURATION = 650;

  ctx.els = [...baseEls];
  commit(ctx, 1, base);
  const finalEls = [...ctx.els];
  ctx.api.updateScene({ elements: finalEls, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  await new Promise((r) => setTimeout(r, 0)); // let React commit + the store record the entry

  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION);
      ctx.els = [...baseEls];
      commit(ctx, t, base);
      ctx.api.updateScene({ elements: t >= 1 ? finalEls : ctx.els, captureUpdate: CaptureUpdateAction.NEVER });
      if (t >= 1) resolve();
      else requestAnimationFrame(frame);
    };
    // first frame (t = 0) runs synchronously so the rewind lands in the same paint as the commit
    frame(t0);
    // frame(t0) with t=0 may have resolved nothing; continue the tween
    requestAnimationFrame(frame);
  });
}

export { buildGraph };

/** Insert pre-built skeletons (used by the welcome starters). Returns created elements. */
export async function insertSkeleton(api: ExcalidrawImperativeAPI, sk: ExcalidrawElementSkeleton[]) {
  await ensureFonts(JSON.stringify(sk).slice(0, 4000));
  const made = convertToExcalidrawElements(sk, { regenerateIds: false });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...made],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return made;
}
