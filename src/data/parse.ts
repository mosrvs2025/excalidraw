/** Tabular data: CSV/TSV/JSON → typed table. Pure, dependency-free. */
export type ColType = "number" | "text";
export interface Table {
  cols: { n: string; t: ColType }[];
  rows: (string | number | null)[][];
  truncated?: boolean;
}

const MAX_ROWS = 5000;
const MAX_COLS = 60;

function detectDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).filter(Boolean).slice(0, 8);
  let best = ",";
  let bestScore = 0;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const c0 = counts[0];
    if (c0 < 2) continue;
    const consistent = counts.filter((c) => c === c0).length / counts.length;
    const score = consistent * c0;
    if (score > bestScore) (bestScore = score), (best = d);
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) (out.push(cur), (cur = ""));
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "$1,234.50" "12%" "(3.5)" → number, else null */
export function toNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t);
  const core = t.replace(/^\(|\)$/g, "").replace(/[$€£¥,\s]/g, "").replace(/%$/, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(core)) return null;
  const n = parseFloat(core);
  return neg ? -n : n;
}

export function parseTable(text: string): Table | null {
  const src = text.replace(/^﻿/, "").trim();
  if (!src) return null;
  if (/^[[{]/.test(src)) return parseJsonTable(src);
  const d = detectDelimiter(src);
  const lines = src.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const grid = lines.map((l) => splitLine(l, d));
  const width = Math.min(Math.max(...grid.map((r) => r.length)), MAX_COLS);
  if (width < 2) return null;
  const head = grid[0].map((h) => h.trim());
  // header row = mostly non-numeric labels
  const headerLike = head.filter((h) => h && toNumber(h) === null).length >= Math.ceil(head.length / 2);
  const names = Array.from({ length: width }, (_, i) => (headerLike && head[i]) || `Column ${i + 1}`);
  const body = (headerLike ? grid.slice(1) : grid).slice(0, MAX_ROWS);
  return finish(names, body.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim())), grid.length - (headerLike ? 1 : 0) > MAX_ROWS);
}

function parseJsonTable(src: string): Table | null {
  try {
    let data = JSON.parse(src);
    if (!Array.isArray(data) && data && typeof data === "object") {
      const arr = Object.values(data).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
      if (arr) data = arr;
    }
    if (!Array.isArray(data) || !data.length) return null;
    if (Array.isArray(data[0])) return parseTable(data.map((r: any[]) => r.join(",")).join("\n"));
    const keys = [...new Set(data.slice(0, 200).flatMap((o: any) => (o && typeof o === "object" ? Object.keys(o) : [])))].slice(0, MAX_COLS);
    if (keys.length < 2) return null;
    const rows = data.slice(0, MAX_ROWS).map((o: any) => keys.map((k) => (o?.[k] == null ? "" : typeof o[k] === "object" ? JSON.stringify(o[k]) : String(o[k]))));
    return finish(keys, rows, data.length > MAX_ROWS);
  } catch {
    return null;
  }
}

function finish(names: string[], raw: string[][], truncated: boolean): Table {
  const cols = names.map((n, c) => {
    const vals = raw.map((r) => r[c]).filter((v) => v !== "");
    const nums = vals.filter((v) => toNumber(v) !== null).length;
    return { n, t: (vals.length && nums / vals.length >= 0.9 ? "number" : "text") as ColType };
  });
  const rows = raw.map((r) => r.map((v, c) => (v === "" ? null : cols[c].t === "number" ? toNumber(v) : v)));
  return { cols, rows, truncated };
}

/** Does this free text look like a small dataset worth charting? */
export function looksTabular(text: string): boolean {
  if (!text || text.length > 400_000 || (text.match(/\n/g)?.length ?? 0) < 2) return false;
  if (/^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap)\b/.test(text)) return false;
  const t = parseTable(text);
  return !!t && t.rows.length >= 2 && t.cols.length >= 2 && t.cols.some((c) => c.t === "number");
}

/** Pick an initial chart for the table. */
export function suggestChart(t: Table): { x: number; y: number; type: "bar" | "line" | "pie" } {
  const y = Math.max(0, t.cols.findIndex((c) => c.t === "number"));
  let x = t.cols.findIndex((c, i) => i !== y && c.t === "text");
  if (x < 0) x = y === 0 ? 1 : 0;
  const xs = t.rows.map((r) => String(r[x] ?? ""));
  const dateLike = xs.filter((v) => /^(\d{4}([-/]\d{1,2}([-/]\d{1,2})?)?|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|mon|tue|wed|thu|fri|sat|sun)/i.test(v)).length >= xs.length * 0.8;
  const uniq = new Set(xs).size;
  if (dateLike && t.rows.length >= 4) return { x, y, type: "line" };
  if (uniq === t.rows.length && t.rows.length <= 6 && t.rows.every((r) => Number(r[y]) > 0)) return { x, y, type: "pie" };
  return { x, y, type: "bar" };
}

export function tableToCsv(t: Table): string {
  const q = (v: any) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [t.cols.map((c) => q(c.n)).join(","), ...t.rows.map((r) => r.map(q).join(","))].join("\n");
}
