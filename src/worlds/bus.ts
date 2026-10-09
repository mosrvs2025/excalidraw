import { useEffect, useState } from "react";
import { getMeta, getPreview } from "../store/projects";

/**
 * Glue between portal objects (rendered deep inside Excalidraw) and the app shell.
 * The workspace installs `enter`; portals call it. Previews are cached and refreshed when a world saves.
 */
export const worldBus: { enter: (childId: string, portalElementId: string) => void; flush: () => Promise<void> } = { enter: () => {}, flush: async () => {} };

/** Re-read a world's name/preview (after a rename or save). */
export const touchWorld = (id: string) => window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: id }));

const cache = new Map<string, string | null>();
export const PREVIEW_EVENT = "lumen:preview";

export function notifyPreview(id: string, dataURL: string | null) {
  cache.set(id, dataURL);
  window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: id }));
}

export type WorldState = { status: "loading" } | { status: "missing" } | { status: "ready"; name: string; preview: string | null };

export function useWorld(childId: string | undefined): WorldState {
  const [state, setState] = useState<WorldState>({ status: "loading" });
  useEffect(() => {
    if (!childId) return setState({ status: "missing" });
    let alive = true;
    const load = async () => {
      const meta = await getMeta(childId);
      if (!alive) return;
      if (!meta) return setState({ status: "missing" });
      const preview = cache.has(childId) ? cache.get(childId)! : ((await getPreview(childId)) ?? null);
      if (alive) setState({ status: "ready", name: meta.name, preview });
    };
    load();
    const on = (e: Event) => (e as CustomEvent).detail === childId && load();
    window.addEventListener(PREVIEW_EVENT, on);
    return () => {
      alive = false;
      window.removeEventListener(PREVIEW_EVENT, on);
    };
  }, [childId]);
  return state;
}
