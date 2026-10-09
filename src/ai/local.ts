/**
 * The offline engine.
 *
 * No network, no model, no key — and it still does real work: it understands
 * outlines and arrow-syntax, clusters by meaning-ish (lexical + spatial) similarity,
 * lints diagrams, builds runnable prototypes from what you drew, and scaffolds
 * well-known boards. It cannot invent knowledge; Claude can. Same Plan contract.
 */
import {
  graphOutline,
  parseOutline,
  reviewGraph,
  type CanvasGraph,
  type CanvasItem,
  type OutlineItem,
} from "../canvas/context";
import { checklist, flowRunner, pickTemplate, TEMPLATES } from "../live/templates";
import { classifyPrompt, MERMAID_RE, mermaidIn, type IntentId } from "./intents";
import { looksTabular } from "../data/parse";
import type { DiagramEdge, DiagramNode, Op, Plan } from "./schema";

export interface IntentRequest {
  prompt: string;
  intent?: IntentId;
  graph: CanvasGraph;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ───────────── text → structure ───────────── */

/** "A -> B -> C" / "A → B, C" style lines into a graph. */
export function parseArrows(text: string): { nodes: DiagramNode[]; edges: DiagramEdge[] } | null {
  const lines = text.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
  const arrow = /\s*(?:-+>|=+>|→|⟶|>>)\s*/;
  if (!lines.some((l) => arrow.test(l))) return null;
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const node = (raw: string): DiagramNode => {
    let label = clean(raw);
    let shape: DiagramNode["shape"];
    if (/\?$/.test(label)) shape = "diamond";
    const key = label.toLowerCase();
    if (!nodes.has(key)) nodes.set(key, { id: `a${nodes.size + 1}`, label: cap(label), shape });
    return nodes.get(key)!;
  };
  for (const line of lines) {
    // support "A -[label]-> B"
    const parts = line.split(/\s*(?:-+>|=+>|→|⟶|>>)\s*/).filter(Boolean);
    if (parts.length < 2) continue;
    let prev: DiagramNode | null = null;
    for (const part of parts) {
      // "B: yes" label suffix on edge target → "label | target"
      const m = part.match(/^\(([^)]{1,20})\)\s*(.+)$/);
      const label = m ? m[1] : undefined;
      const n = node(m ? m[2] : part.split(/,\s*/)[0]);
      if (prev) edges.push({ from: prev.id, to: n.id, label });
      // comma → fan-out siblings
      const rest = part.split(/,\s*/).slice(1);
      for (const r of rest) if (prev) edges.push({ from: prev.id, to: node(r).id });
      prev = n;
    }
  }
  return nodes.size ? { nodes: [...nodes.values()], edges } : null;
}

const BRANCH = /^(yes|no|y|n|true|false|if [^:]{1,24}|else|otherwise|success|fail(?:ure)?|ok|error)\s*[:\-–—]\s*(.+)$/i;

/** Outline → flow. Flat list = sequence. Indented list = tree (decisions branch). */
export function outlineToDiagram(
  items: OutlineItem[],
  title?: string,
): Extract<Op, { op: "diagram" }> | null {
  items = items.filter((i) => i.text);
  if (items.length < 2) return null;
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const hierarchical = items.some((i) => i.depth > 0);
  const stack: { id: string; depth: number }[] = [];
  let prevId: string | null = null;
  items.forEach((it, i) => {
    const id = `s${i + 1}`;
    let label = cap(clean(it.text));
    let edgeLabel: string | undefined;
    const parent = hierarchical ? [...stack].reverse().find((s) => s.depth < it.depth) : null;
    const parentIsDecision = parent && nodes.find((n) => n.id === parent.id)?.shape === "diamond";
    const bm = label.match(BRANCH);
    if (bm && (parentIsDecision || hierarchical)) {
      edgeLabel = cap(bm[1]);
      label = cap(bm[2]);
    }
    nodes.push({ id, label, shape: /\?$/.test(label) ? "diamond" : undefined });
    if (hierarchical) {
      while (stack.length && stack[stack.length - 1].depth >= it.depth) stack.pop();
      if (parent) edges.push({ from: parent.id, to: id, label: edgeLabel });
      stack.push({ id, depth: it.depth });
    } else {
      if (prevId) edges.push({ from: prevId, to: id });
      prevId = id;
    }
  });
  // sequential flow with a decision: label its single exit "Yes" so the gap ("No"?) is visible to review
  if (!hierarchical)
    nodes.forEach((n) => {
      if (n.shape === "diamond") {
        const out = edges.filter((e) => e.from === n.id);
        if (out.length === 1 && !out[0].label) out[0].label = "Yes";
      }
    });
  return {
    op: "diagram",
    layout: hierarchical ? "tree-right" : items.length > 6 ? "flow-right" : "flow-down",
    title,
    nodes,
    edges,
  };
}

