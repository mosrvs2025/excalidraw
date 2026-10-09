/**
 * Zoom-portal maths. A "world" is a board you reach by zooming into a portal on its parent; zooming far enough
 * out of it returns you. These helpers decide *when* — kept pure so the feel can be tuned and unit-tested.
 */
export interface View {
  zoom: number;
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen-space rect of a scene rect. (Excalidraw: screen = (scene + scroll) * zoom.) */
export const toScreen = (r: Rect, v: View): Rect => ({
  x: (r.x + v.scrollX) * v.zoom,
  y: (r.y + v.scrollY) * v.zoom,
  width: r.width * v.zoom,
  height: r.height * v.zoom,
});

/** How much of the viewport the rect fills, 0..∞ (1 = fills the limiting dimension exactly). */
export function coverage(r: Rect, v: View): number {
  return Math.max((r.width * v.zoom) / v.width, (r.height * v.zoom) / v.height);
}

/** Is the portal where you're looking? (A little slack: you zoom around your pointer, not exactly the centre.) */
export const containsViewportCenter = (r: Rect, v: View) => {
  const s = toScreen(r, v);
  const slack = 0.12 * Math.min(v.width, v.height);
  const cx = v.width / 2;
  const cy = v.height / 2;
  return cx >= s.x - slack && cx <= s.x + s.width + slack && cy >= s.y - slack && cy <= s.y + s.height + slack;
};

/** Tuned by feel: dive once a portal almost fills the screen while you're still zooming in on it. */
export const DIVE_AT = 0.9;
/** Show "keep zooming" encouragement from here. */
export const HINT_FROM = 0.35;

export function shouldDive(r: Rect, v: View, prevZoom: number): boolean {
  return v.zoom > prevZoom * 1.0005 && coverage(r, v) >= DIVE_AT && containsViewportCenter(r, v);
}

/** Zoom at which everything in `bounds` just fits (with margin). */
export function fitZoom(bounds: Rect, v: Pick<View, "width" | "height">, margin = 0.85): number {
  return Math.min((v.width * margin) / Math.max(bounds.width, 1), (v.height * margin) / Math.max(bounds.height, 1));
}

/**
 * Leaving a world: you've zoomed out well past what's needed to see all of it.
 * `ref` = the zoom that frames the world's content (or the zoom you entered at).
 */
export const EXIT_RATIO = 0.5;
export const shouldExit = (zoom: number, prevZoom: number, ref: number) => zoom < prevZoom * 0.9995 && zoom < ref * EXIT_RATIO;
/** 0..1: how close you are to leaving (for the "keep zooming out" cue). */
export const exitProgress = (zoom: number, ref: number) => Math.min(1, Math.max(0, (ref * 0.85 - zoom) / (ref * 0.85 - ref * EXIT_RATIO)));
