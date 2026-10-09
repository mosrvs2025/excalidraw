import { describe, expect, it } from "vitest";
import { recognizeStroke, type Pt } from "./shapes";
import { exportJsonCanvas, importJsonCanvas } from "./jsoncanvas";

const wob = (n: number) => (Math.sin(n * 12.9898) * 43758.5453 % 1) * 3; // deterministic ±3px hand wobble
const walk = (corners: Pt[]) => {
  const out: Pt[] = [];
  corners.forEach((c, i) => {
    const d = corners[(i + 1) % corners.length];
    for (let t = 0; t < 1; t += 0.08) out.push([c[0] + (d[0] - c[0]) * t + wob(out.length), c[1] + (d[1] - c[1]) * t + wob(out.length + 7)]);
  });
  out.push([corners[0][0] + 4, corners[0][1] + 3]); // sloppy close
  return out;
};

describe("shape recognition", () => {
  it("rectangle, diamond, ellipse, line", () => {
    expect(recognizeStroke(walk([[0, 0], [200, 0], [200, 120], [0, 120]]))?.kind).toBe("rectangle");
    expect(recognizeStroke(walk([[100, 0], [200, 80], [100, 160], [0, 80]]))?.kind).toBe("diamond");
    const circle: Pt[] = Array.from({ length: 40 }, (_, i) => [100 + 100 * Math.cos((i / 40) * 2 * Math.PI) + wob(i), 60 + 60 * Math.sin((i / 40) * 2 * Math.PI) + wob(i + 3)]);
    circle.push([circle[0][0] + 3, circle[0][1] + 2]);
    expect(recognizeStroke(circle)?.kind).toBe("ellipse");
    const line = Array.from({ length: 20 }, (_, i): Pt => [i * 15, i * 6 + wob(i)]);
    expect(recognizeStroke(line)).toMatchObject({ kind: "line" });
  });
  it("leaves scribbles and dots alone", () => {
    expect(recognizeStroke([[0, 0], [2, 2], [1, 1], [3, 0], [0, 3]])).toBeNull();
    const zig: Pt[] = Array.from({ length: 30 }, (_, i) => [i * 8, (i % 2) * 70]);
    expect(recognizeStroke(zig)).toBeNull();
  });
});

describe("JSON Canvas", () => {
  const els = [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 200, height: 80, backgroundColor: "#d3f9d8", boundElements: [{ type: "text", id: "ta" }, { type: "arrow", id: "ar" }] },
    { id: "ta", type: "text", containerId: "a", text: "Wrapped\ntext", originalText: "Wrapped text" },
    { id: "b", type: "rectangle", x: 300, y: 0, width: 200, height: 80, backgroundColor: "#fff", boundElements: [{ type: "text", id: "tb" }] },
    { id: "tb", type: "text", containerId: "b", text: "B", originalText: "B" },
    { id: "ar", type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: "b" }, boundElements: [] },
    { id: "gone", type: "rectangle", isDeleted: true, x: 0, y: 0, width: 1, height: 1 },
  ];
  it("exports nodes with original text, colours and edges", () => {
    const c = exportJsonCanvas(els);
    expect(c.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(c.nodes[0]).toMatchObject({ type: "text", text: "Wrapped text", color: "4" });
    expect(c.edges).toEqual([{ id: "ar", fromNode: "a", toNode: "b" }]);
  });
  it("imports Obsidian-style canvases: text/link/file nodes, groups → frames, edges → bound arrows", () => {
    const sk = importJsonCanvas({
      nodes: [
        { id: "1", type: "text", text: "# Hello", x: 0, y: 0, width: 200, height: 80, color: "2" },
        { id: "2", type: "link", url: "https://example.com", x: 400, y: 0, width: 200, height: 80 },
        { id: "3", type: "file", file: "notes/idea.md", x: 0, y: 300, width: 200, height: 80 },
        { id: "g", type: "group", label: "Phase 1", x: -20, y: -20, width: 250, height: 120 },
        { id: "bad", type: "text" },
      ],
      edges: [{ id: "e", fromNode: "1", toNode: "2", label: "then" }, { id: "x", fromNode: "1", toNode: "missing" }],
    });
    expect(sk.filter((s) => s.type === "rectangle")).toHaveLength(3);
    const frame = sk.find((s) => s.type === "frame");
    expect(frame.name).toBe("Phase 1");
    expect(frame.children).toEqual(["jc-1"]);
    expect(sk.filter((s) => s.type === "arrow")).toHaveLength(1);
    expect(sk.find((s) => s.id === "jc-1").label.text).toBe("Hello");
    expect(sk.find((s) => s.id === "jc-3").label.text).toBe("idea.md");
  });
  it("round-trips", () => {
    const back = importJsonCanvas(exportJsonCanvas(els));
    expect(back.filter((s) => s.type === "rectangle")).toHaveLength(2);
    expect(back.filter((s) => s.type === "arrow")).toHaveLength(1);
  });
});