/** Outline → mind map (single root becomes centre, otherwise a synthetic one). */
export function outlineToMindmap(items: OutlineItem[], topic?: string): Extract<Op, { op: "diagram" }> | null {
  items = items.filter((i) => i.text);
  if (!items.length) return null;
  const roots = items.filter((i) => i.depth === 0);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  let rootId: string;
  let list = items;
  if (roots.length === 1 && items.length > 1) {
    rootId = "r0";
    nodes.push({ id: rootId, label: cap(roots[0].text) });
    list = items.slice(1).map((i) => ({ ...i, depth: Math.max(0, i.depth - 1) }));
  } else {
    rootId = "r0";
    nodes.push({ id: rootId, label: cap(topic || "Ideas") });
  }
  const stack: { id: string; depth: number }[] = [{ id: rootId, depth: -1 }];
  list.forEach((it, i) => {
    const id = `m${i + 1}`;
    nodes.push({ id, label: cap(clean(it.text)) });
    while (stack.length > 1 && stack[stack.length - 1].depth >= it.depth) stack.pop();
    edges.push({ from: stack[stack.length - 1].id, to: id });
    stack.push({ id, depth: it.depth });
  });
  return { op: "diagram", layout: "mindmap", nodes, edges };
}

/* ───────────── clustering ───────────── */

const STOP = new Set(
  "a an the and or but of to in on for with at by from as is are was were be been it its this that these those we you they i our your their not no yes can will should would could do does did have has had so if then than more most less very just about into over under out up down add make get use new need want also".split(" "),
);
const stem = (w: string) =>
  w.length > 4 ? w.replace(/(ing|ed|es|s|ly)$/, "") : w.length > 3 ? w.replace(/s$/, "") : w;
const tokens = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

/**
 * A small built-in "sense of topic": common product/work vocab grouped by theme, so related notes
 * cluster even when they share no literal words (“discount” ~ “pricing”). Claude does this properly;
 * this keeps the offline engine honest-but-useful.
 */
const TOPICS: Record<string, string> = {
  Pricing: "pric tier discount cost billing invoice subscript pay paid payment checkout revenue monetiz annual monthly trial coupon",
  Onboarding: "onboard welcome tutorial walkthrough signup sign register activation setup getting started checklist tour intro",
  Mobile: "mobile ios android offline push notification tablet phone responsive",
  "Bugs & fixes": "bug fix crash error broken timeout issue regression fail glitch leak slow performance latency",
  Growth: "referral growth marketing campaign seo ads acquisition viral invite reward launch social newsletter audience",
  Design: "design ui ux layout color font icon logo brand style mockup wireframe visual theme animation",
  Research: "research interview survey feedback insight persona study analytics metric hypothesis",
  Team: "team hire hiring meeting standup retro process culture role manager budget roadmap deadline schedule owner",
  Security: "security auth login password permission privacy encrypt compliance gdpr audit token access",
  Content: "blog post article video doc documentation copy write content podcast webinar story",
  Infrastructure: "server database api backend deploy cloud scale infra cache queue ci pipeline monitor",
};
const TOPIC_STEMS = Object.entries(TOPICS).map(([label, words]) => [label, new Set(words.split(" ").map(stem))] as const);
/** Best-matching topic(s) only: a note belongs to the theme it says the most about. */
const topicsOf = (toks: string[], raw: string) => {
  const lower = raw.toLowerCase();
  const scored: [string, number][] = [];
  for (const [label, set] of TOPIC_STEMS) {
    const hits = new Set<string>();
    for (const t of toks) if (set.has(t)) hits.add(t);
    for (const w of set) if (w.length > 4 && lower.includes(w)) hits.add(w);
    if (hits.size) scored.push([label, hits.size]);
  }
  const best = Math.max(0, ...scored.map((s) => s[1]));
  return scored.filter((s) => s[1] === best).map(([l]) => `topic:${l}`);
};

