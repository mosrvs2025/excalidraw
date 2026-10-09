/**
 * Shape recognition for freehand strokes ("rough → refined"). Pure geometry, no model:
 * straight strokes become lines, closed loops become rectangles / diamonds / ellipses.
 */
export type Pt = [number, number];
export type Recognized =
  | { kind: "line"; from: Pt; to: Pt }
  | { kind: "rectangle" | "ellipse" | "diamond"; x: number; y: number; w: number; h: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Douglas–Peucker on an open polyline. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let idx = -1;
  let max = 0;
  const len = dist(a, b) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / len;
    if (d > max) (max = d), (idx = i);
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

/** Closed loops: split at the point farthest from the start, simplify both halves. */
function simplifyClosed(poly: Pt[], eps: number): Pt[] {
  let far = 0;
  let max = 0;
  poly.forEach((p, i) => {
    const d = dist(p, poly[0]);
    if (d > max) (max = d), (far = i);
  });
  return [...simplify(poly.slice(0, far + 1), eps).slice(0, -1), ...simplify(poly.slice(far), eps)];
}

export function recognizeStroke(points: Pt[]): Recognized | null {
  if (points.length < 5) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  const diag = Math.hypot(w, h);
  if (diag < 24) return null; // a dot or a scribble too small to mean anything
  let path = 0;
  for (let i = 1; i < points.length; i++) path += dist(points[i - 1], points[i]);
  const first = points[0];
  const last = points[points.length - 1];
  const chord = dist(first, last);

  // straight line: the path barely deviates from the chord
  if (chord > 0.85 * path) {
    let dev = 0;
    for (const p of points) dev = Math.max(dev, Math.abs((last[0] - first[0]) * (first[1] - p[1]) - (first[0] - p[0]) * (last[1] - first[1])) / (chord || 1));
    if (dev < 0.09 * chord) return { kind: "line", from: first, to: last };
    return null;
  }

  // closed loop
  if (chord > 0.3 * diag) return null;
  const poly = [...points, first];
  let area = 0;
  let per = 0;
  for (let i = 1; i < poly.length; i++) {
    area += poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1];
    per += dist(poly[i - 1], poly[i]);
  }
  area = Math.abs(area) / 2;
  if (area < 0.3 * w * h) return null; // not enough "filled" bounding box: a stroke, not a shape
  const circ = (4 * Math.PI * area) / (per * per);
  const corners = simplifyClosed(poly, 0.09 * diag);
  const n = corners.length - 1;
  if (n === 4) {
    let axisAligned = 0;
    for (let i = 1; i < corners.length; i++) {
      const ang = Math.abs((Math.atan2(corners[i][1] - corners[i - 1][1], corners[i][0] - corners[i - 1][0]) * 180) / Math.PI) % 90;
      if (ang < 25 || ang > 65) axisAligned++;
    }
    return { kind: axisAligned >= 3 ? "rectangle" : "diamond", x, y, w, h };
  }
  if (n >= 5 && circ > 0.74) return { kind: "ellipse", x, y, w, h };
  return null;
}
