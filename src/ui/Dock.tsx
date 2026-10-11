import { flushSync } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Suggestion } from "../ai/intents";
import { filterSlash, parseSlash, resolveSlash, type SlashCommand } from "./slash";
import { ALT, MOD } from "./shortcuts";

export interface DockProps {
  /** viewport rect of the selection (null = canvas-level dock) */
  rect: { x: number; y: number; w: number; h: number } | null;
  suggestions: Suggestion[];
  /** extra context-specific actions (live objects etc.) */
  actions: { id: string; label: string; icon: string; run: () => void }[];
  placeholder: string;
  busy: string | null;
  engine: "claude" | "offline";
  engineLabel: string;
  onRun: (prompt: string, intent?: Suggestion["id"]) => void;
  slash: SlashCommand[];
  /** add the typed text to the canvas as a note (no interpretation) */
  onNote: (text: string) => void;
  onEngineClick: () => void;
  onCancel: () => void;
  mobile: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}

export function Dock(p: DockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [sel, setSel] = useState(0);
  const [focused, setFocused] = useState(false);
  const sq = parseSlash(text);
  const slashMatches = sq ? filterSlash(p.slash, sq.token) : [];
  // the menu is for choosing a command; once you've typed a space you're giving it its text
  const slashOpen = !!sq && slashMatches.length > 0 && !/\s/.test(text);
  const chipCount = p.actions.length + p.suggestions.length;
  const recRef = useRef<any>(null);
  const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

  /** Dictation: speak, see the words appear, and the canvas acts when you stop talking. */
  const toggleVoice = () => {
    if (!SR || p.busy) return;
    if (listening) return recRef.current?.stop();
    const rec = new SR();
    recRef.current = rec;
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setText(t);
      if (e.results[e.results.length - 1].isFinal) finalText = t;
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      const v = finalText.trim();
      if (v) {
        setText("");
        p.onRun(v);
      }
    };
    setListening(true);
    rec.start();
  };

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

  const reset = () => {
    setText("");
    setSel(0);
    if (p.inputRef.current) p.inputRef.current.style.height = "auto";
  };
  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || p.busy) return;
    if (v.startsWith("/")) {
      // "/note buy milk" runs exactly; "/no" runs the highlighted suggestion
      const exact = resolveSlash(p.slash, v);
      const cmd = exact?.cmd ?? slashMatches[Math.min(sel, slashMatches.length - 1)];
      if (cmd) {
        reset();
        void cmd.run(exact ? exact.arg : "");
        return;
      }
    }
    p.onRun(v);
    reset();
  };

  // "/" elsewhere in the app opens this box with the menu; Alt+1…9 runs the Nth suggestion
  useEffect(() => {
    const ask = (e: Event) => {
      const v = (e as CustomEvent<string>).detail ?? "";
      // commit synchronously: a render still queued from before would otherwise reset the box and eat the "/"
      flushSync(() => {
        setText(v);
        setSel(0);
      });
      const el = p.inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(v.length, v.length);
      }
    };
    const chip = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || p.busy) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (!m) return;
      const idx = +m[1] - 1;
      if (idx >= chipCount) return;
      e.preventDefault();
      const btn = ref.current?.querySelectorAll<HTMLButtonElement>(".chips .chip")[idx];
      btn?.click();
    };
    window.addEventListener("lumen:ask", ask);
    window.addEventListener("keydown", chip);
    return () => {
      window.removeEventListener("lumen:ask", ask);
      window.removeEventListener("keydown", chip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipCount, p.busy]);

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
          {slashOpen && (
            <ul className="slashmenu" role="listbox" aria-label="Commands" data-testid="slash-menu">
              {slashMatches.map((c, i) => (
                <li
                  key={c.id}
                  role="option"
                  aria-selected={i === sel}
                  className={i === sel ? "on" : ""}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    reset();
                    void c.run("");
                  }}
                  data-testid={`slash-${c.id}`}
                >
                  <i>{c.icon}</i>
                  <span className="n">
                    /{c.id}
                    {c.takesText && <em> text…</em>}
                  </span>
                  <small>{c.hint}</small>
                </li>
              ))}
            </ul>
          )}
          {!slashOpen && chipCount > 0 && (
            <div className="chips" role="toolbar" aria-label="Suggested actions">
              {p.actions.map((a, i) => (
                <button key={a.id} className="chip" onClick={a.run} data-testid={`action-${a.id}`} title={p.mobile ? undefined : `${ALT()}${i + 1}`}>
                  <i>{a.icon}</i>
                  {a.label}
                  {!p.mobile && i < 9 && <kbd>{ALT()}{i + 1}</kbd>}
                </button>
              ))}
              {p.suggestions.map((s, j) => {
                const n = p.actions.length + j;
                return (
                  <button
                    key={s.id + s.label}
                    className={`chip ${s.primary ? "primary" : ""}`}
                    onClick={() => p.onRun(s.prompt, s.id)}
                    data-testid={`intent-${s.id}`}
                    title={s.prompt}
                  >
                    <i>{s.icon}</i>
                    {s.label}
                    {!p.mobile && n < 9 && <kbd>{ALT()}{n + 1}</kbd>}
                  </button>
                );
              })}
            </div>
          )}
          <form className="ask" onSubmit={submit}>
            <textarea
              ref={p.inputRef}
              value={text}
              rows={1}
              onChange={(e) => {
                setText(e.target.value);
                setSel(0);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
              }}
              placeholder={p.placeholder}
              aria-label="Tell the canvas what to do"
              data-testid="intent-input"
              enterKeyHint="go"
              autoComplete="off"
              spellCheck={false}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.nativeEvent.isComposing) return;
                if (slashOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                  e.preventDefault();
                  setSel((i) => (i + (e.key === "ArrowDown" ? 1 : slashMatches.length - 1)) % slashMatches.length);
                  return;
                }
                if (slashOpen && e.key === "Tab" && !e.shiftKey) {
                  e.preventDefault();
                  const c = slashMatches[Math.min(sel, slashMatches.length - 1)];
                  setText(`/${c.id}${c.takesText ? " " : ""}`);
                  return;
                }
                if (e.key === "Escape") {
                  if (slashOpen || text) (reset(), e.preventDefault());
                  else (e.target as HTMLTextAreaElement).blur();
                  return;
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  const v = text.trim();
                  if (v && !p.busy) (p.onNote(v), reset());
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(e);
                }
              }}
            />
            {SR && (
              <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={toggleVoice} aria-label={listening ? "Stop dictation" : "Dictate"} aria-pressed={listening} title="Dictate" data-testid="mic">
                🎙
              </button>
            )}
            <button type="button" className={`engine ${p.engine}`} onClick={p.onEngineClick} title={p.engine === "claude" ? `Powered by ${p.engineLabel}` : "Offline engine — click to connect an AI"}>
              {p.engine === "claude" ? `✦ ${p.engineLabel}` : "○ Offline"}
            </button>
            <button className="send" disabled={!text.trim()} aria-label="Run">
              ↵
            </button>
          </form>
          {focused && !p.mobile && (
            <div className="ask-hint" aria-hidden>
              <span><kbd>↵</kbd> do it</span>
              <span><kbd>{MOD()}↵</kbd> add as note</span>
              <span><kbd>/</kbd> commands</span>
              <span><kbd>?</kbd> shortcuts</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
