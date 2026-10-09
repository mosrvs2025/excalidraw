import { describe, expect, it } from "vitest";
import { planOffline, parseArrows, outlineToDiagram, clusterItems } from "./local";
import { buildGraph, parseOutline, reviewGraph, type CanvasGraph, type CanvasItem } from "../canvas/context";
import { sanitizePlan } from "./schema";
import { suggestFor } from "./intents";
import { layoutGraph } from "../canvas/layout";
import { renderMarkdown } from "../live/runtime";

const item = (alias: string, text: string, extra: Partial<CanvasItem> = {}): CanvasItem => ({
  alias, id: alias, kind: "note", text, x: 0, y: 0, w: 180, h: 120, selected: true, ...extra,
});
const graph = (items: CanvasItem[], edges: CanvasGraph["edges"] = []): CanvasGraph => ({
  scope: "selection", items, edges,
  aliasToId: Object.fromEntries(items.map((i) => [i.alias, i.id])),
  idToAlias: Object.fromEntries(items.map((i) => [i.id, i.alias])),
  bounds: { x: 0, y: 0, w: 500, h: 300 },
});

describe("outline parsing", () => {
  it("handles bullets, numbering and indentation", () => {
    const o = parseOutline("- Plan\n  - Research\n  - Draft\n- Ship");
    expect(o.map((x) => [x.text, x.depth])).toEqual([["Plan", 0], ["Research", 1], ["Draft", 1], ["Ship", 0]]);
    expect(parseOutline("1. one\n2. two").map((x) => x.text)).toEqual(["one", "two"]);
  });
});

describe("arrow syntax", () => {
  it("builds nodes and edges, deduping by label", () => {
    const r = parseArrows("Idea -> Prototype -> Test\nTest -> Idea")!;
    expect(r.nodes.map((n) => n.label)).toEqual(["Idea", "Prototype", "Test"]);
    expect(r.edges).toHaveLength(3);
  });
  it("makes questions into decisions", () => {
    expect(parseArrows("Ready? -> Ship")!.nodes[0].shape).toBe("diamond");
  });
});

describe("offline planner", () => {
  it("structures a flat list as a sequence", () => {
    const g = graph([item("n1", "Wake up\nBrush teeth\nCoffee", { kind: "text" })]);
    const plan = planOffline({ prompt: "make a flow", intent: "flow", graph: g });
    const d = plan.ops[0] as any;
    expect(d.op).toBe("diagram");
    expect(d.nodes).toHaveLength(3);
    expect(d.edges).toHaveLength(2);
  });
  it("branches decisions from indented outlines", () => {
    const d = outlineToDiagram(parseOutline("Logged in?\n  Yes: Show dashboard\n  No: Show login"))!;
    expect(d.nodes[0].shape).toBe("diamond");
    expect(d.edges.map((e) => e.label)).toEqual(["Yes", "No"]);
  });
  it("clusters related notes together", () => {
    const texts = ["pricing tiers for teams", "free plan pricing limits", "annual pricing discount", "onboarding emails for new users", "welcome email sequence onboarding", "first-run onboarding checklist"];
    const items = texts.map((t, i) => item(`n${i}`, t, { x: (i % 3) * 200, y: Math.floor(i / 3) * 10 }));
    const cl = clusterItems(items, 2);
    const groupOf = (i: number) => cl.findIndex((c) => c.idx.includes(i));
    expect(groupOf(0)).toBe(groupOf(1));
    expect(groupOf(1)).toBe(groupOf(2));
    expect(groupOf(3)).toBe(groupOf(4));
    expect(groupOf(0)).not.toBe(groupOf(3));
    expect(cl.map((c) => c.title.toLowerCase()).join(" ")).toMatch(/pricing/);
  });
  it("review flags a decision with one exit and a missing connection", () => {
    const g = graph(
      [item("a", "Start", { kind: "shape", shape: "rectangle" }), item("b", "OK?", { kind: "shape", shape: "diamond" }), item("c", "Go", { kind: "shape", shape: "rectangle" }), item("d", "Lonely", { kind: "shape", shape: "rectangle" })],
      [{ from: "a", to: "b", id: "1" }, { from: "b", to: "c", id: "2" }],
    );
    const issues = reviewGraph(g);
    expect(issues.some((i) => i.alias === "b" && i.severity === "error")).toBe(true);
    expect(issues.some((i) => i.alias === "d")).toBe(true);
  });
  it("turns a drawn flow into a runnable app", () => {
    const g = graph(
      [item("a", "Start", { kind: "shape" }), item("b", "Choose?", { kind: "shape", shape: "diamond" }), item("c", "Left", { kind: "shape" }), item("d", "Right", { kind: "shape" })],
      [{ from: "a", to: "b", id: "1" }, { from: "b", to: "c", id: "2", label: "L" }, { from: "b", to: "d", id: "3", label: "R" }],
    );
    const p = planOffline({ prompt: "", intent: "app", graph: g });
    const app = p.ops[0] as any;
    expect(app.op).toBe("app");
    expect(app.html).toContain("Choose?");
  });
  it("scaffolds known boards by name and never invents unknown content", () => {
    const g = { ...graph([]), scope: "canvas" as const };
    expect((planOffline({ prompt: "set up a SWOT", graph: g }).ops[0] as any).columns).toHaveLength(4);
    const p = planOffline({ prompt: "explain quantum computing", graph: g });
    expect(p.say).toMatch(/Claude/);
  });
  it("picks templates for apps", () => {
    const g = { ...graph([]), scope: "canvas" as const };
    const p = planOffline({ prompt: "a pomodoro timer", intent: "app", graph: g });
    expect((p.ops[0] as any).html).toContain("Start");
  });
});

