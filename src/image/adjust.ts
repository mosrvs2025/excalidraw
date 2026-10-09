/** Pixel-level image adjustments. Pure functions over RGBA byte arrays (so they run anywhere and are unit-testable). */
export interface Adjust {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  grayscale: number; // 0..100
  sepia: number; // 0..100
  invert: boolean;
  blur: number; // 0..20 px
  /** remove the corner-sampled background colour; null = off, else tolerance 1..100 */
  bgTolerance: number | null;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
}

export const NEUTRAL: Adjust = { brightness: 0, contrast: 0, saturation: 0, grayscale: 0, sepia: 0, invert: false, blur: 0, bgTolerance: null, rotate: 0, flipH: false, flipV: false };

export const PRESETS: Record<string, Partial<Adjust>> = {
  "B&W": { grayscale: 100, contrast: 15 },
  Sepia: { sepia: 85, contrast: 5 },
  Vivid: { saturation: 40, contrast: 15 },
  Fade: { contrast: -20, brightness: 12, saturation: -25 },
  Invert: { invert: true },
};

export const isNeutral = (a: Adjust) => JSON.stringify(a) === JSON.stringify(NEUTRAL);
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function adjustPixels(d: Uint8ClampedArray, w: number, h: number, p: Adjust): void {
  if (p.bgTolerance !== null) removeBackground(d, w, h, p.bgTolerance);
  const b = p.brightness * 2.55;
  const c = p.contrast;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const sat = 1 + p.saturation / 100;
  const gs = p.grayscale / 100;
  const sp = p.sepia / 100;
  const colour = b !== 0 || c !== 0 || p.saturation !== 0 || gs > 0 || sp > 0 || p.invert;
  if (colour)
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let bl = d[i + 2];
      r += b; g += b; bl += b;
      if (c !== 0) (r = cf * (r - 128) + 128), (g = cf * (g - 128) + 128), (bl = cf * (bl - 128) + 128);
      if (p.saturation !== 0) {
        const y = 0.299 * r + 0.587 * g + 0.114 * bl;
        r = y + (r - y) * sat; g = y + (g - y) * sat; bl = y + (bl - y) * sat;
      }
      if (gs > 0) {
        const y = 0.299 * r + 0.587 * g + 0.114 * bl;
        r += (y - r) * gs; g += (y - g) * gs; bl += (y - bl) * gs;
      }
      if (sp > 0) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * bl;
        const sg = 0.349 * r + 0.686 * g + 0.168 * bl;
        const sb = 0.272 * r + 0.534 * g + 0.131 * bl;
        r += (sr - r) * sp; g += (sg - g) * sp; bl += (sb - bl) * sp;
      }
      if (p.invert) (r = 255 - r), (g = 255 - g), (bl = 255 - bl);
      d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(bl);
    }
  if (p.blur > 0) boxBlur(d, w, h, Math.round(p.blur));
}

/**
 * Remove a plain backdrop: flood-fill inward from the image edges, clearing every connected pixel close to the
 * border's dominant colour. Colours *inside* the subject that happen to match (a white logo on a white shirt) are
 * kept because they aren't connected to the edge. Edges are feathered. Returns the fraction of pixels cleared.
 */
export function removeBackground(d: Uint8ClampedArray, w: number, h: number, tolerance: number): number {
  const idx = (x: number, y: number) => y * w + x;
  // dominant border colour: mean of the border pixels nearest the most common coarse bucket
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const addBorder = (x: number, y: number) => {
    const i = idx(x, y) * 4;
    const key = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
    buckets.set(key, e);
  };
  for (let x = 0; x < w; x++) (addBorder(x, 0), addBorder(x, h - 1));
  for (let y = 1; y < h - 1; y++) (addBorder(0, y), addBorder(w - 1, y));
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  const bg = [top.r / top.n, top.g / top.n, top.b / top.n];
  const tol = tolerance * 4.4; // 0..100 → 0..~440 (max RGB distance is 441)
  const dist = (p: number) => Math.hypot(d[p * 4] - bg[0], d[p * 4 + 1] - bg[1], d[p * 4 + 2] - bg[2]);
  const mask = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    const p = idx(x, y);
    if (!mask[p] && dist(p) <= tol) (mask[p] = 1), stack.push(p);
  };
  for (let x = 0; x < w; x++) (seed(x, 0), seed(x, h - 1));
  for (let y = 0; y < h; y++) (seed(0, y), seed(w - 1, y));
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  let cleared = 0;
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) (d[p * 4 + 3] = 0), cleared++;
  }
  // feather: pixels touching the cleared region fade by how close they are to the backdrop colour
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) continue;
    const x = p % w;
    const y = (p / w) | 0;
    const near = (x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) || (y > 0 && mask[p - w]) || (y < h - 1 && mask[p + w]);
    if (!near) continue;
    const dd = dist(p);
    if (dd < tol * 1.6) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * Math.min(1, Math.max(0, (dd - tol) / (tol * 0.6 || 1))));
  }
  return cleared / (w * h);
}

function boxBlur(d: Uint8ClampedArray, w: number, h: number, r: number): void {
  const tmp = new Uint8ClampedArray(d.length);
  const pass = (src: Uint8ClampedArray, dst: Uint8ClampedArray, horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++)
      for (let ch = 0; ch < 4; ch++) {
        const at = (i: number) => (horizontal ? (l * w + i) * 4 : (i * w + l) * 4) + ch;
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += src[at(Math.min(Math.max(i, 0), len - 1))];
        for (let i = 0; i < len; i++) {
          dst[at(i)] = sum / (2 * r + 1);
          sum += src[at(Math.min(i + r + 1, len - 1))] - src[at(Math.max(i - r, 0))];
        }
      }
  };
  pass(d, tmp, true);
  pass(tmp, d, false);
}

/** Output size after rotation. */
export const rotatedSize = (w: number, h: number, rotate: number) => (rotate % 180 === 0 ? [w, h] : [h, w]) as [number, number];
