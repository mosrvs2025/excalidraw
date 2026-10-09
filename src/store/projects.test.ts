import { describe, expect, it } from "vitest";
import { addVersion, createProject, deleteProject, diffScenes, listProjects, listVersions, loadProject, relativeTime, renameProject, saveProject } from "./projects";

const el = (id: string, n = 1, extra: any = {}) => ({ id, versionNonce: n, isDeleted: false, ...extra });

describe("projects", () => {
  it("creates, saves, reloads, renames, deletes", async () => {
    const p = await createProject("Alpha");
    await saveProject(p.id, { elements: [el("a"), el("b")], files: {} });
    expect((await loadProject(p.id))!.elements).toHaveLength(2);
    expect((await listProjects()).find((x) => x.id === p.id)!.count).toBe(2);
    await renameProject(p.id, "Beta");
    expect((await listProjects()).find((x) => x.id === p.id)!.name).toBe("Beta");
    await deleteProject(p.id);
    expect((await listProjects()).find((x) => x.id === p.id)).toBeUndefined();
  });
  it("keeps versions newest-first and skips identical auto checkpoints", async () => {
    const p = await createProject("V");
    await addVersion(p.id, "one", "manual", [el("a")]);
    expect(await addVersion(p.id, "dup", "auto", [el("a")])).toBeNull();
    await addVersion(p.id, "two", "ai", [el("a"), el("b")]);
    const vs = await listVersions(p.id);
    expect(vs.map((v) => v.label)).toEqual(["two", "one"]);
    expect(vs[0].count).toBe(2);
  });
  it("diffs scenes", () => {
    const d = diffScenes([el("a"), el("b")], [el("a", 2), el("c")]);
    expect(d).toEqual({ added: 1, removed: 1, changed: 1 });
  });
  it("formats relative time", () => {
    expect(relativeTime(1000, 1000 + 5 * 60_000)).toBe("5 min ago");
  });
});
