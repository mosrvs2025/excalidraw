/**
 * A board plus the worlds inside it, as plain data — so share links, backups and imports can carry portals
 * that still open. Portals refer to their world by project id; ids are local to a device, so a bundle keys
 * worlds by the *old* id and the importer rewrites every portal to the freshly created project.
 */
export interface BundledWorld {
  ref: string; // the id this world had where it was made
  parentRef: string | null; // null = hangs off the board being shared
  portalId?: string;
  name: string;
  elements: any[];
  files?: Record<string, any>;
}
export interface Bundle {
  name: string;
  elements: any[];
  files?: Record<string, any>;
  worlds: BundledWorld[];
}

const portalChild = (e: any): string | undefined => (e?.customData?.lumen?.kind === "portal" && !e.isDeleted ? e.customData.lumen.childId : undefined);

/** Walk portals breadth-first, pulling in every world that exists on this device (cycle- and size-safe). */
export async function collectWorlds(
  rootElements: readonly any[],
  load: (id: string) => Promise<{ name: string; elements: any[]; files?: Record<string, any> } | null>,
  opts: { files?: boolean; max?: number } = {},
): Promise<BundledWorld[]> {
  const out: BundledWorld[] = [];
  const seen = new Set<string>();
  const queue: { els: readonly any[]; parent: string | null }[] = [{ els: rootElements, parent: null }];
  while (queue.length && out.length < (opts.max ?? 60)) {
    const { els, parent } = queue.shift()!;
    for (const e of els) {
      const id = portalChild(e);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const p = await load(id);
      if (!p) continue;
      const live = p.elements.filter((x) => !x.isDeleted);
      out.push({ ref: id, parentRef: parent, portalId: e.id, name: p.name, elements: live, ...(opts.files ? { files: p.files ?? {} } : {}) });
      queue.push({ els: live, parent: id });
    }
  }
  return out;
}

export interface BundleIO {
  create: (name: string, data: { elements: any[]; files: Record<string, any> }, rel?: { parentId: string; portalId?: string }) => Promise<{ id: string }>;
  save: (id: string, data: { elements: any[]; files: Record<string, any> }) => Promise<void>;
}

/** Create the board and its worlds; returns the new root id. Portals are re-pointed at the new projects. */
export async function importBundle(b: Bundle, io: BundleIO): Promise<string> {
  const root = await io.create(b.name, { elements: b.elements, files: b.files ?? {} });
  const idOf = new Map<string, string>();
  const made: { id: string; elements: any[]; files: Record<string, any> }[] = [{ id: root.id, elements: b.elements, files: b.files ?? {} }];
  const pending = [...b.worlds];
  // parents first (collectWorlds is breadth-first, but be tolerant of any order)
  for (let guard = 0; pending.length && guard < 1000; guard++) {
    const w = pending.shift()!;
    const parent = w.parentRef === null ? root.id : idOf.get(w.parentRef);
    if (!parent) {
      pending.push(w);
      continue;
    }
    const files = w.files ?? {};
    const p = await io.create(w.name, { elements: w.elements, files }, { parentId: parent, portalId: w.portalId });
    idOf.set(w.ref, p.id);
    made.push({ id: p.id, elements: w.elements, files });
  }
  for (const m of made) {
    let changed = false;
    const els = m.elements.map((e) => {
      const old = portalChild(e);
      if (!old) return e;
      const nid = idOf.get(old);
      if (!nid) return e; // that world wasn't included: the portal will say "not on this device"
      changed = true;
      return { ...e, customData: { ...e.customData, lumen: { ...e.customData.lumen, childId: nid } } };
    });
    if (changed) await io.save(m.id, { elements: els, files: m.files });
  }
  return root.id;
}
