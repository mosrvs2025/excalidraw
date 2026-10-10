/**
 * Slash commands for the "Ask the canvas" box (Notion-style): type "/" for a menu, "/note buy milk" to add content,
 * "/kanban" to scaffold, "/flow" to act on the selection. Pure matching logic — the commands themselves live in App.
 */
export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  icon: string;
  group: "Add" | "Transform" | "Boards" | "Worlds" | "Go";
  aliases?: string[];
  keywords?: string;
  /** shows "/id <text>" in the menu: the rest of the line is passed to run() */
  takesText?: boolean;
  run: (arg: string) => void | Promise<void>;
}

export interface SlashQuery {
  token: string;
  arg: string;
}

/** "/note  hello world" → { token: "note", arg: "hello world" }; not a slash line → null */
export function parseSlash(text: string): SlashQuery | null {
  if (!text.startsWith("/")) return null;
  const m = text.slice(1).match(/^(\S*)\s?([\s\S]*)$/);
  return m ? { token: m[1].toLowerCase(), arg: m[2] } : null;
}

const names = (c: SlashCommand) => [c.id, ...(c.aliases ?? [])];

/** Best matches first: exact name, then name prefix, then label/keyword substring. */
export function filterSlash(cmds: readonly SlashCommand[], token: string, limit = 9): SlashCommand[] {
  const t = token.toLowerCase();
  if (!t) return cmds.slice(0, limit);
  const score = (c: SlashCommand) => {
    const n = names(c);
    if (n.includes(t)) return 0;
    if (n.some((x) => x.startsWith(t))) return 1;
    if (c.label.toLowerCase().startsWith(t)) return 2;
    if ((c.label + " " + (c.keywords ?? "") + " " + c.hint).toLowerCase().includes(t)) return 3;
    return 9;
  };
  return cmds
    .map((c) => [c, score(c)] as const)
    .filter(([, s]) => s < 9)
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([c]) => c);
}

/** The command a finished line refers to (exact id/alias) — used when the user hits Enter after typing "/note …". */
export function resolveSlash(cmds: readonly SlashCommand[], text: string): { cmd: SlashCommand; arg: string } | null {
  const q = parseSlash(text);
  if (!q || !q.token) return null;
  const cmd = cmds.find((c) => names(c).includes(q.token));
  return cmd ? { cmd, arg: q.arg.trim() } : null;
}

/** "a; b; c" / "a, b" / bullet lines → ["a","b","c"] */
export function splitItems(arg: string): string[] {
  const lines = arg.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]?\])\s+/, "").trim()).filter(Boolean);
  const parts = lines.length > 1 ? lines : arg.split(/[;]|,\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [];
}
