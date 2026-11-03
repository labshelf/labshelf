/** Verifies the desk of space.json: reading and writing its entries, the papers-in-focus fallback, and pinning up to the limit. */
import { parseSpaceFile, serializeSpaceFile } from "../../src/spaces/index";
import type { Space, SpaceReadResult } from "../../src/spaces/index";
import { withDeskPin, withDeskUnpin } from "../../src/spaces/spaceMutations";

const where = { id: "s", path: "spaces/s/space.json" };

function read(doc: unknown): Extract<SpaceReadResult, { state: "ready" }> {
  const result = parseSpaceFile(JSON.stringify(doc), where);
  if (result.state !== "ready") { throw new Error(result.reason); }
  return result;
}

const base = { version: 1, name: "S", folders: [], papers: [{ id: "p1", focus: true }, { id: "p2" }], projects: [], dates: [] };

test("reads desk entries, keeps unreadable ones and writes both back in order", () => {
  const r = read({ ...base, desk: [{ kind: "note", ref: "notes/a.qmd", pinnedBy: "x" }, { kind: "folder", ref: "f" }, { kind: "paper", ref: "p2" }, { kind: "note", ref: "notes/a.qmd" }] });
  expect(r.space.desk?.items.map(({ kind, ref }) => [kind, ref])).toEqual([["note", "notes/a.qmd"], ["paper", "p2"]]);
  expect(r.readOnlyReason).toBeUndefined();
  expect(JSON.parse(serializeSpaceFile(r.space)).desk).toEqual([
    { kind: "note", ref: "notes/a.qmd", pinnedBy: "x" }, { kind: "paper", ref: "p2" }, { kind: "folder", ref: "f" }]);
});

test("a Space without desk writes no desk key, and a desk that is not a list makes it read-only", () => {
  expect(JSON.parse(serializeSpaceFile(read(base).space))).not.toHaveProperty("desk");
  expect(read({ ...base, desk: { kind: "paper" } }).readOnlyReason).toContain("desk");
});

test("the first pin starts from the papers in focus and refuses a fourth item", () => {
  let space: Space = read(base).space;
  space = withDeskPin(space, "thread", "discussions/t.qmd");
  expect(space.desk?.items.map((item) => item.id)).toEqual(["paper:p1", "thread:discussions/t.qmd"]);
  expect(withDeskPin(space, "paper", "p1")).toBe(space);
  space = withDeskPin(space, "project", "pr");
  expect(() => withDeskPin(space, "note", "notes/a.qmd")).toThrow("The desk holds 3 items");
  space = withDeskUnpin(space, "paper", "p1");
  expect(space.desk?.items.map((item) => item.id)).toEqual(["thread:discussions/t.qmd", "project:pr"]);
  expect(space.papers.find((p) => p.id === "p1")?.focus).toBe(true);
});

test("unpinning the last fallback paper writes an empty desk", () => {
  const space = withDeskUnpin(read(base).space, "paper", "p1");
  expect(JSON.parse(serializeSpaceFile(space)).desk).toEqual([]);
});
