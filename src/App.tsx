import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  CaptureUpdateAction,
  getCommonBounds,
  newElementWith,
  reconcileElements,
  exportToCanvas,
  exportToBlob,
  restoreElements,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";

import { buildGraph, getMeta, type CanvasGraph } from "./canvas/context";
import { buildNotes, executePlan, insertSkeleton, LIVE_HOST, uid, type ExecResult } from "./canvas/execute";
import { runIntent, engineAvailable, serverHasClaude, type EngineKind } from "./ai/engine";
import { suggestFor, type IntentId, type Suggestion } from "./ai/intents";
import { loadSettings, markOnboarded, PROVIDERS, saveSettings, wasOnboarded, type Settings } from "./ai/settings";
import { askProvider } from "./ai/providers";
import type { Plan } from "./ai/schema";
import { TEMPLATES } from "./live/templates";
import { LiveObject, frameRegistry } from "./live/LiveObject";
import {
  addVersion,
  Autosaver,
  createProject,
  deleteProject,
  getMeta as getProjectMeta,
  listProjects,
  listVersions,
  loadProject,
  renameProject,
  saveProject,
  sceneSignature,
  type ProjectData,
  type ProjectMeta,
  type Version,
} from "./store/projects";
import { BroadcastSync, newRoomId, projectOfRoom, randomIdentity, roomOf, setRoom, WebSocketSync, type SyncAdapter, type SyncMessage } from "./store/sync";
import { decodeBoard, encodeBoard, MAX_LINK_CHARS } from "./store/share";
import { Dock } from "./ui/Dock";
import { Expanded, HistoryPanel, LiveEditor, Onboarding, ProjectMenu, SettingsDialog, Welcome } from "./ui/Panels";

const CURRENT_KEY = "lumen:current";
const isMobile = () => window.innerWidth < 700;

/* ═════════════════════════ shell: project list + switching ═════════════════════════ */

export default function App() {
  const [boot, setBoot] = useState<{ projects: ProjectMeta[]; id: string; data: ProjectData } | null>(null);

  const open = useCallback(async (id: string, list?: ProjectMeta[]) => {
    const projects = list ?? (await listProjects());
    const data = (await loadProject(id)) ?? { elements: [], files: {} };
    try {
      localStorage.setItem(CURRENT_KEY, id);
    } catch {}
    setBoot({ projects, id, data });
  }, []);

  useEffect(() => {
    (async () => {
      let projects = await listProjects();
      // a shared link opens as its own project (the fragment never leaves the browser)
      const joinRoom = /^#room=([A-Za-z0-9_-]{8,64})$/.exec(location.hash)?.[1];
      if (joinRoom) {
        let pid = projectOfRoom(joinRoom);
        if (!pid || !projects.some((p) => p.id === pid)) {
          pid = (await createProject("Live board")).id;
          setRoom(pid, joinRoom);
        }
        history.replaceState(null, "", location.pathname + location.search);
        await open(pid);
        return;
      }
      const shared = await decodeBoard(location.hash);
      if (shared) {
        const p = await createProject(shared.name, { elements: shared.elements, files: {} });
        history.replaceState(null, "", location.pathname + location.search);
        projects = await listProjects();
        await open(p.id, projects);
        return;
      }
      if (!projects.length) projects = [await createProject("My first board")];
      let id = "";
      try {
        id = localStorage.getItem(CURRENT_KEY) || "";
      } catch {}
      if (!projects.some((p) => p.id === id)) id = projects[0].id;
      await open(id, projects);
    })();
  }, [open]);

  if (!boot) return <div className="boot">Lumen</div>;
  return (
    <Workspace
      key={boot.id}
      meta={boot.projects.find((p) => p.id === boot.id)!}
      initial={boot.data}
      projects={boot.projects}
      onOpen={(id) => open(id)}
      onNew={async () => {
        const p = await createProject("Untitled");
        await open(p.id);
      }}
      onDelete={async (id) => {
        await deleteProject(id);
        let rest = await listProjects();
        if (!rest.length) rest = [await createProject("My first board")];
        await open(id === boot.id ? rest[0].id : boot.id, rest);
      }}
      refresh={async () => setBoot((b) => (b ? { ...b } : b))}
      reloadList={async () => setBoot((b) => (b ? b : b))}
    />
  );
}

/* ═════════════════════════ one project ═════════════════════════ */

interface WorkspaceProps {
  meta: ProjectMeta;
  initial: ProjectData;
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  refresh: () => void;
  reloadList: () => void;
}

interface SelState {
  ids: string[];
  rect: { x: number; y: number; w: number; h: number } | null;
  graph: CanvasGraph | null;
  live: ExcalidrawEmbeddableElement | null;
}

