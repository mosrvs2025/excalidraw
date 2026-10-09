import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Suggestion } from "../ai/intents";

export interface DockProps {
  /** viewport rect of the selection (null = canvas-level dock) */
  rect: { x: number; y: number; w: number; h: number } | null;
  suggestions: Suggestion[];
  /** extra context-specific actions (live objects etc.) */
  actions: { id: string; label: string; icon: string; run: () => void }[];
  placeholder: string;
  busy: string | null;
  engine: "claude" | "offline";
  onRun: (prompt: string, intent?: Suggestion["id"]) => void;
  onEngineClick: () => void;
  onCancel: () => void;
  mobile: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
}

export function Dock(p: DockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [text, setText] = useState("");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || p.mobile) return setPos(null);
    const dw = el.offsetWidth;
    const dh = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!p.rect) return setPos({ left: Math.max(8, (vw - dw) / 2), top: vh - dh - 28 });
    // a selection that fills the screen has no "next to it" — dock at the bottom instead
    if (p.rect.h > vh * 0.62) return setPos({ left: Math.min(Math.max(8, p.rect.x + p.rect.w / 2 - dw / 2), vw - dw - 8), top: vh - dh - 28 });
    let top = p.rect.y + p.rect.h + 16;
    if (top + dh > vh - 16) top = Math.max(72, p.rect.y - dh - 16);
    if (top + dh > vh - 16) top = vh - dh - 20; // selection fills the screen
    const left = Math.min(Math.max(8, p.rect.x + p.rect.w / 2 - dw / 2), vw - dw - 8);
    setPos({ left, top });
  }, [p.rect?.x, p.rect?.y, p.rect?.w, p.rect?.h, p.mobile, p.suggestions.length, p.actions.length, p.busy]);

  useEffect(() => {
    if (!p.busy) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.busy]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || p.busy) return;
    p.onRun(v);
    setText("");
  };

  return (
    <div
      ref={ref}
      className={`dock ${p.busy ? "busy" : ""} ${p.mobile ? "mobile" : ""}`}
      style={p.mobile ? undefined : pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
      data-testid="dock"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {p.busy ? (
        <div className="dock-busy" role="status">
          <span className="spinner" />
          <span>{p.busy}</span>
          <button className="chip ghost" onClick={p.onCancel}>
            Esc
          </button>
        </div>
      ) : (
        <>
          {(p.suggestions.length > 0 || p.actions.length > 0) && (
            <div className="chips" role="toolbar" aria-label="Suggested actions">
              {p.actions.map((a) => (
                <button key={a.id} className="chip" onClick={a.run} data-testid={`action-${a.id}`}>
                  <i>{a.icon}</i>
                  {a.label}
                </button>
              ))}
              {p.suggestions.map((s) => (
                <button
                  key={s.id + s.label}
                  className={`chip ${s.primary ? "primary" : ""}`}
                  onClick={() => p.onRun(s.prompt, s.id)}
                  data-testid={`intent-${s.id}`}
                  title={s.prompt}
                >
                  <i>{s.icon}</i>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <form className="ask" onSubmit={submit}>
            <input
              ref={p.inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={p.placeholder}
              aria-label="Tell the canvas what to do"
              data-testid="intent-input"
              enterKeyHint="go"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
            />
            <button type="button" className={`engine ${p.engine}`} onClick={p.onEngineClick} title={p.engine === "claude" ? "Powered by Claude" : "Offline engine — click to connect Claude"}>
              {p.engine === "claude" ? "✦ Claude" : "○ Offline"}
            </button>
            <button className="send" disabled={!text.trim()} aria-label="Run">
              ↵
            </button>
          </form>
        </>
      )}
    </div>
  );
}
