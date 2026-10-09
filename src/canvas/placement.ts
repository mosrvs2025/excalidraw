export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
}

/**
 * Where to put a new w×h block "around" (cx, cy)? The centre if it's free; otherwise just to the right of
 * (or, failing that, below) the cluster of existing objects it would collide with.
 */
export function findFreeSpot(els: readonly Box[], w: number, h: number, cx: number, cy: number) {
  const PAD = 36;
  const live = els.filter((e) => !e.isDeleted && !(e as any).containerId);
  const hit = (x: number, y: number, bx = w, by = h) =>
    live.filter((e) => x < e.x + e.width + PAD && x + bx > e.x - PAD && y < e.y + e.height + PAD && y + by > e.y - PAD);
  let x = cx - w / 2;
  let y = cy - h / 2;
  let hits = hit(x, y);
  if (!hits.length) return { x, y };
  // grow the colliding cluster until it is closed under overlap
  let group = new Set(hits);
  for (let i = 0; i < 8; i++) {
    const [x1, y1, x2, y2] = bounds(group);
    const more = live.filter((e) => !group.has(e) && x1 - PAD < e.x + e.width && x2 + PAD > e.x && y1 - PAD < e.y + e.height && y2 + PAD > e.y);
    if (!more.length) break;
    more.forEach((m) => group.add(m));
  }
  const [x1, y1, x2, y2] = bounds(group);
  const candidates = [
    { x: x2 + 110, y: y1 }, // right, top-aligned
    { x: x1, y: y2 + 110 }, // below
    { x: x1 - w - 110, y: y1 }, // left
  ];
  for (const c of candidates) if (!hit(c.x, c.y).length) return c;
  return { x: x2 + 110, y: y2 + 110 };
}
function bounds(group: Set<Box>) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of group) {
    x1 = Math.min(x1, e.x);
    y1 = Math.min(y1, e.y);
    x2 = Math.max(x2, e.x + e.width);
    y2 = Math.max(y2, e.y + e.height);
  }
  return [x1, y1, x2, y2] as const;
}

