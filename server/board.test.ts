import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM
import { boardToText, mergeElements, summarizeBoard } from "./board.mjs";

const el = (o: any) => ({ version: 1, versionNonce: 5, isDeleted: false, ...o });
describe("agent board summary", () => {
  it("merges by version and describes objects + connections", () => {
    const m = new Map();
    mergeElements(m, [el({ id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50, boundElements: [{ type: "text", id: "ta" }] }), el({ id: "ta", type: "text", containerId: "a", text: "Wrapped", originalText: "Plan" })]);
    mergeElements(m, [el({ id: "b", type: "diamond", x: 200, y: 0, width: 100, height: 80, boundElements: [{ type: "text", id: "tb" }] }), el({ id: "tb", type: "text", containerId: "b", originalText: "OK?" })]);
    mergeElements(m, [el({ id: "ar", type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: "b" }, boundElements: [] })]);
    mergeElements(m, [el({ id: "a", version: 0, type: "rectangle", isDeleted: true })]); // stale update is ignored
    const s = summarizeBoard(m);
    expect(s.items.map((i: any) => [i.kind, i.text])).toEqual([["shape", "Plan"], ["decision", "OK?"]]);
    expect(boardToText(s)).toContain("Plan → OK?");
    mergeElements(m, [el({ id: "a", version: 2, type: "rectangle", isDeleted: true })]);
    expect(summarizeBoard(m).count).toBe(1);
    expect(boardToText(summarizeBoard(new Map()))).toBe("The board is empty.");
  });
});