export function clusterItems(items: CanvasItem[], k?: number) {
  const n = items.length;
  const docs = items.map((i) => {
    const t = tokens(i.text);
    const tp = topicsOf(t, i.text);
    return [...t, ...tp, ...tp]; // topic tokens count double
  });
  const df = new Map<string, number>();
  docs.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1)));
  const vec = docs.map((d) => {
    const v = new Map<string, number>();
    d.forEach((t) => v.set(t, (v.get(t) ?? 0) + Math.log(1 + n / (df.get(t) ?? 1))));
    return v;
  });
  const norm = vec.map((v) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1);
  const cos = (a: number, b: number) => {
    let dot = 0;
    for (const [t, w] of vec[a]) dot += w * (vec[b].get(t) ?? 0);
    return dot / (norm[a] * norm[b]);
  };
  const cx = items.map((i) => i.x + i.w / 2);
  const cy = items.map((i) => i.y + i.h / 2);
  // if the words barely overlap, lean on how the human placed things; otherwise trust the words
  let pairs = 0;
  let overlapping = 0;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      pairs++;
      if (cos(a, b) > 0.02) overlapping++;
    }
  const wSpatial = pairs && overlapping / pairs < 0.12 ? 0.6 : 0.12;
  const sim = (a: number, b: number) => {
    const d = Math.hypot(cx[a] - cx[b], cy[a] - cy[b]);
    return (1 - wSpatial) * cos(a, b) + wSpatial * Math.exp(-d / 450);
  };

  let clusters: number[][] = items.map((_, i) => [i]);
  const MIN_SIM = 0.2;
  const target = k ?? 2;
  const cap6 = k ?? 6;
  const avg = (A: number[], B: number[]) => {
    let s = 0;
    for (const a of A) for (const b of B) s += sim(a, b);
    return s / (A.length * B.length);
  };
  while (clusters.length > target) {
    let best = -1;
    let bi = 0;
    let bj = 1;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const s = avg(clusters[i], clusters[j]);
        if (s > best) (best = s), (bi = i), (bj = j);
      }
    // stop once what's left is genuinely dissimilar (unless we still have too many groups)
    if (k === undefined && best < MIN_SIM && clusters.length <= cap6) break;
    clusters[bi] = [...clusters[bi], ...clusters[bj]];
    clusters.splice(bj, 1);
  }
  // a pile of one-offs is one group, not five
  if (k === undefined) {
    const singles = clusters.filter((c) => c.length === 1);
    if (singles.length >= 2 && clusters.length - singles.length >= 1) {
      clusters = [...clusters.filter((c) => c.length > 1), singles.flat()];
    }
  }
  // titles from distinctive terms
  return clusters
    .map((idx) => {
      const score = new Map<string, number>();
      idx.forEach((i) => vec[i].forEach((w, t) => score.set(t, (score.get(t) ?? 0) + w)));
      const inCluster = (t: string) => idx.filter((i) => vec[i].has(t)).length;
      const ranked = [...score.entries()]
        .filter(([t]) => inCluster(t) >= Math.min(2, idx.length))
        .sort((a, b) => b[1] - a[1]);
      const topic = ranked.find(([t]) => t.startsWith("topic:") && inCluster(t) >= Math.ceil(idx.length / 2));
      if (topic) return { idx, title: topic[0].slice(6) };
      const top = ranked.filter(([t]) => !t.startsWith("topic:")).slice(0, 2).map(([t]) => t);
      // prefer the original surface form of the term
      const surface = (t: string) => {
        for (const i of idx) {
          const w = items[i].text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.find((x) => stem(x) === t);
          if (w) return w;
        }
        return t;
      };
      return { idx, title: top.length ? cap(top.map(surface).join(" & ")) : "" };
    })
    .sort((a, b) => cx[a.idx[0]] - cx[b.idx[0]]);
}

