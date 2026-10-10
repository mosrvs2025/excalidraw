import { describe, expect, it } from "vitest";
import { filterSlash, parseSlash, resolveSlash, splitItems, type SlashCommand } from "./slash";
import { EXCALIDRAW_SINGLE_KEYS, LUMEN_SINGLE_KEYS, SHORTCUT_GROUPS } from "./shortcuts";

const cmd = (id: string, extra: Partial<SlashCommand> = {}): SlashCommand => ({ id, label: id[0].toUpperCase() + id.slice(1), hint: "", icon: "•", group: "Add", run: () => {}, ...extra });
const all = [cmd("note", { aliases: ["n", "sticky"], takesText: true }), cmd("notes"), cmd("kanban", { keywords: "board tasks" }), cmd("flow", { keywords: "flowchart structure" }), cmd("world")];

describe("slash parsing + matching", () => {
  it("parses token and argument", () => {
    expect(parseSlash("/note buy milk")).toEqual({ token: "note", arg: "buy milk" });
    expect(parseSlash("/note")).toEqual({ token: "note", arg: "" });
    expect(parseSlash("/")).toEqual({ token: "", arg: "" });
    expect(parseSlash("/Note  two  spaces")).toEqual({ token: "note", arg: " two  spaces" });
    expect(parseSlash("hello /note")).toBeNull();
    expect(parseSlash("/list a\nb")?.arg).toBe("a\nb");
  });
  it("ranks exact > prefix > keyword, and aliases count", () => {
    expect(filterSlash(all, "note").map((c) => c.id)).toEqual(["note", "notes"]);
    expect(filterSlash(all, "n")[0].id).toBe("note"); // alias exact
    expect(filterSlash(all, "board").map((c) => c.id)).toEqual(["kanban"]);
    expect(filterSlash(all, "flowchart").map((c) => c.id)).toEqual(["flow"]);
    expect(filterSlash(all, "zzz")).toEqual([]);
    expect(filterSlash(all, "")).toHaveLength(all.length);
  });
  it("resolves only exact names, trimming the argument", () => {
    expect(resolveSlash(all, "/sticky  call mum ")?.arg).toBe("call mum");
    expect(resolveSlash(all, "/not")).toBeNull();
    expect(resolveSlash(all, "note")).toBeNull();
  });
  it("splits item lists forgivingly", () => {
    expect(splitItems("milk; eggs; bread")).toEqual(["milk", "eggs", "bread"]);
    expect(splitItems("milk, eggs, bread")).toEqual(["milk", "eggs", "bread"]);
    expect(splitItems("- milk\n- eggs\n1. bread\n[ ] tea")).toEqual(["milk", "eggs", "bread", "tea"]);
    expect(splitItems("one thing")).toEqual(["one thing"]);
    expect(splitItems("3,000 apples")).toEqual(["3,000 apples"]); // a number's comma isn't a separator
    expect(splitItems("   ")).toEqual([]);
  });
});

describe("shortcut catalogue", () => {
  it("never claims a plain key that Excalidraw already uses (except ? and / which we deliberately take over)", () => {
    const clash = LUMEN_SINGLE_KEYS.filter((k) => EXCALIDRAW_SINGLE_KEYS.includes(k));
    expect(clash).toEqual([]);
  });
  it("has no duplicate key combos and every row says what it does", () => {
    const seen = new Set<string>();
    for (const g of SHORTCUT_GROUPS)
      for (const s of g.items) {
        const id = s.keys.join("+");
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
        expect(s.does.length).toBeGreaterThan(2);
      }
  });
});
