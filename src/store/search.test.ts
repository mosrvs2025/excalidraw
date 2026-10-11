import { describe, expect, it } from "vitest";
import { searchElements, textOf } from "./search";

describe("search", () => {
  const els = [
    { id: "a", type: "text", text: "Launch plan\nship it" },
    { id: "b", type: "embeddable", customData: { lumen: { kind: "portal", title: "Pricing world" } } },
    { id: "c", type: "text", text: "gone", isDeleted: true },
    { id: "d", type: "frame", name: "Slide: Pricing" },
    { id: "e", type: "rectangle" },
  ];
  it("reads text, world titles and frame names; skips deleted", () => {
    expect(els.map(textOf)).toEqual(["Launch plan\nship it", "Pricing world", "", "Slide: Pricing", ""]);
  });
  it("finds case-insensitively, needs 2+ chars", () => {
    expect(searchElements(els, "pricing").map((h) => h.elementId)).toEqual(["b", "d"]);
    expect(searchElements(els, "p")).toEqual([]);
    expect(searchElements(els, "LAUNCH")[0].text).toBe("Launch plan ship it");
  });
});
