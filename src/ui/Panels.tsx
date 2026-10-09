import { useEffect, useState } from "react";
import { diffScenes, relativeTime, type ProjectMeta, type Version } from "../store/projects";
import { DEFAULT_MODEL, type Settings } from "../ai/settings";
import { AppFrame } from "../live/LiveObject";
import { renderMarkdown } from "../live/runtime";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/* ───────── version history ───────── */

export function HistoryPanel({
  versions,
  current,
  onRestore,
  onSave,
  onClose,
}: {
  versions: Version[];
  current: readonly any[];
  onRestore: (v: Version) => void;
  onSave: (label: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  return (
    <aside className="history" aria-label="Version history" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <h3>History</h3>
        <button className="x" onClick={onClose} aria-label="Close history">
          ✕
        </button>
      </header>
      <form
        className="save-row"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(label.trim() || "Checkpoint");
          setLabel("");
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name a checkpoint…" onKeyDown={(e) => e.stopPropagation()} data-testid="checkpoint-name" />
        <button className="btn" data-testid="checkpoint-save">
          Save
        </button>
      </form>
      <ol>
        {versions.length === 0 && <li className="empty">Checkpoints appear here — automatically before every AI action, and whenever you save one.</li>}
        {versions.map((v, i) => {
          const d = diffScenes(versions[i + 1]?.elements, v.elements);
          const same = diffScenes(current, v.elements);
          const isNow = same.added + same.removed + same.changed === 0;
          return (
            <li key={v.id} data-testid="version-item">
              <div className="v-head">
                <span className={`kind ${v.kind}`}>{v.kind === "ai" ? "AI" : v.kind === "manual" ? "★" : v.kind === "restore" ? "↩" : "·"}</span>
                <strong>{v.label}</strong>
              </div>
              <div className="v-meta">
                {relativeTime(v.ts)} · {v.count} objects
                {(d.added || d.removed || d.changed) > 0 && (
                  <span className="diff">
                    {d.added > 0 && <b className="add"> +{d.added}</b>}
                    {d.removed > 0 && <b className="rem"> −{d.removed}</b>}
                    {d.changed > 0 && <b className="chg"> ~{d.changed}</b>}
                  </span>
                )}
              </div>
              {v.thumb && <img src={v.thumb} alt="" className="v-thumb" />}
              <button className="btn small" disabled={isNow} onClick={() => onRestore(v)} data-testid="version-restore">
                {isNow ? "Current" : "Restore"}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/* ───────── settings ───────── */

export function SettingsDialog({
  settings,
  serverClaude,
  onSave,
  onClose,
}: {
  settings: Settings;
  serverClaude: boolean;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(settings);
  return (
    <Modal title="Intelligence" onClose={onClose}>
      <div className="form">
        <p className="lead">
          Lumen works with no key at all — the <b>offline engine</b> restructures, clusters, reviews and builds prototypes from what's on your canvas.
          Connect <b>Claude</b> to generate new content, read sketches, and build bespoke apps.
        </p>
        {serverClaude && <p className="ok">✓ This deployment already has Claude enabled for everyone.</p>}
        <label>
          Anthropic API key <span className="mut">(stored only in this browser)</span>
          <input type="password" value={s.apiKey} placeholder="sk-ant-…" onChange={(e) => setS({ ...s, apiKey: e.target.value.trim() })} autoComplete="off" data-testid="api-key" onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label>
          Model
          <input value={s.model} placeholder={DEFAULT_MODEL} onChange={(e) => setS({ ...s, model: e.target.value.trim() || DEFAULT_MODEL })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.mode === "offline"} onChange={(e) => setS({ ...s, mode: e.target.checked ? "offline" : "auto" })} />
          Stay offline — never send anything off this device
        </label>
        <footer>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="settings-save"
            onClick={() => {
              onSave(s);
              onClose();
            }}
          >
            Save
          </button>
        </footer>
      </div>
    </Modal>
  );
}

/* ───────── live object editor / expander ───────── */

export function LiveEditor({
  kind,
  title,
  source,
  onSave,
  onClose,
}: {
  kind: "app" | "doc";
  title: string;
  source: string;
  onSave: (title: string, source: string) => void;
  onClose: () => void;
}) {
  const [t, setT] = useState(title);
  const [src, setSrc] = useState(source);
  const [theme] = useState<"light" | "dark">(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  return (
    <Modal title={kind === "app" ? "Live object — code" : "Document"} onClose={onClose} wide>
      <div className="editor">
        <div className="pane">
          <input className="title-in" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Title" />
          <textarea value={src} spellCheck={false} onChange={(e) => setSrc(e.target.value)} onKeyDown={(e) => e.stopPropagation()} data-testid="live-source" />
        </div>
        <div className="pane preview">
          {kind === "app" ? <AppFrame id="preview" html={src} theme={theme} title="Preview" /> : <div className="lo-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(src) }} />}
        </div>
      </div>
      <footer className="form-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => (onSave(t, src), onClose())} data-testid="live-save">
          Apply to canvas
        </button>
      </footer>
    </Modal>
  );
}

export function Expanded({ title, html, state, theme, onClose }: { title: string; html: string; state: unknown; theme: "light" | "dark"; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="expanded">
        <AppFrame id="expanded" html={html} state={state} theme={theme} title={title} />
      </div>
    </Modal>
  );
}

/* ───────── project list ───────── */

export function ProjectMenu({
  projects,
  currentId,
  onOpen,
  onNew,
  onDelete,
  onClose,
}: {
  projects: ProjectMeta[];
  currentId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="pmenu" onPointerDown={(e) => e.stopPropagation()} role="menu">
      <button className="new" onClick={() => (onNew(), onClose())} data-testid="new-project">
        ＋ New project
      </button>
      <ul>
        {projects.map((p) => (
          <li key={p.id} className={p.id === currentId ? "cur" : ""}>
            <button className="open" onClick={() => (onOpen(p.id), onClose())} role="menuitem">
              {p.thumb ? <img src={p.thumb} alt="" /> : <span className="ph" />}
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.count} objects · {relativeTime(p.updatedAt)}
                </small>
              </span>
            </button>
            {projects.length > 1 && (
              <button className="del" aria-label={`Delete ${p.name}`} onClick={() => confirm(`Delete “${p.name}” and its history?`) && onDelete(p.id)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────── empty-canvas starters ───────── */

export function Welcome({ onStarter, onFocus }: { onStarter: (id: "braindump" | "flow" | "outline" | "timer") => void; onFocus: () => void }) {
  return (
    <div className="welcome" onPointerDown={(e) => e.stopPropagation()}>
      <h1>
        Think here. <em>Then make it real.</em>
      </h1>
      <p>Draw, drop notes, or paste anything. The canvas understands what you make and offers the next move — no chat box required.</p>
      <div className="starters">
        <button onClick={() => onStarter("braindump")} data-testid="starter-braindump">
          <b>▦ Messy brain-dump</b>
          <span>12 loose notes → watch them organise themselves</span>
        </button>
        <button onClick={() => onStarter("flow")} data-testid="starter-flow">
          <b>⇢ Sketchy flowchart</b>
          <span>…then turn it into something you can click through</span>
        </button>
        <button onClick={() => onStarter("outline")} data-testid="starter-outline">
          <b>≡ Rough outline</b>
          <span>Indented text → structured diagram or mind map</span>
        </button>
        <button onClick={() => onStarter("timer")} data-testid="starter-timer">
          <b>▶ Working timer</b>
          <span>A real, interactive object living on the canvas</span>
        </button>
      </div>
      <p className="hint">
        or press <kbd>/</kbd> and type — try <code>kanban</code>, <code>Idea → Prototype → Test</code>, <code>pomodoro timer</code>
        <button className="link" onClick={onFocus}>
          focus prompt
        </button>
      </p>
    </div>
  );
}
