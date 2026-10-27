// Tests that headings nest under the nearest shallower heading and end at the next one of the same or a higher level.
import { findDeepestContaining, deriveNestedHeadings, findOutlineHeadings } from "../../../src/writing/index";

const headings = (levels: number[]) => levels.map((level, line) => ({ level, line }));

describe("deriveNestedHeadings", () => {
  it("nests under the nearest shallower heading and links each to the heading that ends it", () => {
    const [one, two] = deriveNestedHeadings(headings([1, 2, 3, 2, 1, 2]));
    expect(one!.children.map((node) => node.entry.line)).toEqual([1, 3]);
    expect(one!.children[0]!.children.map((node) => node.entry.line)).toEqual([2]);
    expect(one!.next?.line).toBe(4);
    expect(one!.children[0]!.next?.line).toBe(3);
    expect(two!.children.map((node) => node.entry.line)).toEqual([5]);
    expect(two!.next).toBeUndefined();
  });

  it("returns nothing for no headings", () => {
    expect(deriveNestedHeadings([])).toEqual([]);
  });
});

describe("findDeepestContaining", () => {
  const tree = [
    { name: "One", from: 0, to: 6, children: [{ name: "Alpha", from: 1, to: 3, children: [] }, { name: "Beta", from: 3, to: 6, children: [] }] },
    { name: "Two", from: 6, to: 9, children: [] },
  ];
  const at = (line: number) => findDeepestContaining(tree, (node) => node.from <= line && line < node.to)?.name;

  it("picks the deepest node that holds the position", () => {
    expect(at(2)).toBe("Alpha");
    expect(at(5)).toBe("Beta");
    expect(at(8)).toBe("Two");
  });

  it("prefers the later sibling at a shared boundary", () => {
    const touching = [{ name: "A", children: [] }, { name: "B", children: [] }];
    expect(findDeepestContaining(touching, () => true)?.name).toBe("B");
  });

  it("finds nothing outside every node", () => {
    expect(at(20)).toBeUndefined();
  });
});

describe("findOutlineHeadings", () => {
  it("keeps the level of Typst headings", () => {
    expect(findOutlineHeadings("typst", "= One\n== Two")).toEqual([{ level: 1, title: "One", line: 0 }, { level: 2, title: "Two", line: 1 }]);
  });

  it("keeps the level of LaTeX sections", () => {
    const found = findOutlineHeadings("latex", "\\section{One}\n\\subsection{Two}");
    expect(found.map(({ title, line }) => [title, line])).toEqual([["One", 0], ["Two", 1]]);
    expect(found[1]!.level).toBeGreaterThan(found[0]!.level);
  });
});