/* ───────────── document + explanation ───────────── */

function flowOrder(g: CanvasGraph): CanvasItem[] {
  const nodes = g.items.filter((i) => ["shape", "note"].includes(i.kind) && i.text);
  const hasIn = new Set(g.edges.map((e) => e.to));
  const out = new Map<string, string[]>();
  g.edges.forEach((e) => out.set(e.from, [...(out.get(e.from) ?? []), e.to]));
  const seen = new Set<string>();
  const order: CanvasItem[] = [];
  const visit = (a: string) => {
    if (seen.has(a)) return;
    seen.add(a);
    const n = nodes.find((x) => x.alias === a);
    if (n) order.push(n);
    (out.get(a) ?? []).forEach(visit);
  };
  nodes.filter((n) => !hasIn.has(n.alias)).forEach((n) => visit(n.alias));
  nodes.forEach((n) => visit(n.alias));
  return order;
}

export function docFromGraph(g: CanvasGraph, title: string): string {
  const lines: string[] = [`# ${title}`, ""];
  if (g.edges.length) {
    const order = flowOrder(g);
    const label = (a: string) => g.items.find((i) => i.alias === a)?.text.replace(/\s*\n\s*/g, " ") ?? a;
    lines.push(`This process has **${order.length} steps**.`, "");
    order.forEach((n, i) => {
      const outs = g.edges.filter((e) => e.from === n.alias);
      lines.push(`${i + 1}. **${clean(n.text)}**`);
      if (n.shape === "diamond" && outs.length)
        outs.forEach((e) => lines.push(`   - ${e.label ? `${e.label}:` : "→"} ${label(e.to)}`));
      else if (outs.length === 1) lines.push(`   - then ${label(outs[0].to)}`);
      else if (outs.length > 1) outs.forEach((e) => lines.push(`   - ${label(e.to)}`));
    });
    const issues = reviewGraph(g);
    if (issues.length) {
      lines.push("", "## Open questions");
      issues.forEach((s) => lines.push(`- ${g.items.find((i) => i.alias === s.alias)?.text}: ${s.text}`));
    }
  } else {
    const outline = graphOutline(g);
    if (outline.some((o) => o.depth > 0)) {
      outline.forEach((o) => lines.push(o.depth === 0 ? `\n## ${cap(o.text)}` : `${"  ".repeat(o.depth - 1)}- ${o.text}`));
    } else {
      const cl = outline.length >= 6 ? clusterItems(g.items.filter((i) => i.text)) : null;
      if (cl && cl.some((c) => c.title))
        cl.forEach((c) => {
          lines.push(`\n## ${c.title || "Other"}`);
          c.idx.forEach((i) => lines.push(`- ${clean(g.items.filter((x) => x.text)[i].text)}`));
        });
      else outline.forEach((o) => lines.push(`- ${cap(o.text)}`));
    }
  }
  return lines.join("\n");
}

