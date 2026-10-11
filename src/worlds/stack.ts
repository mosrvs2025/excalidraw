/**
 * Dropping pictures onto each other: find what you're hovering, and fan the lot into a tidy pile.
 * Pure maths (no Excalidraw runtime) so the feel can be tuned and tested.
 */
export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
}

const area = (b: { width: number; height: number }) => Math.max(0, b.width) * Math.max(0, b.height);

export function boundsOf(bs: Box[]): { x: number; y: number; width: number; height: number } {
  const x1 = Math.min(...bs.map((b) => b.x));
  const y1 = Math.min(...bs.map((b) => b.y));
  const x2 = Math.max(...bs.map((b) => b.x + b.width));
  const y2 = Math.max(...bs.map((b) => b.y + b.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Share of the *smaller* box covered by the overlap (0..1) — so a small picture dropped fully on a big one counts as 1. */
export function overlapShare(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(area(a), area(b)));
}

/** The box (not in `moving`) that the dragged group is mostly sitting on, or null. */
export function dropTarget(moving: Box[], others: Box[], min = 0.4): Box | null {
  if (!moving.length) return null;
  const g = { id: "", ...boundsOf(moving) };
  let best: Box | null = null;
  let bestShare = min;
  for (const o of others) {
    if (moving.some((m) => m.id === o.id)) continue;
    const s = overlapShare(g, o);
    if (s >= bestShare) (best = o), (bestShare = s);
  }
  return best;
}

/** A loose, friendly pile: everything centred on `at`, each card nudged and tilted a little further than the last. */
export function pileLayout(items: Box[], at: { x: number; y: number }): { id: string; x: number; y: number; angle: number }[] {
  const n = items.length;
  return items.map((b, i) => {
    const k = i - (n - 1) / 2;
    const tilt = ((i % 2 ? 1 : -1) * (3 + ((i * 7) % 5))) * (Math.PI / 180);
    return { id: b.id, x: at.x - b.width / 2 + k * 14, y: at.y - b.height / 2 + k * 10, angle: n === 1 ? 0 : tilt };
  });
}

export const easeOutBack = (t: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Rows of pictures, left to right, wrapping at a comfortable width — for laying a stack out inside its world. */
export function gridLayout(items: Box[], gap = 40, maxRow = 1400): { id: string; x: number; y: number }[] {
  const out: { id: string; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const b of items) {
    if (x > 0 && x + b.width > maxRow) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    out.push({ id: b.id, x, y });
    x += b.width + gap;
    rowH = Math.max(rowH, b.height);
  }
  return out;
}
