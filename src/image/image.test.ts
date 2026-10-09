import { describe, expect, it } from "vitest";
import { adjustPixels, NEUTRAL, PRESETS, rotatedSize } from "./adjust";
import { dominantColors, inkFor } from "./palette";

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

describe("image adjustments", () => {
  it("neutral params leave pixels untouched", () => {
    const d = px(10, 20, 30, 255, 200, 100, 50, 255);
    adjustPixels(d, 2, 1, NEUTRAL);
    expect([...d]).toEqual([10, 20, 30, 255, 200, 100, 50, 255]);
  });
  it("brightness, grayscale, invert, sepia behave", () => {
    let d = px(100, 100, 100, 255);
    adjustPixels(d, 1, 1, { ...NEUTRAL, brightness: 20 });
    expect(d[0]).toBeCloseTo(151, -1);
    d = px(255, 0, 0, 255);
    adjustPixels(d, 1, 1, { ...NEUTRAL, ...PRESETS["B&W"], contrast: 0 });
    expect(Math.abs(d[0] - d[1])).toBeLessThan(2); // no colour left
    d = px(10, 200, 30, 255);
    adjustPixels(d, 1, 1, { ...NEUTRAL, invert: true });
    expect([...d]).toEqual([245, 55, 225, 255]);
    d = px(120, 120, 120, 255);
    adjustPixels(d, 1, 1, { ...NEUTRAL, sepia: 100 });
    expect(d[0]).toBeGreaterThan(d[2]); // warm tone
  });
  it("removes a solid background but keeps the subject", () => {
    // 3x3: white background, red centre
    const d = new Uint8ClampedArray(3 * 3 * 4).fill(255);
    d.set([255, 0, 0, 255], 4 * 4);
    adjustPixels(d, 3, 3, { ...NEUTRAL, bgTolerance: 20 });
    expect(d[3]).toBe(0); // corner → transparent
    expect(d[4 * 4 + 3]).toBe(255); // subject stays opaque
  });
  it("only clears backdrop connected to the edge: enclosed same-colour details survive", () => {
    // 5x5 white backdrop, a dark ring with a white pixel in its middle
    const d = new Uint8ClampedArray(5 * 5 * 4).fill(255);
    const dark = [1, 2, 3, 6, 8, 11, 12, 13].map((i) => [i % 5, Math.floor(i / 5)]);
    const ring = [[1, 1], [2, 1], [3, 1], [1, 2], [3, 2], [1, 3], [2, 3], [3, 3]];
    void dark;
    for (const [x, y] of ring) d.set([30, 30, 30, 255], (y * 5 + x) * 4);
    adjustPixels(d, 5, 5, { ...NEUTRAL, bgTolerance: 15 });
    expect(d[3]).toBe(0); // outer backdrop gone
    expect(d[(2 * 5 + 2) * 4 + 3]).toBe(255); // the enclosed white pixel stays
    expect(d[(1 * 5 + 1) * 4 + 3]).toBe(255); // ring intact
  });
  it("blur averages neighbours", () => {
    const d = new Uint8ClampedArray(5 * 1 * 4);
    for (let i = 0; i < 5; i++) d.set([i === 2 ? 255 : 0, 0, 0, 255], i * 4);
    adjustPixels(d, 5, 1, { ...NEUTRAL, blur: 1 });
    expect(d[2 * 4]).toBeLessThan(255);
    expect(d[1 * 4]).toBeGreaterThan(0);
  });
  it("rotation swaps dimensions", () => {
    expect(rotatedSize(400, 300, 90)).toEqual([300, 400]);
    expect(rotatedSize(400, 300, 180)).toEqual([400, 300]);
  });
});

describe("palette", () => {
  it("finds the dominant colours, biggest first", () => {
    const d = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) d.set(i < 70 ? [255, 0, 0, 255] : i < 90 ? [0, 0, 255, 255] : [0, 255, 0, 255], i * 4);
    expect(dominantColors(d, 3)).toEqual(["#ff0000", "#0000ff", "#00ff00"]);
    expect(dominantColors(new Uint8ClampedArray(8), 3)).toEqual([]); // fully transparent
    expect(dominantColors(new Uint8ClampedArray(40).fill(255), 5)).toHaveLength(1); // one flat colour = one swatch
  });
  it("picks readable ink", () => {
    expect(inkFor("#ffffff")).toBe("#1e1e1e");
    expect(inkFor("#101030")).toBe("#ffffff");
  });
});