function explain(g: CanvasGraph): string {
  const texts = g.items.filter((i) => i.text);
  const parts: string[] = [];
  const by = (k: string) => g.items.filter((i) => i.kind === k).length;
  if (g.edges.length) {
    const nodes = g.items.filter((i) => ["shape", "note"].includes(i.kind) && i.text);
    const dec = nodes.filter((n) => n.shape === "diamond").length;
    const order = flowOrder(g);
    const hasIn = new Set(g.edges.map((e) => e.to));
    const hasOut = new Set(g.edges.map((e) => e.from));
    const starts = nodes.filter((n) => !hasIn.has(n.alias));
    const ends = nodes.filter((n) => !hasOut.has(n.alias));
    parts.push(
      `A flow of ${nodes.length} steps${dec ? ` with ${dec} decision${dec > 1 ? "s" : ""}` : ""}.`,
      starts.length ? `It starts at “${clean(starts[0].text)}”${starts.length > 1 ? ` (and ${starts.length - 1} other entry point${starts.length > 2 ? "s" : ""})` : ""}.` : "It has no clear starting point.",
      ends.length ? `It ends at ${ends.slice(0, 3).map((e) => `“${clean(e.text)}”`).join(", ")}.` : "It never ends — everything leads somewhere.",
    );
    void order;
    const issues = reviewGraph(g);
    parts.push(issues.length ? `${issues.length} thing${issues.length > 1 ? "s" : ""} worth a look — try “Find gaps”.` : "No structural problems found.");
  } else if (texts.length) {
    const freq = new Map<string, number>();
    texts.forEach((t) => tokens(t.text).forEach((w) => freq.set(w, (freq.get(w) ?? 0) + 1)));
    const top = [...freq.entries()].filter(([, c]) => c > 1 || texts.length < 4).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
    parts.push(
      `${texts.length} piece${texts.length > 1 ? "s" : ""} of text${by("note") ? ` (${by("note")} notes)` : ""}.`,
      top.length ? `Recurring themes: ${top.join(", ")}.` : "",
      texts.length >= 3 ? "You could cluster them, or arrange them into a flow." : "",
    );
  } else {
    parts.push(
      `${g.items.length} object${g.items.length > 1 ? "s" : ""}: ${[by("sketch") && `${by("sketch")} freehand sketch${by("sketch") > 1 ? "es" : ""}`, by("image") && `${by("image")} image${by("image") > 1 ? "s" : ""}`, by("shape") && `${by("shape")} shape${by("shape") > 1 ? "s" : ""}`].filter(Boolean).join(", ") || "mixed"}.`,
      "Offline mode can't see freehand drawings — add labels, or connect Claude to have it interpreted.",
    );
  }
  return parts.filter(Boolean).join(" ");
}

/* ───────────── scaffolds ───────────── */

type Board = Extract<Op, { op: "board" }>;
type Diagram = Extract<Op, { op: "diagram" }>;
const cols = (title: string, defs: [string, string?][]): Board => ({
  op: "board",
  title,
  columns: defs.map(([t, color]) => ({ title: t, items: [], color: color as any })),
});

