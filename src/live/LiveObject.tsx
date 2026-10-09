import { useEffect, useMemo, useRef } from "react";
import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { getMeta } from "../canvas/context";
import { composeApp, renderMarkdown } from "./runtime";

/** iframe window → element id, so state saves from the sandbox can be routed to the right object. */
export const frameRegistry = new Map<Window, string>();

export function LiveObject({ element, theme }: { element: ExcalidrawEmbeddableElement; theme: "light" | "dark" }) {
  const meta = getMeta(element);
  if (!meta) return null;
  return (
    <div className={`lo lo-kind-${meta.kind}`}>
      <div className="lo-bar">
        <span className="lo-dot" />
        <span className="lo-title">{meta.title || (meta.kind === "app" ? "Live object" : "Document")}</span>
        <span className="lo-tag">{meta.kind === "app" ? "live" : "doc"}</span>
      </div>
      <div className="lo-body">
        {meta.kind === "app" ? (
          <AppFrame id={element.id} html={meta.html ?? ""} state={(meta as any).state} theme={theme} />
        ) : (
          <div className="lo-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(meta.markdown ?? "") }} />
        )}
      </div>
    </div>
  );
}

export function AppFrame({
  id,
  html,
  state,
  theme,
  title = "Live object",
}: {
  id: string;
  html: string;
  state?: unknown;
  theme: "light" | "dark";
  title?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // srcDoc only changes when the code or theme changes — never when state is saved — so typing in an app never reloads it
  const srcDoc = useMemo(() => composeApp(html, stateRef.current, theme), [html, theme]);

  useEffect(() => {
    const w = ref.current?.contentWindow;
    if (w) frameRegistry.set(w, id);
    return () => {
      if (w) frameRegistry.delete(w);
    };
  }, [id, srcDoc]);

  return (
    <iframe
      ref={(n) => {
        (ref as any).current = n;
        if (n?.contentWindow) frameRegistry.set(n.contentWindow, id);
      }}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      loading="eager"
    />
  );
}
