// Tests the workspace's whole-node edits (insert, move, duplicate, delete), the tree lookups that keep a selection and the slide layouts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deleteSourceDeckNode, duplicateSourceDeckNode, findSourceDeckNode, findSourceDeckPathAt, findSourceDeckPathAtLine, insertSourceElement, insertSourceSlide,
  moveSourceDeckNode, readSourceDeckBlocks, readSourceSlideLayout, restoreSourceDeckPath, setSourceSlideLayout, sourceDeckBreadcrumb,
} from "../../src/decks/index.js";

const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");
const titles = (text: string): string[] => readSourceDeckBlocks("latex", "poster", text).flatMap((column) => (column.children ?? []).map((block) => block.title ?? ""));

describe("whole-node edits on a tikzposter", () => {
  const text = fixture("a1-tikz.tex");
  const tree = readSourceDeckBlocks("latex", "poster", text);

  it("moves a block down and up within its column", () => {
    const down = moveSourceDeckNode(text, tree[0]!.children!, 0, 1)!;
    expect(titles(down.text)).toEqual(["Method", "Introduction", "Results", "Conclusion"]);
    expect(moveSourceDeckNode(text, tree[0]!.children!, 0, -1)).toBeNull();
  });

  it("duplicates and deletes a block with its whole lines", () => {
    const copy = duplicateSourceDeckNode(text, tree[1]!.children![0]!);
    expect(titles(copy.text)).toEqual(["Introduction", "Method", "Results", "Results", "Conclusion"]);
    const gone = deleteSourceDeckNode(text, tree[0]!.children![1]!);
    expect(titles(gone.text)).toEqual(["Introduction", "Results", "Conclusion"]);
    expect(gone.text).not.toMatch(/\n[ \t]+\n[ \t]*\n/);
  });

  it.each(["text", "figure", "equation", "table", "list"] as const)("inserts a %s at the end of a block, and the tree reads it", (kind) => {
    const block = tree[1]!.children![0]!;
    const change = insertSourceElement("latex", text, block, kind, "figures/plot.png")!;
    const after = readSourceDeckBlocks("latex", "poster", change.text);
    const children = after[1]!.children![0]!.children!;
    expect(children.length).toBe(block.children!.length + 1);
    expect(children.at(-1)!.kind).toBe(kind);
    expect(titles(change.text)).toEqual(titles(text));
  });

  it("finds paths by offset and line, restores them and names them", () => {
    const results = tree[1]!.children![0]!;
    expect(findSourceDeckPathAt(tree, results.range[0] + 3, (n) => n.kind === "block")).toEqual([1, 0]);
    expect(findSourceDeckPathAtLine(tree, results.line)).toEqual([1, 0]);
    expect(sourceDeckBreadcrumb(tree, "poster", [1, 0])).toEqual(["Poster", "Column 2", "Results"]);
    const moved = readSourceDeckBlocks("latex", "poster", deleteSourceDeckNode(text, tree[0]!.children![0]!).text);
    expect(findSourceDeckNode(moved, restoreSourceDeckPath(moved, [1, 0], results))?.title).toBe("Results");
  });
});

describe("slide layouts", () => {
  it("rewrites a scaffold body to another layout and refuses an edited one", () => {
    const start = "\\documentclass{beamer}\n\\begin{document}\n\\end{document}\n";
    const text = insertSourceSlide("latex", start, 0, "bullets").text;
    const slide = readSourceDeckBlocks("latex", "talk", text)[0]!;
    expect(readSourceSlideLayout("latex", text, slide)).toBe("bullets");
    const next = setSourceSlideLayout("latex", text, slide, "equation")!;
    const after = readSourceDeckBlocks("latex", "talk", next.text)[0]!;
    expect(readSourceSlideLayout("latex", next.text, after)).toBe("equation");
    const edited = text.replace("First point", "My own point");
    expect(setSourceSlideLayout("latex", edited, readSourceDeckBlocks("latex", "talk", edited)[0]!, "figure")).toBeNull();
  });
});