export interface Template {
  id: string;
  label: string;
  desc: string;
  icon: string;
  match: RegExp;
  build: () => Board | Diagram;
}
/** Scaffolds you can ask for by name or pick from the gallery — structure only, you bring the content. */
export const TEMPLATES_LIST: Template[] = [
  { id: "kanban", label: "Kanban", desc: "To do · Doing · Done", icon: "▥", match: /kanban|sprint board|task board/, build: () => ({ ...cols("Kanban", [["To do"], ["Doing"], ["Done"]]), columns: [{ title: "To do", items: ["First task"] }, { title: "Doing", items: [] }, { title: "Done", items: [] }] }) },
  { id: "swot", label: "SWOT", desc: "Strengths, weaknesses, opportunities, threats", icon: "✚", match: /swot/, build: () => cols("SWOT analysis", [["Strengths", "green"], ["Weaknesses", "red"], ["Opportunities", "blue"], ["Threats", "orange"]]) },
  { id: "retro", label: "Retrospective", desc: "Went well · To improve · Actions", icon: "↺", match: /retro(spective)?|post-?mortem/, build: () => cols("Retrospective", [["Went well", "green"], ["To improve", "orange"], ["Actions", "purple"]]) },
  { id: "proscons", label: "Pros & cons", desc: "Weigh a decision", icon: "⚖", match: /pros? (and|&|\/|vs) cons?|pros-?cons/, build: () => cols("Pros & cons", [["Pros", "green"], ["Cons", "red"]]) },
  { id: "eisenhower", label: "Priority matrix", desc: "Do · Schedule · Delegate · Drop", icon: "◫", match: /eisenhower|priority matrix|urgent.{0,10}important/, build: () => cols("Priority matrix", [["Do first (urgent + important)", "red"], ["Schedule (important)", "blue"], ["Delegate (urgent)", "orange"], ["Drop (neither)", "gray"]]) },
  { id: "meeting", label: "Meeting notes", desc: "Agenda · Notes · Decisions · Actions", icon: "✎", match: /meeting( notes)?|standup|agenda/, build: () => cols("Meeting", [["Agenda", "blue"], ["Notes", "yellow"], ["Decisions", "green"], ["Action items", "purple"]]) },
  { id: "week", label: "Weekly planner", desc: "Monday to Friday", icon: "▦", match: /week(ly)? (plan|planner|schedule)|weekly/, build: () => cols("This week", [["Mon", "blue"], ["Tue", "green"], ["Wed", "yellow"], ["Thu", "orange"], ["Fri", "pink"]]) },
  { id: "ssc", label: "Start · Stop · Continue", desc: "Team feedback", icon: "⇅", match: /(4|four) ?(w|questions)|start ?stop ?continue/, build: () => cols("Start · Stop · Continue", [["Start", "green"], ["Stop", "red"], ["Continue", "blue"]]) },
  {
    id: "journey", label: "User journey", desc: "Discover → Retain", icon: "⇢", match: /user journey|customer journey|funnel/,
    build: () => ({ op: "diagram", layout: "flow-right", title: "User journey", nodes: ["Discover", "Evaluate", "Sign up", "Onboard", "First value", "Retain"].map((l, i) => ({ id: `j${i}`, label: l })), edges: [0, 1, 2, 3, 4].map((i) => ({ from: `j${i}`, to: `j${i + 1}` })) }),
  },
];

/* ───────────── planner ───────────── */

const NEEDS_MODEL =
  "I can restructure what's on the canvas, cluster, review, and build prototypes from it — offline. Inventing new content needs Claude: add a key in Settings (⚙) to unlock it.";

function topicOf(prompt: string): string | undefined {
  const m = prompt.match(/(?:about|of|on|for|:)\s+(.{2,60})$/i);
  return m ? cap(clean(m[1].replace(/[.!?]+$/, ""))) : undefined;
}

