import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  convertToExcalidrawElements,
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
import type { ExcalidrawElement, ExcalidrawEmbeddableElement, ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";

import { buildGraph, getMeta, type CanvasGraph } from "./canvas/context";
import { buildNotes, executePlan, insertSkeleton, LIVE_HOST, uid, type ExecResult } from "./canvas/execute";
import { runIntent, engineAvailable, serverHasClaude, type EngineKind } from "./ai/engine";
import { classifyPrompt, suggestFor, type IntentId, type Suggestion } from "./ai/intents";
import { loadSettings, markOnboarded, PROVIDERS, saveSettings, wasOnboarded, type Settings } from "./ai/settings";
import { askProvider } from "./ai/providers";
import { sanitizePlan, type Plan } from "./ai/schema";
import { TEMPLATES } from "./live/templates";
import { LiveObject, frameRegistry } from "./live/LiveObject";
import { composeApp } from "./live/runtime";
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
import { exportJsonCanvas, importJsonCanvas } from "./canvas/jsoncanvas";
import { docFromGraph } from "./ai/local";
import { downloadText, slugify } from "./store/download";
import { ImageEditor } from "./ui/ImageEditor";
import type { FinalImage } from "./image/render";
import { dominantColors } from "./image/palette";
import { exportToCanvas as exportCanvasFrame } from "@excalidraw/excalidraw";
import { Dock } from "./ui/Dock";
import { AgentDialog, CommandPalette, Expanded, HistoryPanel, LiveEditor, Onboarding, ProjectMenu, SettingsDialog, TemplateGallery, Welcome, type Command } from "./ui/Panels";
import { TEMPLATES_LIST } from "./ai/local";

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
  image: ExcalidrawImageElement | null;
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
  const [sel, setSel] = useState<SelState>({ ids: [], rect: null, graph: null, live: null, image: null });
  const [empty, setEmpty] = useState(initial.elements.filter((e) => !e.isDeleted).length === 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; note?: string; undo?: boolean; id: number } | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [engine, setEngine] = useState<EngineKind>("offline");
  const [serverClaude, setServerClaude] = useState(false);
  const [panel, setPanel] = useState<null | "history" | "settings" | "projects">(null);
  const [room, setRoomState] = useState<string | null>(() => roomOf(meta.id));
  const [link, setLink] = useState<"connecting" | "open" | "closed">("closed");
  const [palette, setPalette] = useState(false);
  const [editImg, setEditImg] = useState(false);
  const [agentDlg, setAgentDlg] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [slide, setSlide] = useState<number | null>(null);
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
  const cutoutRef = useRef<() => Promise<string>>(async () => "");
  const agentRef = useRef<(id: string, plan: unknown, sync: SyncAdapter) => Promise<void>>(async () => {});
  const runAgentPlan = (id: string, plan: unknown, sync: SyncAdapter) => agentRef.current(id, plan, sync);


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
  agentRef.current = async (id, raw, sync) => {
    const a = apiRef.current;
    const reply = (ok: boolean, message: string) => sync.publish({ t: "plan-result", from: sync.id, id, ok, message });
    if (!a) return reply(false, "Board not ready");
    try {
      const plan = sanitizePlan(raw);
      if (!plan.ops.length) return reply(false, "The plan had no valid operations.");
      await checkpoint(`Before agent: ${plan.say.slice(0, 40)}`, "ai");
      const graph = buildGraph(a.getSceneElements(), []);
      const s = a.getAppState();
      const c = viewportCoordsToSceneCoords({ clientX: s.offsetLeft + s.width / 2, clientY: s.offsetTop + s.height / 2 }, s);
      const res = await executePlan(a, plan, { graph, anchor: c, anchorMode: "center" });
      const made = a.getSceneElements().filter((e) => res.created.includes(e.id));
      reveal(a, made);
      say(`🤖 ${plan.say || "Agent made a change."}`, { undo: true });
      reply(true, `Created ${res.created.length} element(s)${res.touched.length ? `, changed ${res.touched.length}` : ""}.`);
    } catch (e: any) {
      reply(false, String(e?.message ?? e).slice(0, 200));
    }
  };
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
  const peerMap = useRef(new Map<string, { name: string; color: string; ts: number; agent?: boolean }>());
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
        peerMap.current.set(m.from, { name: m.name, color: m.color, ts: Date.now(), agent: m.agent });
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
      } else if (m.t === "plan") {
        // An agent (MCP) asked for a change. Exactly one open browser applies it: the lowest id among humans.
        const humans = [sync.id, ...[...peerMap.current].filter(([, p]) => !p.agent).map(([id]) => id)].sort();
        if (humans[0] === sync.id) void runAgentPlan(m.id, m.plan, sync);
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
        setSel((s) => (s.ids.length || s.rect ? { ids: [], rect: null, graph: null, live: null, image: null } : s));
        return;
      }
      const selEls = elements.filter((e) => !e.isDeleted && ids.includes(e.id));
      if (!selEls.length) return setSel((s) => (s.ids.length ? { ids: [], rect: null, graph: null, live: null, image: null } : s));
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
        const image = selEls.length === 1 && selEls[0].type === "image" && (selEls[0] as any).fileId ? (selEls[0] as ExcalidrawImageElement) : null;
        return { ids, rect, graph, live, image, key } as SelState;
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation(); // beats Excalidraw's own ⌘K (link) handler
        setPalette((p) => !p);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
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
      if (!intent && classifyPrompt(prompt) === "cutout") {
        const sid = Object.keys(a.getAppState().selectedElementIds);
        if (sid.length === 1 && a.getSceneElements().find((e) => e.id === sid[0])?.type === "image") intent = "cutout";
      }
      if (intent === "cutout") {
        setBusy("Removing background…");
        try {
          await checkpoint("Before: remove background", "ai");
          const msg = await cutoutRef.current();
          say(msg, { undo: msg.startsWith("Background removed") });
        } catch (e: any) {
          say("Couldn't edit that image.", { note: String(e?.message ?? e).slice(0, 120) });
        } finally {
          setBusy(null);
        }
        return;
      }
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
        if (intent === "palette") {
          const img = await (async () => {
            const { loadImage } = await import("./image/render");
            return loadImage(URL.createObjectURL(await selectionBlob()));
          })();
          const c = document.createElement("canvas");
          const k = Math.min(1, 200 / Math.max(img.width, img.height));
          c.width = Math.max(1, Math.round(img.width * k));
          c.height = Math.max(1, Math.round(img.height * k));
          const cx = c.getContext("2d", { willReadFrequently: true })!;
          cx.drawImage(img, 0, 0, c.width, c.height);
          const colors = dominantColors(cx.getImageData(0, 0, c.width, c.height).data, 5);
          plan = colors.length ? { say: `Pulled ${colors.length} colours from the image.`, ops: [{ op: "swatches", colors }], engine: "offline" } : { say: "No colours found in that image.", ops: [], engine: "offline" };
        } else if (intent === "ocr") {
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
        say(plan.say || (res.cleaned ? `Cleaned up ${res.cleaned} shape${res.cleaned > 1 ? "s" : ""}.` : res.created.length || res.touched.length ? "Done." : "Nothing changed."), {
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
    if (sel.image && !liveEl) return [{ id: "editimg", label: "Edit image", icon: "◑", run: () => setEditImg(true) }];
    if (!liveEl || !liveMeta) return [];
    const list: { id: string; label: string; icon: string; run: () => void }[] = [];
    if (liveMeta.kind === "app") list.push({ id: "open", label: "Open", icon: "⤢", run: () => setExpanded({ id: liveEl.id }) });
    list.push({ id: "edit", label: liveMeta.kind === "app" ? "Code" : "Edit", icon: liveMeta.kind === "app" ? "‹›" : "✎", run: () => setEditing({ id: liveEl.id, kind: liveMeta.kind as "app" | "doc" }) });
    if (liveMeta.kind === "app" && (liveMeta as any).state != null) list.push({ id: "reset", label: "Reset", icon: "↺", run: () => patchLive(liveEl.id, (m) => ({ ...m, state: undefined })) });
    list.push({
      id: "download",
      label: "Save",
      icon: "⤓",
      run: () =>
        liveMeta.kind === "app"
          ? downloadText(`${slugify(liveMeta.title || "live-object")}.html`, composeApp(liveMeta.html ?? "", (liveMeta as any).state, theme), "text/html")
          : downloadText(`${slugify(liveMeta.title || "document")}.md`, liveMeta.markdown ?? "", "text/markdown"),
    });
    list.push({ id: "dup", label: "Duplicate", icon: "⧉", run: duplicateLive });
    return list;
  }, [liveEl?.id, liveMeta?.kind, (liveMeta as any)?.state != null, sel.image?.id]);

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
  const connectAgent = async () => {
    if (!settingsRef.current.collabUrl) {
      say("Agents connect through a live room.", { note: "Add your relay address in ✦ settings first (server/relay.mjs)." });
      return setPanel("settings");
    }
    if (!room) {
      const id = newRoomId();
      setRoom(meta.id, id);
      setRoomState(id);
    }
    setAgentDlg(true);
  };
  const leaveLive = () => {
    setRoom(meta.id, null);
    setRoomState(null);
    setLink("closed");
    say("Stopped live sharing. Your copy stays here.");
  };

  /* ───────── present mode: frames are slides ───────── */
  const slides = () => {
    const a = apiRef.current;
    if (!a) return [];
    return a
      .getSceneElements()
      .filter((e) => e.type === "frame" || e.type === "magicframe")
      .sort((p, q) => (Math.abs(p.y - q.y) > 80 ? p.y - q.y : p.x - q.x));
  };
  const showSlide = (i: number) => {
    const a = apiRef.current;
    if (!a) return;
    const fr = slides();
    const target = fr.length ? fr[Math.min(Math.max(i, 0), fr.length - 1)] : null;
    a.scrollToContent((target ?? a.getSceneElements()) as any, { fitToViewport: true, viewportZoomFactor: 0.88, animate: true, duration: 450, maxZoom: 4 });
    setSlide(target ? fr.indexOf(target) : 0);
  };
  const present = () => {
    const a = apiRef.current;
    if (!a || !a.getSceneElements().length) return say("Nothing to present yet.");
    if (!slides().length) say("No frames yet — presenting the whole board.", { note: "Press F and draw a frame around each slide to present step by step." });
    setPanel(null);
    setSlide(0);
    setTimeout(() => showSlide(0), 60);
  };
  useEffect(() => {
    if (slide === null) return;
    const n = Math.max(slides().length, 1);
    const k = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) (e.preventDefault(), slide < n - 1 && showSlide(slide + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) (e.preventDefault(), slide > 0 && showSlide(slide - 1));
      else if (e.key === "Home") showSlide(0);
      else if (e.key === "End") showSlide(n - 1);
      else if (e.key === "Escape") setSlide(null);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide]);

  const applyImage = (r: FinalImage, el: ExcalidrawImageElement | null = sel.image) => {
    const a = apiRef.current;
    if (!a || !el) return;
    const fileId = uid("img");
    a.addFiles([{ id: fileId, mimeType: r.mime as any, dataURL: r.dataURL as any, created: Date.now() } as any]);
    // The pre-trim picture keeps its on-canvas width; a tight crop then shrinks the element so the subject
    // stays exactly where (and as big as) it was, and the box hugs it — easy to grab and move.
    const Wd = el.width;
    const Hd = r.trim ? (Wd * r.trim.preH) / r.trim.preW : (Wd * r.h) / r.w;
    const top = el.y + (el.height - Hd) / 2;
    const t = r.trim ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    a.updateScene({
      elements: a.getSceneElementsIncludingDeleted().map((x) =>
        x.id === el.id ? newElementWith(x, { fileId, x: el.x + Wd * t.x0, y: top + Hd * t.y0, width: Wd * (t.x1 - t.x0), height: Hd * (t.y1 - t.y0), crop: null, status: "saved" } as any) : x,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setEditImg(false);
  };

  cutoutRef.current = () => cutout();
  /** One click: remove the backdrop and crop to the subject. */
  const cutout = async (): Promise<string> => {
    const a = apiRef.current;
    if (!a) return "Select an image first.";
    const ids = Object.keys(a.getAppState().selectedElementIds).filter((k) => a.getAppState().selectedElementIds[k]);
    const el = ids.length === 1 ? (a.getSceneElements().find((e) => e.id === ids[0] && e.type === "image") as ExcalidrawImageElement | undefined) : undefined;
    const f = el && a.getFiles()[el.fileId as string];
    if (!el || !f) return "Select an image first.";
    const { loadImage, renderFinal } = await import("./image/render");
    const { NEUTRAL } = await import("./image/adjust");
    const img = await loadImage(f.dataURL);
    let best = renderFinal(img, { ...NEUTRAL, bgTolerance: 24 }, f.mimeType);
    if (best.removed < 0.03) best = renderFinal(img, { ...NEUTRAL, bgTolerance: 40 }, f.mimeType); // softer backdrops
    if (best.removed < 0.03) return "I couldn't find a plain background to remove.";
    if (best.removed > 0.97) return "The background is too similar to the subject to separate.";
    applyImage(best, el);
    return `Background removed — ${Math.round(best.removed * 100)}% cleared. Drag the subject anywhere.`;
  };

  const exportPdf = async () => {
    const a = apiRef.current;
    if (!a || !a.getSceneElements().length) return say("Nothing to export yet.");
    try {
      say("Building PDF…");
      const frames = slides();
      const common = { elements: a.getSceneElements(), files: a.getFiles(), maxWidthOrHeight: 2000 };
      const appState = { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false } as any;
      const pages = frames.length
        ? await Promise.all(frames.map((f) => exportCanvasFrame({ ...common, appState, exportingFrame: f as any, exportPadding: 0 })))
        : [await exportCanvasFrame({ ...common, appState, exportPadding: 32 })];
      const { jsPDF } = await import("jspdf");
      let pdf: InstanceType<typeof jsPDF> | null = null;
      for (const c of pages) {
        const o = c.width >= c.height ? "landscape" : "portrait";
        if (!pdf) pdf = new jsPDF({ unit: "px", format: [c.width, c.height], orientation: o, hotfixes: ["px_scaling"] });
        else pdf.addPage([c.width, c.height], o);
        pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, c.width, c.height);
      }
      pdf!.save(`${slugify(name)}.pdf`);
      say(`Saved PDF (${pages.length} page${pages.length > 1 ? "s" : ""}).`, { note: frames.length ? "One page per frame." : "Frames become pages — draw some with F." });
    } catch (e: any) {
      say("Couldn't build the PDF.", { note: String(e?.message ?? e).slice(0, 120) });
    }
  };

  /* ───────── export / import ───────── */
  const exportMarkdown = () => {
    const a = apiRef.current!;
    const g = buildGraph(a.getSceneElements(), []);
    downloadText(`${slugify(name)}.md`, docFromGraph(g, name), "text/markdown");
    say("Saved as Markdown.");
  };
  const exportJsonCanvasFile = () => {
    const a = apiRef.current!;
    downloadText(`${slugify(name)}.canvas`, JSON.stringify(exportJsonCanvas(a.getSceneElementsIncludingDeleted()), null, 2), "application/json");
    say("Saved as JSON Canvas.", { note: "Opens in Obsidian and other JSON Canvas tools." });
  };
  const importJsonCanvasFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".canvas,.json,application/json";
    input.onchange = async () => {
      const a = apiRef.current;
      const f = input.files?.[0];
      if (!a || !f) return;
      try {
        const data = JSON.parse(await f.text());
        const sk = importJsonCanvas(data, uid("jc"));
        if (!sk.length) return say("That file has no canvas nodes.");
        await checkpoint(`Before import: ${f.name}`, "ai");
        const { ensureFonts } = await import("./canvas/execute");
        await ensureFonts(JSON.stringify(sk).slice(0, 3000));
        const made = convertToExcalidrawElements(sk as any, { regenerateIds: false });
        const [x1, y1] = getCommonBounds(made);
        const c = sceneCenter(a);
        const cur = a.getSceneElementsIncludingDeleted();
        const shifted = made.map((e) => ({ ...e, x: e.x - x1 + c.x - 300, y: e.y - y1 + c.y - 200 })) as any[];
        a.updateScene({ elements: [...cur, ...shifted], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        select(a, shifted.filter((e) => e.type !== "arrow" && !e.containerId).map((e) => e.id));
        reveal(a, shifted);
        say(`Imported ${f.name}.`, { undo: true });
      } catch {
        say("Couldn't read that file.", { note: "Expected JSON Canvas (.canvas)." });
      }
    };
    input.click();
  };

  const useTemplate = async (id: string) => {
    const a = apiRef.current;
    const t = TEMPLATES_LIST.find((x) => x.id === id);
    if (!a || !t) return;
    await checkpoint(`Before template: ${t.label}`, "ai");
    const res = await executePlan(a, { say: "", ops: [t.build()] }, { graph: buildGraph([], []), anchor: sceneCenter(a), anchorMode: "center" });
    const made = a.getSceneElements().filter((e) => res.created.includes(e.id));
    select(a, made.filter((e) => e.type !== "text" && e.type !== "arrow").map((e) => e.id));
    reveal(a, made);
    say(`${t.label} ready — fill it in.`, { undo: true });
  };

  /* ───────── data files → live table + chart ───────── */
  const addDataFile = async (f: File, at?: { x: number; y: number }) => {
    const a = apiRef.current;
    if (!a) return;
    if (f.size > 5_000_000) return say("That file is too big for the canvas.", { note: "Keep it under 5 MB." });
    try {
      const csv = await f.text();
      const res = await executePlan(a, { say: "", ops: [{ op: "data", title: f.name.replace(/\.[^.]+$/, ""), csv }] }, { graph: buildGraph([], []), anchor: at ?? sceneCenter(a), anchorMode: "center" });
      select(a, res.created);
      const made = a.getSceneElements().filter((e) => res.created.includes(e.id));
      reveal(a, made);
      say(`Added ${f.name} as a live table + chart.`, { note: "Pick columns and chart type on the object; its choices are saved.", undo: true });
    } catch (e: any) {
      say("Couldn't use that file.", { note: String(e?.message ?? e).slice(0, 140) });
    }
  };
  const pickDataFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,.txt,.json,text/csv,application/json";
    input.onchange = () => input.files?.[0] && addDataFile(input.files[0]);
    input.click();
  };
  useEffect(() => {
    const isData = (f?: File) => !!f && /\.(csv|tsv)$/i.test(f.name);
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files") && [...(e.dataTransfer.items ?? [])].some((i) => i.kind === "file" && /csv|tab-separated/.test(i.type))) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!isData(f)) return;
      e.preventDefault();
      e.stopPropagation();
      const a = apiRef.current;
      const at = a ? viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, a.getAppState()) : undefined;
      addDataFile(f!, at);
    };
    window.addEventListener("dragover", over, true);
    window.addEventListener("drop", drop, true);
    return () => {
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("drop", drop, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commands: Command[] = [
    { id: "templates", label: "Templates…", hint: "kanban, SWOT, retro…", keywords: "template board scaffold start", run: () => setGallery(true) },
    { id: "present", label: "Present", hint: "frames → slides", keywords: "slides presentation", run: present },
    { id: "history", label: "Version history", keywords: "restore undo checkpoint", run: openHistory },
    { id: "share", label: "Copy share link", hint: "board in the URL", keywords: "share export link", run: shareLink },
    { id: "live", label: room ? "Stop live sharing" : "Share live…", keywords: "collaborate realtime room", run: room ? leaveLive : shareLive },
    { id: "agent", label: "Connect an AI agent…", hint: "Claude Desktop, Cursor (MCP)", keywords: "mcp agent claude cursor", run: connectAgent },
    { id: "data", label: "Add data (CSV / JSON)…", keywords: "chart table csv", run: pickDataFile },
    { id: "pdf", label: "Export as PDF", hint: "one page per frame", keywords: "print pdf", run: exportPdf },
    { id: "md", label: "Export as Markdown", run: exportMarkdown },
    { id: "jc", label: "Export as JSON Canvas", hint: "Obsidian", run: exportJsonCanvasFile },
    { id: "jci", label: "Import JSON Canvas…", hint: "Obsidian", run: importJsonCanvasFile },
    { id: "new", label: "New project", run: onNew },
    { id: "projects", label: "Switch project…", run: () => setPanel("projects") },
    { id: "settings", label: "AI settings", hint: "keys & providers", keywords: "api key openai gemini claude model", run: () => setPanel("settings") },
    { id: "theme", label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme", keywords: "dark light mode", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { id: "talk", label: "Talk to the canvas", hint: "/", keywords: "prompt ask", run: () => inputRef.current?.focus() },
    ...TEMPLATES_LIST.map((t) => ({ id: `t-${t.id}`, label: `Template: ${t.label}`, hint: t.desc, keywords: "template", run: () => useTemplate(t.id) })),
  ];

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
    <div className={`app ${mobile ? "is-mobile" : ""} ${slide !== null ? "presenting" : ""}`} data-theme={theme}>
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
        viewModeEnabled={slide !== null}
        zenModeEnabled={slide !== null}
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
        renderTopRightUI={() => slide !== null ? null : (
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
          <MainMenu.Item onSelect={() => setGallery(true)} data-testid="templates">
            Templates…
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => setPalette(true)}>Command palette (⌘K)</MainMenu.Item>
          <MainMenu.Item onSelect={connectAgent} data-testid="connect-agent">
            Connect an AI agent…
          </MainMenu.Item>
          <MainMenu.Item onSelect={present} data-testid="present">
            Present
          </MainMenu.Item>
          <MainMenu.Item onSelect={openHistory}>Version history</MainMenu.Item>
          <MainMenu.Item onSelect={shareLink} data-testid="share-link">
            Copy share link
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => setPanel("settings")}>Intelligence settings</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item onSelect={exportPdf} data-testid="export-pdf">
            Export as PDF
          </MainMenu.Item>
          <MainMenu.Item onSelect={exportMarkdown} data-testid="export-md">
            Export as Markdown
          </MainMenu.Item>
          <MainMenu.Item onSelect={exportJsonCanvasFile} data-testid="export-jsoncanvas">
            Export as JSON Canvas
          </MainMenu.Item>
          <MainMenu.Item onSelect={pickDataFile} data-testid="add-data">
            Add data (CSV / JSON)…
          </MainMenu.Item>
          <MainMenu.Item onSelect={importJsonCanvasFile} data-testid="import-jsoncanvas">
            Import JSON Canvas…
          </MainMenu.Item>
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

      {slide === null && <div className="pill" onPointerDown={(e) => e.stopPropagation()}>
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
      </div>}

      {slide !== null && (
        <div className="present-bar" onPointerDown={(e) => e.stopPropagation()} data-testid="present-bar">
          <button onClick={() => slide > 0 && showSlide(slide - 1)} aria-label="Previous slide" disabled={slide === 0}>
            ‹
          </button>
          <span data-testid="slide-counter">
            {slide + 1} / {Math.max(slides().length, 1)}
          </span>
          <button onClick={() => slide < Math.max(slides().length, 1) - 1 && showSlide(slide + 1)} aria-label="Next slide" disabled={slide >= Math.max(slides().length, 1) - 1}>
            ›
          </button>
          <button onClick={() => setSlide(null)} aria-label="Exit presentation" data-testid="exit-present">
            ✕
          </button>
        </div>
      )}

      {empty && slide === null && !busy && <Welcome onStarter={starter} onFocus={() => inputRef.current?.focus()} />}

      {busy && sel.rect && <div className="scan" style={{ left: sel.rect.x - 8, top: sel.rect.y - 8, width: sel.rect.w + 16, height: sel.rect.h + 16 }} />}

      {slide === null && <Dock
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
      />}

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

      {agentDlg && room && <AgentDialog relay={settings.collabUrl} room={room} onClose={() => setAgentDlg(false)} />}
      {editImg && sel.image && (() => {
        const f = apiRef.current?.getFiles()[sel.image.fileId as string];
        return f ? <ImageEditor src={f.dataURL} mime={f.mimeType} onApply={(r) => (applyImage(r, sel.image), say("Image updated.", { undo: true }))} onClose={() => setEditImg(false)} /> : null;
      })()}
      {palette && <CommandPalette commands={commands} onAsk={(t) => run(t)} onClose={() => setPalette(false)} />}
      {gallery && <TemplateGallery templates={TEMPLATES_LIST} onPick={useTemplate} onClose={() => setGallery(false)} />}
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