describe("plan sanitising", () => {
  it("drops garbage and dangling edges, keeps valid ops", () => {
    const p = sanitizePlan({
      say: "hi",
      ops: [
        { op: "diagram", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "zzz" }] },
        { op: "nope" }, null, { op: "notes", items: [] },
      ],
    });
    expect(p.ops).toHaveLength(1);
    expect((p.ops[0] as any).edges).toHaveLength(1);
  });
});

describe("suggestions + layout + markdown", () => {
  it("offers different verbs for different selections", () => {
    const notes = graph([item("a", "x"), item("b", "y"), item("c", "z")]);
    expect(suggestFor(notes)[0].id).toBe("cluster");
    const flow = graph([item("a", "x", { kind: "shape" }), item("b", "y", { kind: "shape" }), item("c", "z", { kind: "shape" })], [{ from: "a", to: "b", id: "1" }]);
    expect(suggestFor(flow)[0].id).toBe("app");
  });
  it("lays out without overlaps", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => ({ id, w: 120, h: 60 }));
    for (const layout of ["flow-down", "flow-right", "mindmap", "tree-right"] as const) {
      const pos = layoutGraph(nodes, [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "c", to: "d" }, { from: "c", to: "e" }], layout);
      const rs = nodes.map((n) => ({ ...pos.get(n.id)!, w: n.w, h: n.h }));
      for (let i = 0; i < rs.length; i++)
        for (let j = i + 1; j < rs.length; j++) {
          const o = rs[i].x < rs[j].x + rs[j].w && rs[j].x < rs[i].x + rs[i].w && rs[i].y < rs[j].y + rs[j].h && rs[j].y < rs[i].y + rs[i].h;
          expect(o, `${layout} ${i}/${j}`).toBe(false);
        }
    }
  });
  it("tree layout keeps outline order top-to-bottom and children to the right", () => {
    const nodes = ["root", "a", "b", "c", "a1", "a2"].map((id) => ({ id, w: 100, h: 50 }));
    const edges = [["root", "a"], ["root", "b"], ["root", "c"], ["a", "a1"], ["a", "a2"]].map(([from, to]) => ({ from, to }));
    const pos = layoutGraph(nodes, edges, "tree-right");
    expect(pos.get("a")!.y).toBeLessThan(pos.get("b")!.y);
    expect(pos.get("b")!.y).toBeLessThan(pos.get("c")!.y);
    expect(pos.get("a1")!.y).toBeLessThan(pos.get("a2")!.y);
    expect(pos.get("a")!.x).toBeGreaterThan(pos.get("root")!.x);
    expect(pos.get("a1")!.x).toBeGreaterThan(pos.get("a")!.x);
  });
  it("escapes html in markdown", () => {
    expect(renderMarkdown("# Hi <script>alert(1)</script>")).not.toContain("<script>");
    expect(renderMarkdown("- [x] done")).toContain("checked");
  });
  it("buildGraph is exported and handles empty", () => {
    expect(buildGraph([], []).items).toEqual([]);
  });
});
