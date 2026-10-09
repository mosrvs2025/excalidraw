import { describe, expect, it } from "vitest";
import { looksTabular, parseTable, suggestChart, toNumber } from "./parse";

describe("tabular data", () => {
  it("parses CSV with quotes, currency and auto-detected delimiters", () => {
    const t = parseTable('Month,Revenue,Note\nJan,"$1,200.50","said ""hi"""\nFeb,"$900",ok\nMar,(50),')!;
    expect(t.cols.map((c) => [c.n, c.t])).toEqual([["Month", "text"], ["Revenue", "number"], ["Note", "text"]]);
    expect(t.rows[0]).toEqual(["Jan", 1200.5, 'said "hi"']);
    expect(t.rows[2][1]).toBe(-50);
    expect(parseTable("a;b\n1;2\n3;4")!.cols).toHaveLength(2);
    expect(parseTable("a\tb\n1\t2")!.rows).toEqual([[1, 2]]);
  });
  it("parses JSON arrays of objects and nested wrappers", () => {
    expect(parseTable('[{"city":"A","n":1},{"city":"B","n":2}]')!.rows).toEqual([["A", 1], ["B", 2]]);
    expect(parseTable('{"data":[{"x":"a","y":1},{"x":"b","y":2}]}')!.cols.map((c) => c.n)).toEqual(["x", "y"]);
    expect(parseTable("[1,2,3]")).toBeNull();
  });
  it("numbers and detection", () => {
    expect(toNumber("12%")).toBe(12);
    expect(toNumber("abc")).toBeNull();
    expect(looksTabular("Name,Score\nA,1\nB,2\nC,3")).toBe(true);
    expect(looksTabular("just a sentence.\nand another line\nthird")).toBe(false);
    expect(looksTabular("flowchart TD\n A-->B\n B-->C")).toBe(false);
  });
  it("picks sensible charts", () => {
    expect(suggestChart(parseTable("Month,Sales\n2024-01,5\n2024-02,7\n2024-03,6\n2024-04,9")!).type).toBe("line");
    expect(suggestChart(parseTable("Team,Share\nA,50\nB,30\nC,20")!).type).toBe("pie");
    expect(suggestChart(parseTable("Product,Units\nA,5\nA,7\nB,3\nC,9\nD,1\nE,4\nF,2\nG,8")!).type).toBe("bar");
  });
});
