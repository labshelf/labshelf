import { mergeSidecars } from "../../../src/library/conflicts/index";
import { serializePaperSidecar, type PaperSidecar } from "../../../src/reader/index";
import type { Annotation } from "../../../src/model/index";

function note(id: string, content: string, pageNumber = 1): Annotation {
  return { id, paperId: "p", type: "comment", pageNumber, content, createdAt: `2024-01-0${pageNumber}`, updatedAt: "2024-01-01" };
}

function text(data: PaperSidecar): string {
  return serializePaperSidecar(data);
}

describe("mergeSidecars", () => {
  it("keeps the union of annotations from both files", () => {
    const mine = { text: text({ annotations: [note("a", "mine")], theme: "auto" }), mtimeMs: 1 };
    const other = { text: text({ annotations: [note("b", "other", 2)], theme: "auto" }), mtimeMs: 2 };
    const merged = JSON.parse(mergeSidecars(mine, other) ?? "") as PaperSidecar;
    expect(merged.annotations.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("takes an annotation present in both from the newer file", () => {
    const mine = { text: text({ annotations: [note("a", "old")], theme: "auto" }), mtimeMs: 1 };
    const other = { text: text({ annotations: [note("a", "new")], theme: "auto" }), mtimeMs: 5 };
    expect((JSON.parse(mergeSidecars(mine, other) ?? "") as PaperSidecar).annotations).toEqual([note("a", "new")]);
    expect((JSON.parse(mergeSidecars({ ...mine, mtimeMs: 9 }, other) ?? "") as PaperSidecar).annotations).toEqual([note("a", "old")]);
  });

  it("takes theme and reading position from the newer file", () => {
    const reading = { page: 4, scaleValue: "page-width", left: 0, top: 0, updatedAt: "2024-01-02" };
    const mine = { text: text({ annotations: [], theme: "dark" }), mtimeMs: 1 };
    const other = { text: text({ annotations: [], theme: "sepia", reading } as PaperSidecar), mtimeMs: 2 };
    const merged = JSON.parse(mergeSidecars(mine, other) ?? "") as PaperSidecar;
    expect(merged.theme).toBe("sepia");
    expect(merged.reading?.page).toBe(4);
    expect((JSON.parse(mergeSidecars({ ...mine, mtimeMs: 3 }, other) ?? "") as PaperSidecar).reading).toBeUndefined();
  });

  it("writes the sidecar's canonical bytes", () => {
    const mine = { text: text({ annotations: [note("b", "x", 2)], theme: "auto" }), mtimeMs: 1 };
    const other = { text: text({ annotations: [note("a", "y")], theme: "auto" }), mtimeMs: 2 };
    expect(mergeSidecars(mine, other)).toBe(text({ annotations: [note("a", "y"), note("b", "x", 2)], theme: "auto" }));
  });

  it("refuses to merge when either file is not JSON", () => {
    const good = { text: text({ annotations: [note("a", "x")], theme: "auto" }), mtimeMs: 1 };
    expect(mergeSidecars(good, { text: "{ broken", mtimeMs: 2 })).toBeNull();
    expect(mergeSidecars({ text: "", mtimeMs: 2 }, good)).toBeNull();
  });

  describe("deletions", () => {
    const at = (updatedAt: string, id = "a", content = "x"): Annotation => ({ ...note(id, content), updatedAt });
    const parse = (merged: string | null) => JSON.parse(merged ?? "") as PaperSidecar;

    it("a deletion beats an older copy of the annotation", () => {
      const deleted = { text: text({ annotations: [], theme: "auto", deleted: [{ id: "a", deletedAt: "2024-03-01" }] }), mtimeMs: 1 };
      const stale = { text: text({ annotations: [at("2024-02-01")], theme: "auto" }), mtimeMs: 9 };
      const merged = parse(mergeSidecars(deleted, stale));
      expect(merged.annotations).toEqual([]);
      expect(merged.deleted).toEqual([{ id: "a", deletedAt: "2024-03-01" }]);
    });

    it("an edit after the deletion keeps the annotation and drops the marker", () => {
      const deleted = { text: text({ annotations: [], theme: "auto", deleted: [{ id: "a", deletedAt: "2024-03-01" }] }), mtimeMs: 9 };
      const edited = { text: text({ annotations: [at("2024-04-01")], theme: "auto" }), mtimeMs: 1 };
      const merged = parse(mergeSidecars(deleted, edited));
      expect(merged.annotations).toEqual([at("2024-04-01")]);
      expect(merged.deleted).toBeUndefined();
    });

    it("merges two edits per annotation by updatedAt regardless of file mtime", () => {
      const mine = { text: text({ annotations: [at("2024-05-01", "a", "newer"), at("2024-01-01", "b", "older")], theme: "auto" }), mtimeMs: 1 };
      const other = { text: text({ annotations: [at("2024-02-01", "a", "older"), at("2024-06-01", "b", "newer")], theme: "auto" }), mtimeMs: 9 };
      const merged = parse(mergeSidecars(mine, other));
      expect(merged.annotations.map((a) => [a.id, a.content])).toEqual([["a", "newer"], ["b", "newer"]]);
    });

    it("a deletion at the same time as the last edit removes the annotation", () => {
      const deleted = { text: text({ annotations: [], theme: "auto", deleted: [{ id: "a", deletedAt: "2024-03-01" }] }), mtimeMs: 1 };
      const stale = { text: text({ annotations: [at("2024-03-01")], theme: "auto" }), mtimeMs: 9 };
      expect(parse(mergeSidecars(deleted, stale)).annotations).toEqual([]);
    });

    it("keeps the union of markers with the later deletedAt per id", () => {
      const mine = { text: text({ annotations: [], theme: "auto", deleted: [{ id: "a", deletedAt: "2024-03-01" }, { id: "c", deletedAt: "2024-01-01" }] }), mtimeMs: 9 };
      const other = { text: text({ annotations: [], theme: "auto", deleted: [{ id: "a", deletedAt: "2024-04-01" }, { id: "b", deletedAt: "2024-02-01" }] }), mtimeMs: 1 };
      expect(parse(mergeSidecars(mine, other)).deleted).toEqual([
        { id: "a", deletedAt: "2024-04-01" }, { id: "b", deletedAt: "2024-02-01" }, { id: "c", deletedAt: "2024-01-01" },
      ]);
    });

    it("a marker removes an annotation that has no updatedAt", () => {
      const legacy = JSON.stringify({ annotations: [{ id: "a", paperId: "p", type: "note", pageNumber: 1, content: "x", createdAt: "2024-01-01" }], theme: "auto" });
      const deleted = { text: text({ annotations: [], theme: "auto", deleted: [{ id: "a", deletedAt: "2024-03-01" }] }), mtimeMs: 1 };
      expect(parse(mergeSidecars(deleted, { text: legacy, mtimeMs: 9 })).annotations).toEqual([]);
    });
  });
});
