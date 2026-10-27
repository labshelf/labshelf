/** Verifies the space.json reader's repair rules, its unreadable and read-only states, and the byte-stable serializer. */
import { parseSpaceFile, serializeSpaceFile } from "../../../src/spaces/index";
import type { Space, SpaceReadResult } from "../../../src/spaces/index";

const where = { id: "internship", path: "spaces/internship/space.json" };

function ready(result: SpaceReadResult): Extract<SpaceReadResult, { state: "ready" }> {
  if (result.state !== "ready") { throw new Error(`expected ready, got ${result.reason}`); }
  return result;
}

const read = (doc: unknown) => ready(parseSpaceFile(JSON.stringify(doc), where));

describe("parseSpaceFile", () => {
  it("gives the unreadable state for text that is not JSON", () => {
    const result = parseSpaceFile("{ nope", where);
    expect(result).toEqual({ state: "unreadable", id: "internship", path: where.path, reason: expect.any(String) });
  });

  it("gives the unreadable state for JSON that is not an object", () => {
    expect(parseSpaceFile("[1, 2]", where).state).toBe("unreadable");
    expect(parseSpaceFile("null", where).state).toBe("unreadable");
  });

  it("reads a missing name as the space id and missing arrays as empty", () => {
    const { space, readOnlyReason } = read({ version: 1, name: "" });
    expect(space).toMatchObject({ id: "internship", name: "internship", folders: [], papers: [], projects: [], dates: [] });
    expect(readOnlyReason).toBeUndefined();
  });

  it("reads version 2 but marks the Space read-only", () => {
    const result = read({ version: 2, name: "Future" });
    expect(result.space.name).toBe("Future");
    expect(result.readOnlyReason).toMatch(/version 2/);
  });

  it("reads a paper in a missing folder and a folder with a missing parent as root", () => {
    const { space } = read({
      folders: [{ id: "f1", name: "Baselines", parent: "gone" }],
      papers: [{ id: "p1", folder: "gone", addedAt: "2026-10-20T10:00:00Z" }, { id: "p2", folder: "f1" }],
    });
    expect(space.folders[0]!.parent).toBeUndefined();
    expect(space.papers[0]!.folder).toBeUndefined();
    expect(space.papers[1]!.folder).toBe("f1");
  });

  it("reads folders on a parent cycle as root folders and keeps their children under them", () => {
    const { space } = read({
      folders: [
        { id: "a", name: "A", parent: "b" }, { id: "b", name: "B", parent: "a" },
        { id: "self", name: "Self", parent: "self" }, { id: "c", name: "C", parent: "a" },
      ],
    });
    expect(space.folders.map((folder) => [folder.id, folder.parent])).toEqual([["a", undefined], ["b", undefined], ["self", undefined], ["c", "a"]]);
  });

  it("keeps the first reference of a paper id that appears twice", () => {
    const { space, warnings } = read({ papers: [{ id: "p1", focus: true }, { id: "p1", focus: false }] });
    expect(space.papers).toEqual([{ id: "p1", focus: true, extra: {} }]);
    expect(warnings.length).toBe(1);
  });

  it("drops invalid entries and reports each drop", () => {
    const { space, warnings } = read({
      folders: [{ name: "No id" }, { id: "f1", name: 3 }, { id: "f2", name: "Ok" }],
      papers: ["p1", { id: "p2", focus: "yes" }, { id: "p3" }],
      projects: ["pr1", 5, "pr1"],
      dates: [
        { id: "d1", kind: "meeting", title: "x", date: "2026-10-22" },
        { id: "d2", kind: "task", title: "x", date: "22/10/2026" },
        { id: "d3", kind: "task", title: "Rerun", date: "2026-10-22", done: "no" },
        { id: "d4", kind: "read", title: "Read", date: "2026-11-03", paperIds: ["a", 1] },
        { id: "d5", kind: "deadline", title: "Due", date: "2026-11-14" },
      ],
    });
    expect(space.folders.map((folder) => folder.id)).toEqual(["f2"]);
    expect(space.papers.map((paper) => paper.id)).toEqual(["p3"]);
    expect(space.projects).toEqual(["pr1"]);
    expect(space.dates.map((date) => date.id)).toEqual(["d5"]);
    expect(warnings.length).toBe(10);
  });
});

describe("serializeSpaceFile", () => {
  it("round-trips unknown keys at the top level and inside every entry, after the known keys", () => {
    const text = `${JSON.stringify({
      version: 1, zeta: { keep: true }, name: "Research internship", purpose: "Seg", createdAt: "2026-10-20T10:00:00Z",
      folders: [{ colour: "red", id: "f1", name: "Baselines" }],
      papers: [{ id: "p1", folder: "f1", addedAt: "2026-10-20T10:00:00Z", focus: true, note: "n" }],
      projects: ["pr1"],
      dates: [
        { id: "d1", kind: "task", title: "Rerun SAM", date: "2026-10-22", done: false, owner: "me" },
        { id: "d2", kind: "read", title: "Read", date: "2026-11-03", paperIds: ["p1"] },
        { id: "d3", kind: "project", title: "Draft", date: "2026-11-10", projectId: "pr1" },
        { id: "d4", kind: "deadline", title: "Due", date: "2026-11-14" },
      ],
    }, null, 2)}\n`;
    const out = serializeSpaceFile(read(JSON.parse(text)).space);
    expect(JSON.parse(out)).toEqual(JSON.parse(text));
    expect(Object.keys(JSON.parse(out))).toEqual(["version", "name", "purpose", "createdAt", "folders", "papers", "projects", "dates", "zeta"]);
    expect(Object.keys(JSON.parse(out).folders[0])).toEqual(["id", "name", "colour"]);
    expect(Object.keys(JSON.parse(out).dates[0])).toEqual(["id", "kind", "title", "date", "done", "owner"]);
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.split("\n")[1]).toBe('  "version": 1,');
  });

  it("omits optional keys that are unset", () => {
    const space: Space = {
      id: "s", name: "S", folders: [{ id: "f", name: "F", extra: {} }],
      papers: [{ id: "p", focus: false, extra: {} }], projects: [], dates: [],
      invalid: { folders: [], papers: [], projects: [], dates: [] }, extra: {},
    };
    expect(JSON.parse(serializeSpaceFile(space))).toEqual({ version: 1, name: "S", folders: [{ id: "f", name: "F" }], papers: [{ id: "p" }], projects: [], dates: [] });
  });
});
