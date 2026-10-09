import { describe, expect, it } from "vitest";
import { coverage, containsViewportCenter, exitProgress, fitZoom, shouldDive, shouldExit, toScreen } from "./geometry";
import { ancestorsOf, descendantsOf, type ProjectMeta } from "../store/projects";

const v = (zoom: number, sx = 0, sy = 0) => ({ zoom, scrollX: sx, scrollY: sy, width: 1000, height: 600 });
const portal = { x: 0, y: 0, width: 400, height: 300 };

describe("portal zoom maths", () => {
  it("coverage grows with zoom and uses the limiting dimension", () => {
    expect(coverage(portal, v(1))).toBeCloseTo(0.5); // 300/600
    expect(coverage(portal, v(2))).toBeCloseTo(1);
    expect(toScreen(portal, v(2, 10, 5))).toEqual({ x: 20, y: 10, width: 800, height: 600 });
  });
  it("dives only when zooming IN, nearly filling the view, with the portal under the centre", () => {
    const view = v(1.9, -60, -10); // centred-ish, coverage 0.95
    expect(containsViewportCenter(portal, view)).toBe(true);
    expect(shouldDive(portal, view, 1.7)).toBe(true);
    expect(shouldDive(portal, view, 2.0)).toBe(false); // zooming out of it
    expect(shouldDive(portal, v(1.2), 1.0)).toBe(false); // not big enough yet
    expect(shouldDive(portal, v(1.9, -900, -900), 1.7)).toBe(false); // portal isn't where we're looking
  });
  it("exits only after zooming OUT well beyond the framing zoom", () => {
    expect(shouldExit(0.9, 1.0, 1.0)).toBe(false);
    expect(shouldExit(0.45, 0.5, 1.0)).toBe(true);
    expect(shouldExit(0.45, 0.4, 1.0)).toBe(false); // zooming in again
    expect(exitProgress(1.0, 1.0)).toBe(0);
    expect(exitProgress(0.5, 1.0)).toBe(1);
    expect(exitProgress(0.7, 1.0)).toBeGreaterThan(0);
    expect(exitProgress(0.7, 1.0)).toBeLessThan(1);
  });
  it("fit zoom frames content with margin", () => {
    expect(fitZoom({ x: 0, y: 0, width: 500, height: 100 }, { width: 1000, height: 600 })).toBeCloseTo(1.7);
  });
});

const P = (id: string, parentId?: string): ProjectMeta => ({ id, name: id, createdAt: 0, updatedAt: 0, count: 0, parentId });
describe("world tree", () => {
  const all = [P("home"), P("planet", "home"), P("city", "planet"), P("street", "city"), P("other")];
  it("trail from root to parent", () => {
    expect(ancestorsOf(all, "street").map((p) => p.id)).toEqual(["home", "planet", "city"]);
    expect(ancestorsOf(all, "home")).toEqual([]);
  });
  it("descendants, and cycle safety", () => {
    expect(descendantsOf(all, "home").sort()).toEqual(["city", "planet", "street"]);
    const loop = [P("a", "b"), P("b", "a")];
    expect(ancestorsOf(loop, "a").map((p) => p.id)).toEqual(["b"]);
    expect(descendantsOf(loop, "a")).toEqual(["b"]);
  });
});
