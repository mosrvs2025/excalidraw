/** Text search over a board's elements (pure) — used for ⌘K "find anywhere", across every world. */
export interface Hit {
  elementId: string;
  text: string;
}

const lm = (e: any) => e.customData?.lumen as { title?: string; kind?: string } | undefined;

/** Everything on an element a person would call "its text". */
export function textOf(e: any): string {
  if (e.isDeleted) return "";
  if (e.type === "text") return String(e.text ?? "");
  const m = lm(e);
  if (m?.title) return String(m.title);
  if (e.type === "frame" || e.type === "magicframe") return String(e.name ?? "");
  return "";
}

export function searchElements(elements: readonly any[], query: string, limit = 20): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: Hit[] = [];
  for (const e of elements) {
    const t = textOf(e).replace(/\s+/g, " ").trim();
    if (t && t.toLowerCase().includes(q)) out.push({ elementId: e.id, text: t.length > 70 ? t.slice(0, 67) + "…" : t });
    if (out.length >= limit) break;
  }
  return out;
}
