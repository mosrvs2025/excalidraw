/** Dominant colours via deterministic k-means (farthest-point seeding). */
export function dominantColors(d: Uint8ClampedArray, k = 5): string[] {
  const pts: number[][] = [];
  const step = Math.max(1, Math.floor(d.length / 4 / 6000));
  for (let i = 0; i < d.length; i += 4 * step) if (d[i + 3] > 128) pts.push([d[i], d[i + 1], d[i + 2]]);
  if (!pts.length) return [];
  const dist = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers = [pts[0]];
  while (centers.length < Math.min(k, pts.length)) {
    let far = pts[0];
    let best = -1;
    for (const p of pts) {
      const m = Math.min(...centers.map((c) => dist(p, c)));
      if (m > best) (best = m), (far = p);
    }
    if (best < 400) break; // nothing left that's visibly different
    centers.push(far);
  }
  let counts: number[] = [];
  for (let it = 0; it < 10; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, i) => {
        const dd = dist(p, c);
        if (dd < bd) (bd = dd), (bi = i);
      });
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; sums[bi][3]++;
    }
    counts = sums.map((s) => s[3]);
    sums.forEach((s, i) => s[3] && (centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
  }
  return centers
    .map((c, i) => ({ c, n: counts[i] }))
    .sort((a, b) => b.n - a.n)
    .map(({ c }) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""));
}

/** Readable text colour for a swatch. */
export const inkFor = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1e1e1e" : "#ffffff";
};
