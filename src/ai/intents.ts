import { profileOf, type CanvasGraph } from "../canvas/context";

export type IntentId =
  | "flow"
  | "mindmap"
  | "notes"
  | "cluster"
  | "review"
  | "app"
  | "doc"
  | "explain"
  | "tidy"
  | "mermaid"
  | "ocr";

export interface Suggestion {
  id: IntentId;
  label: string;
  icon: string;
  /** natural-language form sent to a model */
  prompt: string;
  primary?: boolean;
}

/**
 * Verbs that make sense for *this* selection. The canvas decides what to offer —
 * there is no chat box to stare at, just the next obvious moves.
 */
export const MERMAID_RE = /^\s*(?:%%[^\n]*\n\s*)*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|quadrantChart)\b/;

export function mermaidIn(g: CanvasGraph): string | null {
  const t = g.items.find((i) => i.kind === "text" && MERMAID_RE.test(i.text));
  return t ? t.text : null;
}

export function suggestFor(g: CanvasGraph): Suggestion[] {
  const p = profileOf(g);
  const out: Suggestion[] = [];
  if (!p.count) return out;
  if (mermaidIn(g)) return [{ id: "mermaid", icon: "◇", label: "Draw this diagram", prompt: "Render this Mermaid code as a diagram", primary: true }];
  if (p.images + p.sketches > 0 && p.notes + p.texts + p.shapes === 0)
    return [
      { id: "app", icon: "▶", label: "Make it real", prompt: "Build a working prototype of what this sketch shows", primary: true },
      { id: "ocr", icon: "Aa", label: "Read text", prompt: "Read the text in this image" },
      { id: "explain", icon: "✦", label: "What is this?", prompt: "Describe what this is and suggest next steps" },
    ];
  const textual = p.outlineLines >= 2;
  const hasGraph = p.edges >= 1 && p.shapes + p.notes >= 3;

  if (hasGraph) {
    out.push({ id: "app", icon: "▶", label: "Make it run", prompt: "Turn this diagram into a working interactive prototype", primary: true });
    out.push({ id: "review", icon: "◎", label: "Find gaps", prompt: "Review this diagram for gaps, dead ends and unclear decisions" });
    out.push({ id: "tidy", icon: "⇆", label: "Tidy up", prompt: "Re-layout this diagram cleanly" });
    out.push({ id: "doc", icon: "❡", label: "Write it up", prompt: "Write this diagram up as a clear document" });
    out.push({ id: "explain", icon: "✦", label: "Explain", prompt: "Explain what this diagram shows" });
    return out;
  }
  if (p.notes + p.texts + p.shapes >= 3 && p.edges === 0 && !p.multilineText) {
    out.push({ id: "cluster", icon: "▦", label: "Cluster", prompt: "Group these into themes and label each theme", primary: true });
    out.push({ id: "flow", icon: "⇢", label: "Make a flow", prompt: "Arrange these as a flowchart in sequence" });
    out.push({ id: "mindmap", icon: "✺", label: "Mind map", prompt: "Turn these into a mind map" });
    out.push({ id: "app", icon: "▶", label: "Make a checklist", prompt: "Turn these into a working checklist" });
    out.push({ id: "doc", icon: "❡", label: "Write it up", prompt: "Write these up as a document" });
    return out;
  }
  if (textual || p.multilineText) {
    out.push({ id: "flow", icon: "⇢", label: "Structure it", prompt: "Turn this text into a structured flowchart", primary: true });
    out.push({ id: "mindmap", icon: "✺", label: "Mind map", prompt: "Turn this into a mind map" });
    out.push({ id: "notes", icon: "▤", label: "Split to notes", prompt: "Split this into separate sticky notes" });
    out.push({ id: "app", icon: "▶", label: "Make a checklist", prompt: "Turn this into a working checklist" });
    out.push({ id: "doc", icon: "❡", label: "Write it up", prompt: "Write this up as a document" });
    return out;
  }
  if (p.apps || p.docs) return out; // live objects have their own action row
  // a lone sketch / shape / text / image
  out.push({ id: "app", icon: "▶", label: "Make it real", prompt: "Build a working prototype of what this sketch shows", primary: true });
  out.push({ id: "explain", icon: "✦", label: "What is this?", prompt: "Describe what this is and suggest next steps" });
  if (p.texts + p.notes + p.shapes >= 1)
    out.push({ id: "mindmap", icon: "✺", label: "Expand", prompt: "Expand this into a mind map of related ideas" });
  return out;
}

/** Map free text to an intent when no chip was clicked (offline engine + analytics). */
export function classifyPrompt(prompt: string): IntentId | null {
  const q = prompt.toLowerCase();
  const rules: [RegExp, IntentId][] = [
    [/mind ?-?map|brainstorm|expand|radial/, "mindmap"],
    [/review|critique|find (the )?(gaps|issues|problems|holes)|validate|audit|lint|what.?s missing|sanity/, "review"],
    [/cluster|group|organi[sz]e|categori[sz]e|themes?|sort (these|them)|affinity/, "cluster"],
    [/tidy|clean ?up|align|re-?layout|arrange|neaten|straighten|lay ?out/, "tidy"],
    [/(split|break).*(notes?|stickies|sticky|pieces|items)|\bnotes?\b|sticky|stickies/, "notes"],
    [/\bapp\b|prototype|\bui\b|interactive|make (it|this) (real|work|run|live)|\brun\b|simulate|walk ?through|build|checklist|working|clickable|try it/, "app"],
    [/write|doc(ument)?\b|report|brief|spec\b|readme|memo|summary|summari[sz]e|outline/, "doc"],
    [/flow|process|steps?|sequence|diagram|chart|structure|pipeline|workflow|journey/, "flow"],
    [/explain|what|why|how|describe|tell me|meaning|\?$/, "explain"],
  ];
  for (const [re, id] of rules) if (re.test(q)) return id;
  return null;
}
