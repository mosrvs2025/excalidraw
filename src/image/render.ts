import { adjustPixels, rotatedSize, type Adjust } from "./adjust";

/** Draw `img` with rotation/flip/adjustments into a new canvas no larger than `maxSide`. */
export function renderAdjusted(img: CanvasImageSource & { width: number; height: number }, p: Adjust, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const [cw, ch] = rotatedSize(w, h, p.rotate);
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((p.rotate * Math.PI) / 180);
  ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const data = ctx.getImageData(0, 0, cw, ch);
  adjustPixels(data.data, cw, ch, p);
  ctx.putImageData(data, 0, 0);
  return c;
}

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Couldn't load the image"));
    i.src = src;
  });

export interface FinalImage {
  dataURL: string;
  mime: string;
  w: number;
  h: number;
  /** when the result was cropped to its content: the kept box as fractions of the uncropped canvas */
  trim?: { x0: number; y0: number; x1: number; y1: number; preW: number; preH: number };
  /** fraction of pixels made transparent by background removal */
  removed: number;
}

/** Full-quality render. With background removal the result is cropped tight to the subject. */
export function renderFinal(img: HTMLImageElement, p: Adjust, srcMime: string, maxSide = 2400): FinalImage {
  let c = renderAdjusted(img, p, maxSide);
  const cutting = p.bgTolerance !== null;
  let trim: FinalImage["trim"];
  let removed = 0;
  if (cutting) {
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1, clear = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const a = data[(y * c.width + x) * 4 + 3];
        if (a < 12) clear++;
        else (x < x0 && (x0 = x), x > x1 && (x1 = x), y < y0 && (y0 = y), y > y1 && (y1 = y));
      }
    removed = clear / (c.width * c.height);
    if (x1 >= x0 && y1 >= y0) {
      const pad = 2;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
      const cw = x1 - x0 + 1;
      const ch = y1 - y0 + 1;
      if (cw < c.width || ch < c.height) {
        const out = document.createElement("canvas");
        out.width = cw;
        out.height = ch;
        out.getContext("2d")!.drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
        trim = { x0: x0 / c.width, y0: y0 / c.height, x1: (x1 + 1) / c.width, y1: (y1 + 1) / c.height, preW: c.width, preH: c.height };
        c = out;
      }
    }
  }
  const mime = cutting || srcMime === "image/png" ? "image/png" : "image/jpeg";
  return { dataURL: c.toDataURL(mime, 0.92), mime, w: c.width, h: c.height, trim, removed };
}