export function planOffline(req: IntentRequest): Plan {
  const { graph, prompt } = req;
  const g = graph;
  const q = prompt.trim();
  const sel = g.scope === "selection";
  const outline = graphOutline(g);
  const textBlob = [q, ...g.items.map((i) => i.text)].join("\n");

  // 0a. a dataset typed here, or sitting on the canvas
  if (!req.intent && looksTabular(q)) return { say: "Made an interactive chart + table from your data.", ops: [{ op: "data", title: "Data", csv: q }], engine: "offline" };
  if (req.intent === "data" || (!req.intent && classifyPrompt(q) === "data")) {
    const t = g.items.find((i) => i.kind === "text" && looksTabular(i.text));
    if (t) return { say: "Made an interactive chart + table from your data.", ops: [{ op: "data", title: "Data", csv: t.text }], engine: "offline" };
    return { say: "Paste or drop a CSV / JSON file, or select text that looks like a table.", ops: [], engine: "offline" };
  }

  // 0. Mermaid code, typed here or sitting on the canvas
  if (MERMAID_RE.test(q)) return { say: "Drew your Mermaid diagram.", ops: [{ op: "mermaid", code: q }], engine: "offline" };
  if (req.intent === "mermaid") {
    const code = mermaidIn(g);
    if (code) return { say: "Drew your Mermaid diagram.", ops: [{ op: "mermaid", code }], engine: "offline" };
  }
  if (req.intent === "refine") return { say: "", ops: [{ op: "refine" }], engine: "offline" };
  if (req.intent === "ocr") return { say: "Select an image or sketch first.", ops: [], engine: "offline" };

  // 1. known scaffolds win when explicitly requested by name
  for (const t of TEMPLATES_LIST) {
    if (!req.intent && q.split(/\s+/).length <= 6 && t.match.test(q.toLowerCase())) return { say: `Set up a ${t.label} board.`, ops: [t.build()], engine: "offline" };
  }

  const promptArrows = req.intent ? null : parseArrows(q);
  let intent: IntentId | null = req.intent ?? (promptArrows ? "flow" : classifyPrompt(q));
  // a bare pattern name ("counter", "pomodoro timer") is a request to build it
  if (!req.intent && !promptArrows && q.split(/\s+/).length <= 4 && pickTemplate(q) && !/\b(review|cluster|group|mind)/i.test(q)) intent = "app";

  // 2. arrow syntax typed in the prompt or present in selected text
  const arrowSrc = promptArrows ?? (intent === null || intent === "flow" ? parseArrows(g.items.map((i) => i.text).join("\n")) : null);
  if (arrowSrc && (intent === "flow" || intent === null || intent === "mindmap")) {
    return {
      say: `Drew ${arrowSrc.nodes.length} steps from your arrows.`,
      ops: [{ op: "diagram", layout: intent === "mindmap" ? "mindmap" : arrowSrc.nodes.length > 6 ? "flow-right" : "flow-down", nodes: arrowSrc.nodes, edges: arrowSrc.edges }],
      engine: "offline",
    };
  }

  switch (intent) {
    case "refine":
      return { say: "", ops: [{ op: "refine" }], engine: "offline" };
    case "flow": {
      const items = outline.length >= 2 ? outline : parseOutline(q.replace(/^[^:]*:\s*/, ""));
      const d = outlineToDiagram(items, topicOf(q));
      if (d) return { say: `Structured ${d.nodes.length} lines into a ${d.layout === "tree-right" ? "tree" : "flow"}.`, ops: [d], engine: "offline" };
      break;
    }
    case "mindmap": {
      const items = outline.length ? outline : parseOutline(q.replace(/^[^:]*:\s*/, ""));
      const d = outlineToMindmap(items, topicOf(q) ?? (sel ? undefined : undefined));
      if (d && d.nodes.length > 1) return { say: `Mind-mapped ${d.nodes.length - 1} ideas.`, ops: [d], engine: "offline" };
      if (d) return { say: NEEDS_MODEL, ops: [], engine: "offline" };
      break;
    }
    case "notes": {
      let texts: string[] = [];
      for (const i of g.items) {
        if (!i.text) continue;
        if (i.text.includes("\n")) texts.push(...parseOutline(i.text).map((o) => o.text));
        else if (/[;,]/.test(i.text) && i.text.split(/[;,]/).length >= 3) texts.push(...i.text.split(/[;,]/).map(clean));
        else texts.push(clean(i.text));
      }
      if (!texts.length) texts = parseOutline(q.replace(/^[^:]*:\s*/, "")).map((o) => o.text);
      texts = texts.filter(Boolean);
      if (texts.length) {
        const ops: Op[] = [{ op: "notes", items: texts.map((text) => ({ text: cap(text) })) }];
        return { say: `Split into ${texts.length} notes.`, ops, engine: "offline" };
      }
      break;
    }
    case "cluster": {
      const items = g.items.filter((i) => i.text && ["note", "text", "shape"].includes(i.kind) && !(i.kind === "text" && i.text.includes("\n")));
      if (items.length < 3) return { say: "Select at least 3 notes to cluster.", ops: [], engine: "offline" };
      const cl = clusterItems(items);
      const groups = cl.map((c, i) => ({ title: c.title || `Group ${i + 1}`, ids: c.idx.map((k) => items[k].alias) }));
      return { say: `Grouped ${items.length} notes into ${groups.length} themes.`, ops: [{ op: "cluster", groups }], engine: "offline" };
    }
    case "review": {
      const issues = reviewGraph(g);
      if (!issues.length)
        return {
          say: g.edges.length ? "No gaps found — every path leads somewhere and every decision branches." : "Nothing to review yet — connect things with arrows first.",
          ops: [],
          engine: "offline",
        };
      return {
        say: `Flagged ${issues.length} issue${issues.length > 1 ? "s" : ""} on the canvas.`,
        ops: issues.map((i) => ({ op: "flag" as const, target: i.alias, text: i.text, severity: i.severity })),
        engine: "offline",
      };
    }
    case "tidy": {
      const nodes = g.items.filter((i) => ["shape", "note"].includes(i.kind));
      if (nodes.length < 2) return { say: "Select a few connected shapes to tidy.", ops: [], engine: "offline" };
      const wide = g.bounds ? g.bounds.w > g.bounds.h * 1.15 : false;
      const layout = /mind/.test(q.toLowerCase()) ? "mindmap" : /tree/.test(q.toLowerCase()) ? "tree-right" : /vertical|top|down/.test(q.toLowerCase()) ? "flow-down" : /horizontal|left|right|across/.test(q.toLowerCase()) ? "flow-right" : wide ? "flow-right" : "flow-down";
      return { say: "Tidied the layout.", ops: [{ op: "relayout", layout }], engine: "offline" };
    }
    case "app": {
      const tpl = pickTemplate(q) ?? (g.edges.length < 2 ? pickTemplate(textBlob) : null);
      const title = topicOf(q) ?? (sel ? clean(g.items.find((i) => i.text)?.text ?? "") : "");
      if (!tpl || g.edges.length >= 2) {
        const fr = g.edges.length >= 2 ? flowRunner(g, title && title.length < 40 ? title : "Walk the flow") : null;
        if (fr) return { say: "Turned your diagram into something you can walk through.", ops: [{ op: "app", ...fr }], engine: "offline" };
      }
      if (tpl) {
        const items = outline.map((o) => o.text);
        const spec = TEMPLATES[tpl].build(title && title.length < 40 ? cap(title) : undefined, items);
        return { say: `Built a working ${tpl === "todo" ? "to-do list" : tpl} you can use right here.`, ops: [{ op: "app", ...spec }], engine: "offline" };
      }
      if (outline.length >= 2) {
        const spec = checklist(outline.map((o) => cap(o.text)), "Checklist");
        return { say: `Turned ${outline.length} lines into a checklist that tracks progress.`, ops: [{ op: "app", ...spec }], engine: "offline" };
      }
      return { say: "Offline mode builds from lists, flows or familiar patterns (try “timer”, “kanban”, “poll”, “calculator”…). For anything bespoke, connect Claude in Settings.", ops: [], engine: "offline" };
    }
    case "doc": {
      if (!g.items.some((i) => i.text)) break;
      const title = topicOf(q) ?? cap(clean(g.items.find((i) => i.text)?.text ?? "Notes")).slice(0, 60);
      return { say: "Wrote it up as a document card.", ops: [{ op: "doc", title, markdown: docFromGraph(g, title) }], engine: "offline" };
    }
    case "explain":
      if (g.items.length) return { say: "", ops: [{ op: "answer", title: "What I see", text: explain(g) }], engine: "offline" };
      break;
  }

  // 3. nothing matched: if the prompt itself looks like a list, honour it
  const list = parseOutline(q.replace(/^[^:\n]*:\s*(?=\S)/, ""));
  if (!sel && list.length >= 3) {
    const d = outlineToDiagram(list);
    if (d) return { say: `Structured ${d.nodes.length} lines into a flow.`, ops: [d], engine: "offline" };
  }
  if (!sel && q) {
    const items = q.split(/[,;]\s*|\n/).map(clean).filter(Boolean);
    if (items.length >= 2) return { say: `Added ${items.length} notes.`, ops: [{ op: "notes", items: items.map((t) => ({ text: cap(t) })) }], engine: "offline" };
    return { say: NEEDS_MODEL, ops: [{ op: "notes", items: [{ text: cap(q) }] }], engine: "offline" };
  }
  return { say: NEEDS_MODEL, ops: [], engine: "offline" };
}
