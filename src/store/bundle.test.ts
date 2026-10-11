import { describe, expect, it } from "vitest";
import { collectWorlds, importBundle } from "./bundle";

const portal = (id: string, childId: string) => ({ id, type: "embeddable", customData: { lumen: { kind: "portal", childId } } });
const DB: Record<string, any> = {
  A: { name: "Planet", elements: [portal("p2", "B"), { id: "t", type: "text", text: "hi" }] },
  B: { name: "Town", elements: [portal("p3", "A")] }, // a cycle back to A
};

describe("bundles", () => {
  it("collects nested worlds breadth-first and survives cycles", async () => {
    const ws = await collectWorlds([portal("p1", "A")], async (id) => DB[id] ?? null);
    expect(ws.map((w) => [w.ref, w.parentRef])).toEqual([["A", null], ["B", "A"]]);
  });
  it("skips worlds that aren't here", async () => {
    expect(await collectWorlds([portal("p1", "ZZ")], async () => null)).toEqual([]);
  });
  it("imports with portals re-pointed at the new projects, parents first", async () => {
    const ws = await collectWorlds([portal("p1", "A")], async (id) => DB[id] ?? null);
    const created: any[] = [];
    const saved: Record<string, any[]> = {};
    let n = 0;
    const root = await importBundle(
      { name: "Shared", elements: [portal("p1", "A")], worlds: ws },
      {
        create: async (name, data, rel) => (created.push({ name, rel }), { id: "new" + ++n }),
        save: async (id, d) => void (saved[id] = d.elements),
      },
    );
    expect(root).toBe("new1");
    expect(created.map((c) => c.name)).toEqual(["Shared", "Planet", "Town"]);
    expect(created[1].rel).toEqual({ parentId: "new1", portalId: "p1" });
    expect(created[2].rel).toEqual({ parentId: "new2", portalId: "p2" });
    expect(saved.new1[0].customData.lumen.childId).toBe("new2");
    expect(saved.new2[0].customData.lumen.childId).toBe("new3");
  });
});
