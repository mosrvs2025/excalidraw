// Pure helpers for the agent bridge: merge scene messages and describe the board in words an agent can use.

/** Keep the higher version of each element (same rule Excalidraw uses to reconcile). */
export function mergeElements(map, incoming) {
  for (const e of incoming) {
    const cur = map.get(e.id);
    if (!cur || e.version > cur.version || (e.version === cur.version && e.versionNonce < cur.versionNonce)) map.set(e.id, e);
  }
}

export function summarizeBoard(map) {
  const live = [...map.values()].filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const textOf = (e) => {
    const t = e.boundElements?.find((b) => b.type === "text");
    const te = t && byId.get(t.id);
    return te ? (te.originalText ?? te.text) : "";
  };
  const items = [];
  for (const e of live) {
    if (e.type === "arrow" || e.type === "line") continue;
    if (e.type === "text" && e.containerId) continue; // bound text belongs to its container (even if that was deleted)
    const meta = e.customData?.lumen;
    let kind = e.type;
    let text = "";
    if (["rectangle", "ellipse", "diamond"].includes(e.type)) {
      text = textOf(e);
      kind = meta?.kind === "lane" ? "lane" : meta?.kind === "note" || meta?.kind === "answer" ? "note" : e.type === "diamond" ? "decision" : "shape";
      if (kind === "lane" && !text) continue;
    } else if (e.type === "text") (kind = "text"), (text = e.originalText ?? e.text);
    else if (e.type === "embeddable" && meta) (kind = meta.kind === "doc" ? "document" : meta.kind === "portal" ? "world" : "live-app"), (text = meta.title ?? "");
    else if (e.type === "frame") (kind = "frame"), (text = e.name ?? "");
    items.push({ id: e.id, kind, text: text.replace(/\s*\n\s*/g, " ").slice(0, 300), x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height) });
  }
  items.sort((a, b) => (Math.abs(a.y - b.y) < 24 ? a.x - b.x : a.y - b.y));
  const edges = live
    .filter((e) => e.type === "arrow" && e.startBinding?.elementId && e.endBinding?.elementId)
    .map((e) => ({ from: e.startBinding.elementId, to: e.endBinding.elementId, label: textOf(e) || undefined }));
  return { count: items.length, items, connections: edges };
}

export function boardToText(s) {
  if (!s.count) return "The board is empty.";
  const label = new Map(s.items.map((i) => [i.id, i.text || i.kind]));
  const lines = [`Board: ${s.count} objects, ${s.connections.length} connections.`, "", "Objects (id | kind | text | x,y wxh):"];
  for (const i of s.items) lines.push(`- ${i.id} | ${i.kind} | ${i.text || "—"} | ${i.x},${i.y} ${i.w}x${i.h}`);
  if (s.connections.length) {
    lines.push("", "Connections:");
    for (const c of s.connections) lines.push(`- ${label.get(c.from) ?? c.from} → ${label.get(c.to) ?? c.to}${c.label ? ` [${c.label}]` : ""}`);
  }
  return lines.join("\n");
}
