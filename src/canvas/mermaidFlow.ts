import type { DiagramEdge, DiagramLayout, DiagramNode } from "../ai/schema";

/**
 * Native parser for Mermaid flowcharts (`graph`/`flowchart`). Flowcharts are the common case and rendering them
 * through Lumen's own diagram engine gives consistent styling, correct text fit and real bound arrows.
 * Anything it can't understand returns null, and the caller falls back to the full Mermaid renderer.
 */
export function parseMermaidFlow(code: string): { layout: DiagramLayout; nodes: DiagramNode[]; edges: DiagramEdge[] } | null {
  const lines = code
    .split(/\r?\n|;/)
    .map((l) => l.replace(/%%.*$/, "").trim())
    .filter(Boolean);
  const head = lines[0]?.match(/^(?:graph|flowchart)\s*(TD|TB|BT|LR|RL)?\s*$/i);
  if (!head) return null;
  const dir = (head[1] || "TD").toUpperCase();
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];

  const clean = (s: string) => s.replace(/^["'`]+|["'`]+$/g, "").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  const closers: Record<string, [string, DiagramNode["shape"]]> = {
    "[[": ["]]", "box"], "[(": [")]", "ellipse"], "((": ["))", "ellipse"], "{{": ["}}", "diamond"], "([": ["])", "pill"],
    "[": ["]", "box"], "(": [")", "pill"], "{": ["}", "diamond"], ">": ["]", "box"],
  };

  /** read a node reference at the start of s → [id, rest] */
  const readNode = (s: string): [string, string] | null => {
    const m = s.match(/^\s*([A-Za-z0-9_À-￿-]+?)(?=$|[\s[({>\-=.<|&])/);
    if (!m) return null;
    const id = m[1];
    let rest = s.slice(m[0].length);
    let label: string | undefined;
    let shape: DiagramNode["shape"];
    const open = (["[[", "[(", "((", "{{", "([", "[", "(", "{", ">"] as const).find((o) => rest.startsWith(o));
    if (open) {
      const [close, sh] = closers[open];
      const end = rest.indexOf(close, open.length);
      if (end < 0) return null;
      label = clean(rest.slice(open.length, end));
      shape = sh;
      rest = rest.slice(end + close.length);
    }
    const prev = nodes.get(id);
    nodes.set(id, { id, label: label ?? prev?.label ?? id, shape: shape ?? prev?.shape });
    return [id, rest];
  };

  for (const line of lines.slice(1)) {
    if (/^(subgraph|end|style|classDef|class|click|linkStyle|direction)\b/i.test(line)) continue;
    let cur = readNode(line);
    if (!cur) return null;
    let [prevId, rest] = cur;
    while (rest.trim()) {
      let label: string | undefined;
      let m = rest.match(/^\s*--\s+([^>|]+?)\s+-->\s*/); // A -- text --> B
      if (m) label = clean(m[1]);
      else {
        m = rest.match(/^\s*(?:<?-{2,}>?|<?={2,}>?|-\.+-?>?|--[ox])\s*(?:\|([^|]*)\|)?\s*/);
        if (!m) return null;
        label = m[1] !== undefined ? clean(m[1]) : undefined;
      }
      const next = readNode(rest.slice(m[0].length));
      if (!next) return null;
      edges.push({ from: prevId, to: next[0], label: label || undefined });
      prevId = next[0];
      rest = next[1];
    }
  }
  if (!nodes.size) return null;
  return { layout: dir === "LR" || dir === "RL" ? "flow-right" : "flow-down", nodes: [...nodes.values()], edges };
}
