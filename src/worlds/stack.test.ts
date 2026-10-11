import { describe, expect, it } from "vitest";
import { dropTarget, overlapShare, pileLayout } from "./stack";

const box = (id: string, x: number, y: number, w = 100, h = 100) => ({ id, x, y, width: w, height: h });

describe("stacking pictures", () => {
  it("measures overlap against the smaller picture", () => {
    expect(overlapShare(box("a", 0, 0), box("b", 200, 0))).toBe(0);
    expect(overlapShare(box("a", 0, 0, 40, 40), box("b", 0, 0, 400, 400))).toBe(1);
    expect(overlapShare(box("a", 0, 0), box("b", 50, 0))).toBeCloseTo(0.5);
  });
  it("picks the picture you're mostly on, ignoring the ones being dragged", () => {
    const moving = [box("m", 10, 10)];
    const t = dropTarget(moving, [box("m", 10, 10), box("far", 500, 500), box("near", 40, 40), box("barely", 95, 95)]);
    expect(t?.id).toBe("near");
    expect(dropTarget(moving, [box("barely", 95, 95)])).toBeNull();
  });
  it("fans a pile around the centre with alternating tilt", () => {
    const p = pileLayout([box("a", 0, 0), box("b", 300, 0), box("c", 0, 300)], { x: 0, y: 0 });
    expect(p.map((q) => q.id)).toEqual(["a", "b", "c"]);
    expect(Math.sign(p[0].angle)).not.toBe(Math.sign(p[1].angle));
    expect(pileLayout([box("a", 9, 9)], { x: 0, y: 0 })[0].angle).toBe(0);
  });
});
