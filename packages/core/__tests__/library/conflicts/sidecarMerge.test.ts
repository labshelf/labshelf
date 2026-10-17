import { mergeSidecars } from "../../../src/library/conflicts/index";
import { serializePaperData, type PaperData } from "../../../src/reader/index";
import type { Annotation } from "../../../src/model/index";

function note(id: string, content: string, pageNumber = 1): Annotation {
  return { id, paperId: "p", type: "note", pageNumber, content, createdAt: `2024-01-0${pageNumber}`, updatedAt: "2024-01-01" };
}

function text(data: PaperData): string {
  return serializePaperData(data);
}

describe("mergeSidecars", () => {
  it("keeps the union of annotations from both files", () => {
    const mine = { text: text({ annotations: [note("a", "mine")], theme: "auto" }), mtimeMs: 1 };
    const other = { text: text({ annotations: [note("b", "other", 2)], theme: "auto" }), mtimeMs: 2 };
    const merged = JSON.parse(mergeSidecars(mine, other) ?? "") as PaperData;
    expect(merged.annotations.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("takes an annotation present in both from the newer file", () => {
    const mine = { text: text({ annotations: [note("a", "old")], theme: "auto" }), mtimeMs: 1 };
    const other = { text: text({ annotations: [note("a", "new")], theme: "auto" }), mtimeMs: 5 };
    expect((JSON.parse(mergeSidecars(mine, other) ?? "") as PaperData).annotations).toEqual([note("a", "new")]);
    expect((JSON.parse(mergeSidecars({ ...mine, mtimeMs: 9 }, other) ?? "") as PaperData).annotations).toEqual([note("a", "old")]);
  });

  it("takes theme and reading position from the newer file", () => {
    const reading = { page: 4, scaleValue: "page-width", left: 0, top: 0, updatedAt: "2024-01-02" };
    const mine = { text: text({ annotations: [], theme: "dark" }), mtimeMs: 1 };
    const other = { text: text({ annotations: [], theme: "sepia", reading } as PaperData), mtimeMs: 2 };
    const merged = JSON.parse(mergeSidecars(mine, other) ?? "") as PaperData;
    expect(merged.theme).toBe("sepia");
    expect(merged.reading?.page).toBe(4);
    expect((JSON.parse(mergeSidecars({ ...mine, mtimeMs: 3 }, other) ?? "") as PaperData).reading).toBeUndefined();
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
});
