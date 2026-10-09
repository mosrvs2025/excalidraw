import { createStore, del, get, keys, set } from "idb-keyval";

/**
 * Persistent projects, entirely local-first (IndexedDB):
 *  - one record per project (elements, files, view)
 *  - an append-only-ish version log per project (named checkpoints + automatic ones)
 * Everything is plain JSON so a cloud/collab backend can replace this module without touching the UI.
 */

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  count: number;
  thumb?: string;
}
export interface ProjectData {
  elements: readonly any[];
  files: Record<string, any>;
  view?: { scrollX: number; scrollY: number; zoom: number };
}
export interface Version {
  id: string;
  ts: number;
  label: string;
  kind: "auto" | "manual" | "ai" | "restore";
  count: number;
  elements: readonly any[];
  thumb?: string;
}

const metaStore = () => createStore("lumen-meta", "kv");
const dataStore = () => createStore("lumen-data", "kv");
const verStore = () => createStore("lumen-versions", "kv");
let stores: ReturnType<typeof makeStores> | null = null;
function makeStores() {
  return { meta: metaStore(), data: dataStore(), ver: verStore() };
}
const S = () => (stores ??= makeStores());

const MAX_VERSIONS = 80;
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function listProjects(): Promise<ProjectMeta[]> {
  const ks = await keys(S().meta);
  const all = (await Promise.all(ks.map((k) => get<ProjectMeta>(k, S().meta)))).filter(Boolean) as ProjectMeta[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(name = "Untitled", data?: ProjectData): Promise<ProjectMeta> {
  const now = Date.now();
  const meta: ProjectMeta = { id: rid(), name, createdAt: now, updatedAt: now, count: data?.elements.length ?? 0 };
  await set(meta.id, meta, S().meta);
  await set(meta.id, data ?? { elements: [], files: {} }, S().data);
  return meta;
}

export const getMeta = (id: string) => get<ProjectMeta>(id, S().meta);
export const loadProject = (id: string) => get<ProjectData>(id, S().data);

export async function saveProject(id: string, data: ProjectData, thumb?: string) {
  const meta = await getMeta(id);
  if (!meta) return;
  await set(id, data, S().data);
  await set(
    id,
    { ...meta, updatedAt: Date.now(), count: data.elements.filter((e) => !e.isDeleted).length, ...(thumb ? { thumb } : {}) },
    S().meta,
  );
}

export async function renameProject(id: string, name: string) {
  const meta = await getMeta(id);
  if (meta) await set(id, { ...meta, name: name.trim() || "Untitled" }, S().meta);
}

export async function deleteProject(id: string) {
  await del(id, S().meta);
  await del(id, S().data);
  await del(id, S().ver);
}

/* ───────── versions ───────── */

export async function listVersions(projectId: string): Promise<Version[]> {
  return ((await get<Version[]>(projectId, S().ver)) ?? []).sort((a, b) => b.ts - a.ts);
}

export function sceneSignature(elements: readonly any[]) {
  let h = 0;
  for (const e of elements) h = (h * 31 + (e.versionNonce ?? 0) + (e.isDeleted ? 7 : 0)) | 0;
  return `${elements.length}:${h}`;
}

export async function addVersion(
  projectId: string,
  label: string,
  kind: Version["kind"],
  elements: readonly any[],
  thumb?: string,
): Promise<Version | null> {
  const list = await listVersions(projectId);
  const live = elements.filter((e) => !e.isDeleted);
  // skip no-op checkpoints (identical to the newest one)
  if (list[0] && sceneSignature(list[0].elements) === sceneSignature(elements) && kind === "auto") return null;
  const v: Version = { id: rid(), ts: Date.now(), label, kind, count: live.length, elements: structuredCloneSafe(elements), thumb };
  let next = [v, ...list];
  if (next.length > MAX_VERSIONS) {
    // drop oldest automatic checkpoints first, never manual ones
    const drop = next.length - MAX_VERSIONS;
    const autos = next.filter((x) => x.kind === "auto").slice(-drop).map((x) => x.id);
    next = next.filter((x) => !autos.includes(x.id));
    next = next.slice(0, MAX_VERSIONS);
  }
  await set(projectId, next, S().ver);
  return v;
}

export async function deleteVersion(projectId: string, id: string) {
  const list = await listVersions(projectId);
  await set(projectId, list.filter((v) => v.id !== id), S().ver);
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** What changed between two snapshots, in human terms. */
export function diffScenes(prev: readonly any[] | undefined, next: readonly any[]) {
  const a = new Map((prev ?? []).filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const b = new Map(next.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, e] of b) {
    const o = a.get(id);
    if (!o) added++;
    else if (o.versionNonce !== e.versionNonce) changed++;
  }
  for (const id of a.keys()) if (!b.has(id)) removed++;
  return { added, removed, changed };
}

export function relativeTime(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Debounced autosave with an explicit flush for tab close. */
export class Autosaver {
  private t: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => Promise<void>) | null = null;
  constructor(private delay = 500) {}
  schedule(fn: () => Promise<void>) {
    this.pending = fn;
    if (this.t) clearTimeout(this.t);
    this.t = setTimeout(() => void this.flush(), this.delay);
  }
  async flush() {
    if (this.t) clearTimeout(this.t);
    this.t = null;
    const p = this.pending;
    this.pending = null;
    if (p) await p();
  }
}