function Workspace({ meta, initial, projects, onOpen, onNew, onDelete }: WorkspaceProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const t = localStorage.getItem("lumen:theme");
      if (t === "dark" || t === "light") return t;
    } catch {}
    return matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [sel, setSel] = useState<SelState>({ ids: [], rect: null, graph: null, live: null });
  const [empty, setEmpty] = useState(initial.elements.filter((e) => !e.isDeleted).length === 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; note?: string; undo?: boolean; id: number } | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [engine, setEngine] = useState<EngineKind>("offline");
  const [serverClaude, setServerClaude] = useState(false);
  const [panel, setPanel] = useState<null | "history" | "settings" | "projects">(null);
  const [room, setRoomState] = useState<string | null>(() => roomOf(meta.id));
  const [link, setLink] = useState<"connecting" | "open" | "closed">("closed");
  const [onboard, setOnboard] = useState(() => !wasOnboarded());
  const [versions, setVersions] = useState<Version[]>([]);
  const [editing, setEditing] = useState<null | { id: string; kind: "app" | "doc" }>(null);
  const [expanded, setExpanded] = useState<null | { id: string }>(null);
  const [peers, setPeers] = useState<{ id: string; name: string; color: string }[]>([]);
  const [name, setName] = useState(meta.name);
  const [renaming, setRenaming] = useState(false);
  const [mobile, setMobile] = useState(isMobile());

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autosaver = useRef(new Autosaver(450)).current;
  const lastSig = useRef(sceneSignature(initial.elements));
  const lastAutoVersion = useRef(Date.now());
  const dirtySinceVersion = useRef(false);
  const viewRef = useRef(initial.view);
  const thumbRef = useRef<string | undefined>(meta.thumb);
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selRaf = useRef(0);
  const themeRef = useRef(theme);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const toastId = useRef(0);

  /* ───────── engine probing ───────── */
  useEffect(() => {
    (async () => {
      setServerClaude(await serverHasClaude());
      setEngine(await engineAvailable(settings));
    })();
  }, [settings]);

  useEffect(() => {
    const on = () => setMobile(isMobile());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#121212" : "#fbfaf7");
    try {
      localStorage.setItem("lumen:theme", theme);
    } catch {}
  }, [theme]);

  const testConnection = useCallback(async (s: Settings): Promise<string | null> => {
    try {
      await askProvider({ prompt: "Add one note that says hello.", graph: buildGraph([], []) }, s, false);
      return null;
    } catch (e: any) {
      return String(e?.message ?? e).slice(0, 160);
    }
  }, []);

  /* ───────── helpers ───────── */
  const say = useCallback((text: string, opts: { note?: string; undo?: boolean } = {}) => {
    const id = ++toastId.current;
    setToast({ text, ...opts, id });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), opts.undo ? 9000 : 6000);
  }, []);

  const thumbnail = useCallback(async (max = 280): Promise<string | undefined> => {
    const a = apiRef.current;
    if (!a) return;
    try {
      const els = a.getSceneElements();
      if (!els.length) return;
      const c = await exportToCanvas({
        elements: els,
        appState: { exportBackground: true, viewBackgroundColor: themeRef.current === "dark" ? "#121212" : "#ffffff", exportWithDarkMode: themeRef.current === "dark" },
        files: a.getFiles(),
        maxWidthOrHeight: max,
      });
      return c.toDataURL("image/jpeg", 0.6);
    } catch {
      return;
    }
  }, []);

  const checkpoint = useCallback(
    async (label: string, kind: Version["kind"]) => {
      const a = apiRef.current;
      if (!a) return;
      const v = await addVersion(meta.id, label, kind, a.getSceneElementsIncludingDeleted(), await thumbnail(220));
      if (v) {
        lastAutoVersion.current = Date.now();
        dirtySinceVersion.current = false;
      }
      return v;
    },
    [meta.id, thumbnail],
  );

  const persist = useCallback(async () => {
    const a = apiRef.current;
    if (!a) return;
    await saveProject(
      meta.id,
      { elements: a.getSceneElementsIncludingDeleted() as any, files: a.getFiles() as any, view: viewRef.current },
      thumbRef.current,
    );
  }, [meta.id]);

  useEffect(() => {
    const flush = () => void autosaver.flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
    return () => {
      window.removeEventListener("pagehide", flush);
      void autosaver.flush();
    };
  }, [autosaver]);

  /* ───────── sync (multi-tab collaboration) ───────── */
  const syncRef = useRef<BroadcastSync | null>(null);
  const sentVersions = useRef(new Map<string, number>());
  const sentFiles = useRef(new Set<string>());
  const identity = useRef(randomIdentity()).current;
  const peerMap = useRef(new Map<string, { name: string; color: string; ts: number }>());
  const collaborators = useRef(new Map<SocketId, Collaborator>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publishScene = useCallback(() => {
    const a = apiRef.current;
    const sync = syncRef.current;
    if (!a || !sync) return;
    const all = a.getSceneElementsIncludingDeleted();
    const changed = all.filter((e) => sentVersions.current.get(e.id) !== e.version);
    if (!changed.length) return;
    changed.forEach((e) => sentVersions.current.set(e.id, e.version));
    const files = a.getFiles();
    const fileBlobs: any[] = [];
    for (const e of changed)
      if (e.type === "image" && (e as any).fileId && !sentFiles.current.has((e as any).fileId) && files[(e as any).fileId]) {
        sentFiles.current.add((e as any).fileId);
        fileBlobs.push(files[(e as any).fileId]);
      }
    sync.publish({ t: "scene", from: sync.id, elements: changed as any, files: fileBlobs } as any);
  }, []);

  useEffect(() => {
    if (!api) return;
    const collabUrl = settingsRef.current.collabUrl;
    const sync: SyncAdapter = room && collabUrl ? new WebSocketSync(collabUrl, room, setLink) : new BroadcastSync(meta.id);
    syncRef.current = sync as BroadcastSync;
    api.getSceneElementsIncludingDeleted().forEach((e) => sentVersions.current.set(e.id, e.version));
    const refreshPeers = () => {
      const now = Date.now();
      for (const [id, p] of peerMap.current) if (now - p.ts > 6500) (peerMap.current.delete(id), collaborators.current.delete(id as SocketId));
      setPeers([...peerMap.current].map(([id, p]) => ({ id, name: p.name, color: p.color })));
      api.updateScene({ collaborators: new Map(collaborators.current) });
    };
    const hello = () => sync.publish({ t: "hello", from: sync.id, name: identity.name, color: identity.color });
    sync.start((m: SyncMessage & { files?: any[] }) => {
      if (m.t === "hello") {
        const isNew = !peerMap.current.has(m.from);
        peerMap.current.set(m.from, { name: m.name, color: m.color, ts: Date.now() });
        if (isNew) {
          hello();
          // let a newcomer catch up: resend everything once
          sentVersions.current.clear();
          publishScene();
        }
        refreshPeers();
      } else if (m.t === "scene") {
        if (m.files?.length) api.addFiles(m.files);
        const merged = reconcileElements(api.getSceneElementsIncludingDeleted() as any, m.elements as any, api.getAppState() as any);
        merged.forEach((e) => sentVersions.current.set(e.id, e.version));
        api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
      } else if (m.t === "pointer") {
        const p = peerMap.current.get(m.from);
        if (p) p.ts = Date.now();
        collaborators.current.set(m.from as SocketId, {
          pointer: { x: m.x, y: m.y, tool: m.tool as "pointer" | "laser" },
          username: m.name,
          color: { background: m.color, stroke: m.color },
        } as Collaborator);
        api.updateScene({ collaborators: new Map(collaborators.current) });
      } else if (m.t === "leave") {
        peerMap.current.delete(m.from);
        collaborators.current.delete(m.from as SocketId);
        refreshPeers();
      }
    });
    hello();
    const iv = setInterval(() => (hello(), refreshPeers()), 2500);
    return () => {
      clearInterval(iv);
      sync.stop();
      syncRef.current = null;
    };
  }, [api, meta.id, identity, publishScene, room, settings.collabUrl]);

  /* ───────── live-object state bridge ───────── */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const a = apiRef.current;
      if (!a || !e.source || !e.data || e.data.lumen !== "save") return;
      const id = frameRegistry.get(e.source as Window);
      if (!id) return;
      const els = a.getSceneElementsIncludingDeleted();
      const el = els.find((x) => x.id === id);
      if (!el) return;
      let state: unknown;
      try {
        state = JSON.parse(JSON.stringify(e.data.state ?? null));
      } catch {
        return;
      }
      if (JSON.stringify(state).length > 400_000) return;
      const lumen = { ...(el.customData?.lumen ?? {}), state };
      a.updateScene({
        elements: els.map((x) => (x.id === id ? newElementWith(x, { customData: { ...el.customData, lumen } }) : x)),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  /* ───────── selection tracking ───────── */
  const updateSelection = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    cancelAnimationFrame(selRaf.current);
    selRaf.current = requestAnimationFrame(() => {
      const ids = Object.keys(appState.selectedElementIds).filter((k) => appState.selectedElementIds[k]);
      if (!ids.length || appState.editingTextElement || appState.newElement) {
        setSel((s) => (s.ids.length || s.rect ? { ids: [], rect: null, graph: null, live: null } : s));
        return;
      }
      const selEls = elements.filter((e) => !e.isDeleted && ids.includes(e.id));
      if (!selEls.length) return setSel((s) => (s.ids.length ? { ids: [], rect: null, graph: null, live: null } : s));
      const [x1, y1, x2, y2] = getCommonBounds(selEls);
      const a = sceneCoordsToViewportCoords({ sceneX: x1, sceneY: y1 }, appState);
      const b = sceneCoordsToViewportCoords({ sceneX: x2, sceneY: y2 }, appState);
      const rect = { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(b.x - a.x), h: Math.round(b.y - a.y) };
      setSel((prev) => {
        const key = ids.join(",") + selEls.map((e) => e.version).join(",");
        const same = prev.ids.join(",") + (prev as any).key === ids.join(",") + key;
        void same;
        const unchanged =
          (prev as any).key === key && prev.rect && prev.rect.x === rect.x && prev.rect.y === rect.y && prev.rect.w === rect.w && prev.rect.h === rect.h;
        if (unchanged) return prev;
        const graph = (prev as any).key === key && prev.graph ? prev.graph : buildGraph(elements, ids);
        const live = selEls.length === 1 && selEls[0].type === "embeddable" && getMeta(selEls[0]) ? (selEls[0] as ExcalidrawEmbeddableElement) : null;
        return { ids, rect, graph, live, key } as SelState;
      });
    });
  }, []);

  /* ───────── onChange: persist, version, sync ───────── */
  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (appState.theme !== themeRef.current) {
        themeRef.current = appState.theme as "light" | "dark";
        setTheme(appState.theme as "light" | "dark");
      }
      updateSelection(elements, appState);
      const view = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value };
      const viewChanged = !viewRef.current || viewRef.current.scrollX !== view.scrollX || viewRef.current.scrollY !== view.scrollY || viewRef.current.zoom !== view.zoom;
      viewRef.current = view;
      const sig = sceneSignature(elements);
      const changed = sig !== lastSig.current;
      if (changed) {
        lastSig.current = sig;
        dirtySinceVersion.current = true;
        setEmpty(elements.every((e) => e.isDeleted));
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(publishScene, 40);
        if (thumbTimer.current) clearTimeout(thumbTimer.current);
        thumbTimer.current = setTimeout(async () => {
          thumbRef.current = await thumbnail();
          autosaver.schedule(persist);
        }, 3500);
        if (Date.now() - lastAutoVersion.current > 4 * 60_000) {
          lastAutoVersion.current = Date.now();
          void checkpoint("Autosave", "auto");
        }
      }
      if (changed || viewChanged) autosaver.schedule(persist);
    },
    [autosaver, persist, publishScene, thumbnail, updateSelection, checkpoint],
  );

  /* ───────── keyboard: "/" or ⌘K to talk to the canvas ───────── */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  /* ───────── running intents ───────── */
  const sceneCenter = (a: ExcalidrawImperativeAPI) => {
    const s = a.getAppState();
    return viewportCoordsToSceneCoords({ clientX: s.offsetLeft + s.width / 2, clientY: s.offsetTop + s.height / 2 }, s);
  };

  const undo = useCallback(() => {
    // Excalidraw only honours shortcuts while the canvas owns focus; hand it focus, then press ⌘/Ctrl+Z.
    const c = document.querySelector<HTMLElement>(".excalidraw-container");
    c?.focus();
    const ev = { key: "z", code: "KeyZ", ctrlKey: true, metaKey: true, bubbles: true } as KeyboardEventInit;
    (c ?? document).dispatchEvent(new KeyboardEvent("keydown", ev));
    setToast(null);
  }, []);

  const select = useCallback((a: ExcalidrawImperativeAPI, ids: string[]) => {
    if (!ids.length) return;
    a.updateScene({ appState: { selectedElementIds: Object.fromEntries(ids.map((i) => [i, true])) } as any });
  }, []);

  const reveal = useCallback((a: ExcalidrawImperativeAPI, els: readonly ExcalidrawElement[]) => {
    if (!els.length) return;
    const s = a.getAppState();
    const [x1, y1, x2, y2] = getCommonBounds(els);
    const p1 = sceneCoordsToViewportCoords({ sceneX: x1, sceneY: y1 }, s);
    const p2 = sceneCoordsToViewportCoords({ sceneX: x2, sceneY: y2 }, s);
    const margin = 40;
    const inside = p1.x > margin && p1.y > 70 && p2.x < window.innerWidth - margin && p2.y < window.innerHeight - 110;
    if (!inside) a.scrollToContent(els as any, { fitToViewport: true, viewportZoomFactor: 0.78, animate: true, maxZoom: 1.2, duration: 500 });
  }, []);

  const run = useCallback(
    async (prompt: string, intent?: IntentId) => {
      const a = apiRef.current;
      if (!a || busy) return;
      const state = a.getAppState();
      const elements = a.getSceneElements();
      const ids = Object.keys(state.selectedElementIds).filter((k) => state.selectedElementIds[k]);
      const graph = buildGraph(elements, ids);
      const selected = elements.filter((e) => ids.includes(e.id));
      const liveSel = selected.length === 1 && selected[0].type === "embeddable" && getMeta(selected[0]) ? selected[0] : null;
      const eng = await engineAvailable(settingsRef.current);
      setBusy(eng === "claude" ? "Claude is working on it…" : "Working on it…");
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        await checkpoint(`Before: ${prompt.slice(0, 44)}`, "ai");
        const selectionBlob = async () =>
          exportToBlob({
            elements: selected,
            appState: { exportBackground: true, viewBackgroundColor: "#ffffff" } as any,
            files: a.getFiles(),
            mimeType: "image/png",
            maxWidthOrHeight: intent === "ocr" ? 2400 : 1280,
          });
        // let the AI see sketches and handwriting
        let imageBase64: string | undefined;
        if (eng === "claude" && selected.length && intent !== "ocr") {
          try {
            const blob = await selectionBlob();
            imageBase64 = await new Promise<string>((res) => {
              const r = new FileReader();
              r.onload = () => res(String(r.result).split(",")[1]);
              r.readAsDataURL(blob);
            });
          } catch {}
        }
        const lm = liveSel ? getMeta(liveSel) : undefined;
        let plan: Plan & { note?: string };
        if (intent === "ocr") {
          setBusy("Reading text on-device…");
          const { recognize } = await import("./ocr/ocr");
          const r = await recognize(await selectionBlob());
          plan = r.text
            ? { say: `Read ${r.text.split("\n").length} line(s) on-device.`, ops: [{ op: "answer", title: "Text I read", text: r.text }], engine: "offline", note: r.confidence < 60 ? "Low confidence — handwriting works best with an AI key." : undefined }
            : { say: "Couldn't find readable text.", ops: [], engine: "offline", note: "Printed text and screenshots work best; for handwriting, connect an AI key." };
        } else plan = await runIntent(
          { prompt, intent, graph, imageBase64, editing: lm ? { title: lm.title, html: lm.html, markdown: lm.markdown } : undefined },
          settingsRef.current,
          ctl.signal,
        );

        // "change this live object" edits in place instead of spawning a sibling
        let ops = plan.ops;
        if (liveSel) {
          const i = ops.findIndex((o) => (lm?.kind === "app" && o.op === "app") || (lm?.kind === "doc" && o.op === "doc"));
          if (i >= 0) {
            const o = ops[i] as any;
            const els = a.getSceneElementsIncludingDeleted();
            a.updateScene({
              elements: els.map((x) =>
                x.id === liveSel.id
                  ? newElementWith(x, { customData: { ...x.customData, lumen: { ...lm, title: o.title ?? lm?.title, ...(o.html ? { html: o.html, state: undefined } : {}), ...(o.markdown ? { markdown: o.markdown } : {}) } } })
                  : x,
              ),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
            ops = ops.filter((_, j) => j !== i);
          }
        }

        const sc = sceneCenter(a);
        const bounds = graph.bounds;
        const res: ExecResult = await executePlan(
          a,
          { ...plan, ops },
          bounds && graph.scope === "selection"
            ? { graph, anchor: { x: bounds.x + bounds.w + 120, y: bounds.y }, anchorMode: "corner" }
            : { graph, anchor: sc, anchorMode: "center" },
        );
        const made = a.getSceneElements().filter((e) => res.created.includes(e.id));
        if (made.length && !(ops.length && ops.every((o) => o.op === "flag"))) {
          const focus = made.filter((e) => !["arrow", "text"].includes(e.type) || e.type === "text").map((e) => e.id);
          select(a, focus.length ? focus : res.created);
          reveal(a, made);
        } else if (res.touched.length) select(a, res.touched);
        // annotations-only plans (review): leave the result unobstructed
        if (ops.length && ops.every((o) => o.op === "flag") && res.created.length)
          a.updateScene({ appState: { selectedElementIds: {} } as any });
        say(plan.say || (res.created.length || res.touched.length ? "Done." : "Nothing changed."), {
          note: plan.note,
          undo: res.created.length > 0 || res.touched.length > 0 || ops.length !== plan.ops.length,
        });
      } catch (e: any) {
        if (e?.name !== "AbortError") say("That didn't work.", { note: String(e?.message ?? e).slice(0, 140) });
        else say("Cancelled.");
      } finally {
        setBusy(null);
        abortRef.current = null;
      }
    },
    [busy, checkpoint, reveal, say, select],
  );

  /* ───────── live object actions ───────── */
  const liveEl = sel.live;
  const liveMeta = liveEl ? getMeta(liveEl) : undefined;

  const patchLive = (id: string, patch: (m: any) => any) => {
    const a = apiRef.current!;
    a.updateScene({
      elements: a.getSceneElementsIncludingDeleted().map((x) => (x.id === id ? newElementWith(x, { customData: { ...x.customData, lumen: patch(x.customData?.lumen ?? {}) } }) : x)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const duplicateLive = () => {
    const a = apiRef.current;
    if (!a || !liveEl) return;
    const id = uid("o");
    const [copy] = restoreElements(
      [{ ...(liveEl as any), id, x: liveEl.x + liveEl.width + 40, link: `${LIVE_HOST}/o/${id}`, version: 1, versionNonce: Math.floor(Math.random() * 1e9), customData: JSON.parse(JSON.stringify(liveEl.customData ?? {})) }],
      null,
    );
    a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), copy], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    select(a, [copy.id]);
  };

  const actions = useMemo(() => {
    if (!liveEl || !liveMeta) return [];
    const list: { id: string; label: string; icon: string; run: () => void }[] = [];
    if (liveMeta.kind === "app") list.push({ id: "open", label: "Open", icon: "⤢", run: () => setExpanded({ id: liveEl.id }) });
    list.push({ id: "edit", label: liveMeta.kind === "app" ? "Code" : "Edit", icon: liveMeta.kind === "app" ? "‹›" : "✎", run: () => setEditing({ id: liveEl.id, kind: liveMeta.kind as "app" | "doc" }) });
    if (liveMeta.kind === "app" && (liveMeta as any).state != null) list.push({ id: "reset", label: "Reset", icon: "↺", run: () => patchLive(liveEl.id, (m) => ({ ...m, state: undefined })) });
    list.push({ id: "dup", label: "Duplicate", icon: "⧉", run: duplicateLive });
    return list;
  }, [liveEl?.id, liveMeta?.kind, (liveMeta as any)?.state != null]);

  /* ───────── history ───────── */
  const openHistory = async () => {
    setVersions(await listVersions(meta.id));
    setPanel("history");
  };
  const restore = async (v: Version) => {
    const a = apiRef.current;
    if (!a) return;
    await checkpoint("Before restore", "restore");
    const cur = a.getSceneElementsIncludingDeleted();
    const curMap = new Map(cur.map((e) => [e.id, e]));
    const vIds = new Set(v.elements.map((e: any) => e.id));
    const bump = (e: any, over: any = {}) => ({ ...e, ...over, version: (curMap.get(e.id)?.version ?? e.version) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });
    const next = [...v.elements.map((e: any) => bump(e)), ...cur.filter((e) => !vIds.has(e.id) && !e.isDeleted).map((e) => bump(e, { isDeleted: true }))];
    a.updateScene({ elements: next as any, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setVersions(await listVersions(meta.id));
    say(`Restored “${v.label}”.`, { undo: true });
  };

  const shareLink = async () => {
    const a = apiRef.current;
    if (!a) return;
    const link = location.origin + location.pathname + (await encodeBoard(a.getSceneElementsIncludingDeleted(), name));
    if (link.length > MAX_LINK_CHARS) return say("Too big for a link.", { note: "Export the file instead (menu → Export)." });
    try {
      await navigator.clipboard.writeText(link);
      say("Share link copied.", { note: "Anyone with it gets their own copy — the board is inside the link, not on a server." });
    } catch {
      window.prompt("Copy this link", link);
    }
  };

  const shareLive = async () => {
    if (!settingsRef.current.collabUrl) {
      say("Live sharing needs a relay server.", { note: "Add its address in ✦ settings (server/relay.mjs — see README)." });
      return setPanel("settings");
    }
    const id = room ?? newRoomId();
    setRoom(meta.id, id);
    setRoomState(id);
    const url = `${location.origin}${location.pathname}#room=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      say("Live link copied.", { note: "Anyone with it joins this board in real time. Keep the link private." });
    } catch {
      window.prompt("Copy this live link", url);
    }
  };
  const leaveLive = () => {
    setRoom(meta.id, null);
    setRoomState(null);
    setLink("closed");
    say("Stopped live sharing. Your copy stays here.");
  };

  /* ───────── starters ───────── */
  const starter = (kind: "braindump" | "flow" | "outline" | "timer") => {
    const a = apiRef.current;
    if (!a) return;
    const c = sceneCenter(a);
    if (kind === "braindump") {
      const texts = ["Pricing page redesign", "Welcome email sequence", "Offline mode for the mobile app", "Annual discount for teams", "Onboarding checklist for new users", "Push notifications on mobile", "Pricing experiment: usage-based tiers", "Onboarding video walkthrough", "Mobile dark mode", "Fix login timeout bug", "Crash when uploading large images", "Referral program rewards"];
      const placed = buildNotes({ op: "notes", items: texts.map((text) => ({ text })) }, 0, 0);
      const cells = Array.from({ length: 12 }, (_, i) => i).sort(() => Math.random() - 0.5);
      placed.sk.forEach((s: any, i) => {
        const cell = cells[i];
        s.x = c.x - 520 + (cell % 4) * 270 + (Math.random() * 50 - 25);
        s.y = c.y - 330 + Math.floor(cell / 4) * 230 + (Math.random() * 50 - 25);
        s.angle = (Math.random() - 0.5) * 0.12;
      });
      void insertSkeleton(a, placed.sk).then((made) => {
        select(a, made.map((m) => m.id));
        say("Twelve loose notes. Try ‘Cluster’ below.");
      });
    } else if (kind === "outline") {
      void insertSkeleton(a, [
        {
          type: "text",
          x: c.x - 160,
          y: c.y - 160,
          fontSize: 22,
          fontFamily: 5,
          text: "Launch plan\n  Research\n    Interview 5 users\n    Competitor teardown\n  Build\n    MVP scope clear?\n      Yes: Prototype it\n      No: Cut the scope\n  Ship\n    Announce on launch day",
        } as any,
      ]).then((made) => {
        select(a, made.map((m) => m.id));
        say("Rough outline dropped in. Structure it or mind-map it.");
      });
    } else if (kind === "timer") {
      const spec = TEMPLATES.timer.build("Focus timer");
      void executePlan(a, { say: "", ops: [{ op: "app", ...spec }] }, { graph: buildGraph([], []), anchor: c, anchorMode: "center" }).then((r) => {
        select(a, r.created);
        say("A live object. Click its centre to use it — its state is saved.");
      });
    } else {
      void executePlan(
        a,
        {
          say: "",
          ops: [
            {
              op: "diagram",
              layout: "flow-down",
              nodes: [
                { id: "a", label: "Visit landing page" },
                { id: "b", label: "Sign up" },
                { id: "c", label: "Email verified?", shape: "diamond" },
                { id: "d", label: "Resend email" },
                { id: "e", label: "Pick a plan" },
                { id: "g", label: "Payment succeeded?", shape: "diamond" },
                { id: "f", label: "Dashboard" },
              ],
              edges: [
                { from: "a", to: "b" },
                { from: "b", to: "c" },
                { from: "c", to: "e", label: "Yes" },
                { from: "c", to: "d", label: "No" },
                { from: "d", to: "c" },
                { from: "e", to: "g" },
                { from: "g", to: "f", label: "Yes" },
              ],
            },
          ],
        },
        { graph: buildGraph([], []), anchor: c, anchorMode: "center" },
      ).then((r) => {
        const els = a.getSceneElements().filter((e) => r.created.includes(e.id));
        select(a, els.map((e) => e.id));
        say("A flowchart. Try ‘Find gaps’ — or ‘Make it run’.");
      });
    }
  };

  /* ───────── derived UI ───────── */
  const suggestions: Suggestion[] = useMemo(() => (sel.graph && !liveEl ? suggestFor(sel.graph) : []), [sel.graph, liveEl]);
  const placeholder = liveEl
    ? liveMeta?.kind === "app"
      ? "Change this… e.g. “add a reset button”"
      : "Change this document…"
    : sel.ids.length
      ? "Tell it what to do with this…"
      : empty
        ? "Type anything… try “kanban”"
        : "Ask the canvas…  ( / )";

  const editingEl = editing ? (api?.getSceneElements().find((e) => e.id === editing.id) as ExcalidrawEmbeddableElement | undefined) : undefined;
  const expandedEl = expanded ? (api?.getSceneElements().find((e) => e.id === expanded.id) as ExcalidrawEmbeddableElement | undefined) : undefined;

  return (
    <div className={`app ${mobile ? "is-mobile" : ""}`} data-theme={theme}>
      <Excalidraw
        excalidrawAPI={(a) => {
          apiRef.current = a;
          (window as any).__lumen = { api: a, projectId: meta.id, restore: restoreElements }; // test/debug handle
          setApi(a);
        }}
        initialData={{
          elements: initial.elements as any,
          files: initial.files as any,
          appState: {
            theme,
            ...(initial.view ? { scrollX: initial.view.scrollX, scrollY: initial.view.scrollY, zoom: { value: initial.view.zoom } as any } : {}),
          },
          scrollToContent: !initial.view && initial.elements.length > 0,
        }}
        theme={theme}
        autoFocus
        onChange={onChange}
        onPointerUpdate={(p) => {
          const s = syncRef.current;
          if (!s || peerMap.current.size === 0) return;
          const now = performance.now();
          if (now - ((onPointerUpdateLast.t as number) || 0) < 40) return;
          onPointerUpdateLast.t = now;
          s.publish({ t: "pointer", from: s.id, x: p.pointer.x, y: p.pointer.y, tool: p.pointer.tool, name: identity.name, color: identity.color });
        }}
        validateEmbeddable={(link) => link.startsWith(LIVE_HOST) || /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|figma\.com)/.test(link)}
        renderEmbeddable={(el) => (getMeta(el) ? <LiveObject element={el} theme={theme} /> : null)}
        renderTopRightUI={() => (
          <div className="topright" onPointerDown={(e) => e.stopPropagation()}>
            {peers.length > 0 && (
              <div className="presence" title={`${peers.length} other${peers.length > 1 ? "s" : ""} in this board (other tabs)`} data-testid="presence">
                {peers.slice(0, 4).map((p) => (
                  <span key={p.id} style={{ background: p.color }}>
                    {p.name[0]}
                  </span>
                ))}
                <small>{peers.length + 1} here</small>
              </div>
            )}
            {room && (
              <button className={`live-badge ${link}`} onClick={shareLive} title="Live room — click to copy the link" data-testid="live-badge">
                ● Live
              </button>
            )}
            <button className="icon-btn" onClick={openHistory} title="History" aria-label="History" data-testid="open-history">
              ⟲
            </button>
            <button className="icon-btn" onClick={() => setPanel("settings")} title="Intelligence settings" aria-label="Settings" data-testid="open-settings">
              ✦
            </button>
          </div>
        )}
        UIOptions={{ canvasActions: { toggleTheme: true, export: { saveFileToDisk: true }, loadScene: true, saveToActiveFile: false } }}
        aiEnabled={false}
        langCode="en"
        gridModeEnabled={false}
      >
        <MainMenu>
          <MainMenu.Item onSelect={() => setPanel("projects")}>Projects…</MainMenu.Item>
          <MainMenu.Item onSelect={onNew}>New project</MainMenu.Item>
          <MainMenu.Item onSelect={room ? leaveLive : shareLive} data-testid="share-live">
            {room ? "Stop live sharing" : "Share live…"}
          </MainMenu.Item>
          <MainMenu.Item onSelect={openHistory}>Version history</MainMenu.Item>
          <MainMenu.Item onSelect={shareLink} data-testid="share-link">
            Copy share link
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => setPanel("settings")}>Intelligence settings</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>

      <div className="pill" onPointerDown={(e) => e.stopPropagation()}>
        <span className="logo" aria-hidden />
        {renaming ? (
          <input
            autoFocus
            defaultValue={name}
            aria-label="Project name"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={async (e) => {
              const v = e.target.value.trim() || "Untitled";
              setName(v);
              setRenaming(false);
              await renameProject(meta.id, v);
            }}
          />
        ) : (
          <button className="name" onDoubleClick={() => setRenaming(true)} onClick={() => setPanel(panel === "projects" ? null : "projects")} title="Projects (double-click to rename)" data-testid="project-name">
            {name}
            <span className="caret">▾</span>
          </button>
        )}
        {panel === "projects" && (
          <ProjectMenu
            projects={projects.map((p) => (p.id === meta.id ? { ...p, name } : p))}
            currentId={meta.id}
            onOpen={async (id) => (await autosaver.flush(), onOpen(id))}
            onNew={async () => (await autosaver.flush(), onNew())}
            onDelete={onDelete}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {empty && !busy && <Welcome onStarter={starter} onFocus={() => inputRef.current?.focus()} />}

      {busy && sel.rect && <div className="scan" style={{ left: sel.rect.x - 8, top: sel.rect.y - 8, width: sel.rect.w + 16, height: sel.rect.h + 16 }} />}

      <Dock
        rect={sel.rect}
        suggestions={suggestions}
        actions={actions}
        placeholder={placeholder}
        busy={busy}
        engine={engine}
        engineLabel={settings.apiKey || settings.provider === "custom" ? PROVIDERS[settings.provider].short : "Claude"}
        onRun={run}
        onEngineClick={() => setPanel("settings")}
        onCancel={() => abortRef.current?.abort()}
        mobile={mobile}
        inputRef={inputRef}
      />

      {toast && (
        <div className="toast" role="status" data-testid="toast" key={toast.id} style={mobile ? undefined : undefined}>
          <span>{toast.text}</span>
          {toast.note && <small>{toast.note}</small>}
          {toast.undo && (
            <button onClick={undo} data-testid="toast-undo">
              Undo
            </button>
          )}
        </div>
      )}

      {panel === "history" && <HistoryPanel versions={versions} current={api?.getSceneElementsIncludingDeleted() ?? []} onRestore={restore} onSave={async (l) => (await checkpoint(l, "manual"), setVersions(await listVersions(meta.id)), say(`Saved checkpoint “${l}”.`))} onClose={() => setPanel(null)} />}
      {panel === "settings" && <SettingsDialog settings={settings} serverClaude={serverClaude} onSave={(s) => (saveSettings(s), setSettings(s))} onTest={testConnection} onClose={() => setPanel(null)} />}
      {onboard && <Onboarding settings={settings} onSave={(s) => (saveSettings(s), setSettings(s))} onTest={testConnection} onDone={() => (markOnboarded(), setOnboard(false))} />}
      {editing && editingEl && (
        <LiveEditor
          kind={editing.kind}
          title={getMeta(editingEl)?.title ?? ""}
          source={(editing.kind === "app" ? getMeta(editingEl)?.html : getMeta(editingEl)?.markdown) ?? ""}
          onSave={(t, src) => patchLive(editing.id, (m) => ({ ...m, title: t, ...(editing.kind === "app" ? { html: src, state: undefined } : { markdown: src }) }))}
          onClose={() => setEditing(null)}
        />
      )}
      {expanded && expandedEl && <Expanded title={getMeta(expandedEl)?.title ?? "Live object"} html={getMeta(expandedEl)?.html ?? ""} state={(getMeta(expandedEl) as any)?.state} theme={theme} onClose={() => setExpanded(null)} />}
    </div>
  );
}

const onPointerUpdateLast: { t?: number } = {};
void getProjectMeta;
