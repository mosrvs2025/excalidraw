import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

/**
 * Exports (previews, thumbnails) can't render iframes — Excalidraw would print the raw link. Swap every embeddable
 * for a tidy card with its title: a deep-purple doorway for worlds, a soft grey card for live objects and documents.
 */
export function withStandIns<T extends { type: string }>(els: readonly T[]): any[] {
  const out: any[] = [];
  for (const e of els as any[]) {
    if (e.type !== "embeddable") {
      out.push(e);
      continue;
    }
    const m = e.customData?.lumen;
    const portal = m?.kind === "portal";
    out.push({
      ...e,
      type: "rectangle",
      backgroundColor: portal ? "#2a2557" : "#f1f3f5",
      strokeColor: portal ? "#7048e8" : "#adb5bd",
      fillStyle: "solid",
      strokeWidth: 2,
      roundness: { type: 3 },
      link: null,
      customData: undefined,
    });
    const title = m?.title || (m?.kind === "doc" ? "Document" : portal ? "World" : "Live object");
    const fs = Math.min(44, Math.max(16, e.height / 8));
    out.push(
      ...convertToExcalidrawElements([{ type: "text", id: `${e.id}-standin`, x: e.x + e.width * 0.08, y: e.y + e.height / 2 - fs * 0.6, text: `${portal ? "✦ " : ""}${title}`, fontSize: fs, fontFamily: 6, strokeColor: portal ? "#ffffff" : "#495057" } as any]),
    );
  }
  return out;
}
