import { describe, expect, it } from "vitest";
import { decodeBoard, encodeBoard } from "./share";

describe("share links", () => {
  it("round-trips a board through the URL fragment", async () => {
    const els = [{ id: "a", type: "rectangle", x: 1, y: 2, isDeleted: false, customData: { lumen: { kind: "note" } } }, { id: "b", isDeleted: true }];
    const h = await encodeBoard(els, "Roadmap");
    expect(h.startsWith("#board=")).toBe(true);
    expect(h.slice("#board=".length)).not.toMatch(/[+/=]/);
    const back = await decodeBoard(h);
    expect(back!.name).toBe("Roadmap");
    expect(back!.elements).toHaveLength(1); // deleted elements are not shipped
    expect(back!.elements[0].customData.lumen.kind).toBe("note");
  });
  it("rejects garbage safely", async () => {
    expect(await decodeBoard("#nope")).toBeNull();
    expect(await decodeBoard("#board=AAAA")).toBeNull();
  });
});
