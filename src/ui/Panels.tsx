import { lazy, Suspense, useEffect, useState } from "react";
import { diffScenes, relativeTime, type ProjectMeta, type Version } from "../store/projects";
import { PROVIDERS, type ProviderId, type Settings } from "../ai/settings";
import { AppFrame } from "../live/LiveObject";
import { renderMarkdown } from "../live/runtime";

const CodeEditor = lazy(() => import("./CodeEditor"));

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

/* ───────── AI setup (shared by onboarding + settings) ───────── */

type TestState = null | "testing" | { ok: boolean; msg: string };

function ProviderSetup({ settings, onChange, onTest }: { settings: Settings; onChange: (s: Settings) => void; onTest?: (s: Settings) => Promise<string | null> }) {
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<TestState>(null);
  const info = PROVIDERS[settings.provider];
  const pick = (id: ProviderId) => {
    const prevDefault = PROVIDERS[settings.provider].model;
    onChange({ ...settings, provider: id, model: !settings.model || settings.model === prevDefault ? PROVIDERS[id].model : settings.model });
    setTest(null);
  };
  return (
    <div className="setup">
      <div className="providers" role="radiogroup" aria-label="AI provider">
        {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
          <button key={id} type="button" role="radio" aria-checked={settings.provider === id} className={settings.provider === id ? "on" : ""} onClick={() => pick(id)} data-testid={`provider-${id}`}>
            {PROVIDERS[id].short}
          </button>
        ))}
      </div>
      {settings.provider === "custom" && (
        <label>
          Endpoint <span className="mut">(OpenAI-compatible — OpenRouter, Groq, Ollama, LM Studio…)</span>
          <input value={settings.baseUrl} placeholder="https://openrouter.ai/api/v1" onChange={(e) => onChange({ ...settings, baseUrl: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} data-testid="base-url" />
        </label>
      )}
      <label>
        {info.label} API key <span className="mut">— stays in this browser</span>
        <span className="keyrow">
          <input type={show ? "text" : "password"} value={settings.apiKey} placeholder={info.keyHint} onChange={(e) => (onChange({ ...settings, apiKey: e.target.value.trim() }), setTest(null))} autoComplete="off" spellCheck={false} data-testid="api-key" onKeyDown={(e) => e.stopPropagation()} />
          <button type="button" className="btn small" onClick={() => setShow(!show)}>
            {show ? "Hide" : "Show"}
          </button>
        </span>
      </label>
      {info.keyUrl && (
        <a className="keylink" href={info.keyUrl} target="_blank" rel="noopener noreferrer">
          Get a {info.short} key ↗
        </a>
      )}
      <label>
        Model {info.model && <span className="mut">(default {info.model})</span>}
        <input value={settings.model} placeholder={info.model || "model name"} onChange={(e) => onChange({ ...settings, model: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} data-testid="model" />
      </label>
      {onTest && (
        <div className="testrow">
          <button
            type="button"
            className="btn small"
            disabled={test === "testing" || (!settings.apiKey && settings.provider !== "custom")}
            data-testid="test-connection"
            onClick={async () => {
              setTest("testing");
              const err = await onTest(settings);
              setTest(err ? { ok: false, msg: err } : { ok: true, msg: "Connected ✓" });
            }}
          >
            {test === "testing" ? "Testing…" : "Test connection"}
          </button>
          {test && test !== "testing" && (
            <span className={test.ok ? "ok" : "bad"} data-testid="test-result">
              {test.msg}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function SettingsDialog({
  settings,
  serverClaude,
  onSave,
  onTest,
  onClose,
}: {
  settings: Settings;
  serverClaude: boolean;
  onSave: (s: Settings) => void;
  onTest: (s: Settings) => Promise<string | null>;
  onClose: () => void;
}) {
  const [s, setS] = useState(settings);
  return (
    <Modal title="AI (optional)" onClose={onClose}>
      <div className="form">
        <p className="lead">
          Lumen is fully useful with <b>no AI</b>: the offline engine clusters, structures, reviews and builds prototypes from what's on your canvas. Add a key from any provider to also generate new content, read sketches and build bespoke apps.
        </p>
        {serverClaude && <p className="ok">✓ This deployment already provides AI for everyone.</p>}
        <ProviderSetup settings={s} onChange={setS} onTest={onTest} />
        <label>
          Live collaboration server <span className="mut">(optional — wss:// address of server/relay.mjs)</span>
          <input value={s.collabUrl} placeholder="wss://your-relay.example.com" onChange={(e) => setS({ ...s, collabUrl: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} data-testid="collab-url" />
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

/** First-run popup: friendly, skippable, one decision. */
export function Onboarding({ settings, onSave, onTest, onDone }: { settings: Settings; onSave: (s: Settings) => void; onTest: (s: Settings) => Promise<string | null>; onDone: () => void }) {
  const [s, setS] = useState(settings);
  const [open, setOpen] = useState(false);
  return (
    <Modal title="Welcome to Lumen" onClose={onDone}>
      <div className="form" data-testid="onboarding">
        <p className="lead">
          A canvas that understands what you draw. <b>Everything works without AI</b> — clustering, flowcharts, mind maps, review, live prototypes, history and sharing.
        </p>
        {!open ? (
          <>
            <button className="btn primary big" onClick={onDone} data-testid="onboarding-skip">
              Start drawing
            </button>
            <button className="btn" onClick={() => setOpen(true)} data-testid="onboarding-connect">
              I have an AI key — connect it
            </button>
            <p className="mut small">You can add one any time from ✦ in the top right.</p>
          </>
        ) : (
          <>
            <ProviderSetup settings={s} onChange={setS} onTest={onTest} />
            <footer>
              <button className="btn" onClick={onDone}>
                Skip
              </button>
              <button
                className="btn primary"
                data-testid="onboarding-save"
                onClick={() => {
                  onSave(s);
                  onDone();
                }}
              >
                Save & start
              </button>
            </footer>
          </>
        )}
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
          <Suspense fallback={<div className="cm-host mut">Loading editor…</div>}>
            <CodeEditor value={src} lang={kind === "app" ? "html" : "markdown"} dark={theme === "dark"} onChange={setSrc} />
          </Suspense>
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

/* ───────── command palette (⌘K) ───────── */

export interface Command {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({ commands, onAsk, onClose }: { commands: Command[]; onAsk: (text: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const query = q.trim().toLowerCase();
  const matches = commands.filter((c) => !query || (c.label + " " + (c.keywords ?? "") + " " + (c.hint ?? "")).toLowerCase().includes(query)).slice(0, 9);
  const rows: (Command | { id: "ask"; label: string; run: () => void; hint?: string })[] = query ? [...matches, { id: "ask", label: `Ask Lumen: “${q.trim()}”`, hint: "run as a prompt", run: () => onAsk(q.trim()) }] : matches;
  const act = (c: { run: () => void }) => {
    onClose();
    setTimeout(c.run, 0);
  };
  return (
    <div className="scrim top" onPointerDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onPointerDown={(e) => e.stopPropagation()} data-testid="palette">
        <input
          autoFocus
          value={q}
          placeholder="Do anything — or just describe it…"
          aria-label="Search commands"
          data-testid="palette-input"
          onChange={(e) => (setQ(e.target.value), setI(0))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") (e.preventDefault(), setI((i + 1) % rows.length));
            else if (e.key === "ArrowUp") (e.preventDefault(), setI((i - 1 + rows.length) % rows.length));
            else if (e.key === "Enter" && rows[i]) (e.preventDefault(), act(rows[i]));
          }}
        />
        <ul role="listbox">
          {rows.map((c, n) => (
            <li key={c.id} role="option" aria-selected={n === i} className={n === i ? "on" : ""} onMouseEnter={() => setI(n)} onClick={() => act(c)}>
              <span>{c.label}</span>
              {c.hint && <small>{c.hint}</small>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ───────── template gallery ───────── */

export function TemplateGallery({ templates, onPick, onClose }: { templates: { id: string; label: string; desc: string; icon: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Modal title="Start from a template" onClose={onClose} wide>
      <div className="gallery" data-testid="gallery">
        {templates.map((t) => (
          <button key={t.id} onClick={() => (onClose(), onPick(t.id))} data-testid={`template-${t.id}`}>
            <i>{t.icon}</i>
            <b>{t.label}</b>
            <span>{t.desc}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
