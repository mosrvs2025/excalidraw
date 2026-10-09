import { useMemo } from "react";
import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { getMeta } from "../canvas/context";
import { HINT_FROM, DIVE_AT } from "./geometry";
import { useWorld, worldBus } from "./bus";

/** A doorway into another board: a living preview, a soft glow that grows as you approach, and a click to enter. */
export function PortalView({ element, zoom, viewW, viewH }: { element: ExcalidrawEmbeddableElement; zoom: number; viewW: number; viewH: number }) {
  const meta = getMeta(element)!;
  const childId = (meta as any).childId as string | undefined;
  const world = useWorld(childId);
  // 0 = far away, 1 = about to dive
  const near = Math.min(1, Math.max(0, (Math.max((element.width * zoom) / viewW, (element.height * zoom) / viewH) - HINT_FROM) / (DIVE_AT - HINT_FROM)));
  const stars = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ x: (Math.sin(i * 91.7) * 0.5 + 0.5) * 100, y: (Math.cos(i * 57.3) * 0.5 + 0.5) * 100, s: 1 + ((i * 7) % 3), d: (i % 6) * 0.5 })), []);
  const title = meta.title || (world.status === "ready" ? world.name : "World");
  return (
    <div
      className={`portal ${world.status}`}
      style={{ ["--near" as any]: near }}
      data-testid="portal"
      onClick={() => childId && world.status === "ready" && worldBus.enter(childId, element.id)}
      role="group"
      aria-label={`World: ${title}`}
    >
      <div className="portal-bg">
        {world.status === "ready" && world.preview ? (
          <img src={world.preview} alt="" draggable={false} />
        ) : (
          <div className="portal-sky">
            {stars.map((s, i) => (
              <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
            ))}
          </div>
        )}
      </div>
      <div className="portal-ring" />
      <div className="portal-label">
        <span className="glyph">✦</span>
        <b>{title}</b>
        {world.status === "missing" && <small>not on this device</small>}
      </div>
      <div className="portal-hint" style={{ opacity: world.status === "ready" ? Math.min(1, near * 2) : 0 }}>
        {near > 0.55 ? "Keep zooming…" : "Zoom in to step inside"}
      </div>
    </div>
  );
}
