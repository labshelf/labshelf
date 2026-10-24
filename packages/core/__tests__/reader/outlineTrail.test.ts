// Tests the section and subsection chain the preview footer shows for a page.
import { outlineTrail } from "../../src/reader/outlineTrail";
import type { OutlineRow } from "../../src/reader/outlineModel";

function row(id: number, parentId: number | null, depth: number, title: string): OutlineRow {
  return { id, parentId, depth, title, dest: null, url: null, hasChildren: false, bold: false };
}

const rows = [
  row(0, null, 0, "Intro"),
  row(1, 0, 1, "Background"),
  row(2, null, 0, "Methods"),
  row(3, 2, 1, "Setup"),
  row(4, 3, 2, "Details"),
];
const pages = [2, 3, 5, 6, 7];
const titles = (page: number, p: (number | null)[] = pages) => outlineTrail(rows, p, page).map((r) => r.title);

describe("outlineTrail", () => {
  it("is empty before the first entry", () => {
    expect(titles(1)).toEqual([]);
  });

  it("is empty without rows", () => {
    expect(outlineTrail([], [], 4)).toEqual([]);
  });

  it("gives the section alone for a top-level entry", () => {
    expect(titles(5)).toEqual(["Methods"]);
  });

  it("gives section then subsection", () => {
    expect(titles(3)).toEqual(["Intro", "Background"]);
    expect(titles(6)).toEqual(["Methods", "Setup"]);
  });

  it("keeps the last entry's trail for pages past it", () => {
    expect(titles(99)).toEqual(["Methods", "Setup"]);
  });

  it("stops at two levels under a deeper entry", () => {
    expect(titles(7)).toEqual(["Methods", "Setup"]);
  });

  it("skips entries whose page did not resolve", () => {
    expect(titles(6, [2, 3, 5, null, null])).toEqual(["Methods"]);
    expect(titles(4, [null, null, 5, 6, 7])).toEqual([]);
  });
});
