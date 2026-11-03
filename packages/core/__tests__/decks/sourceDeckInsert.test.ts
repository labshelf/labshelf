// Tests the workspace's whole-node edits (insert, move, duplicate, delete), the tree lookups that keep a selection, the slide layouts and the page rectangles.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deleteSourceDeckNode, duplicateSourceDeckNode, findSourceDeckNode, findSourceDeckPathAt, findSourceDeckPathAtLine, insertSourceElement, insertSourceSlide,
  matchPosterRects, moveSourceDeckNode, readSourceDeckBlocks, readSourceSlideLayout, restoreSourceDeckPath, setSourceSlideLayout, sourceDeckBreadcrumb, unionSourceDeckRects,
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

describe("page rectangles", () => {
  it("unions the boxes of one page and drops whole-page boxes", () => {
    const rect = unionSourceDeckRects([
      { page: 1, left: 10, top: 10, right: 20, bottom: 20 }, { page: 1, left: 30, top: 5, right: 40, bottom: 15 },
      { page: 1, left: 0, top: 0, right: 100, bottom: 100 }, { page: 2, left: 0, top: 0, right: 5, bottom: 5 },
    ], { width: 100, height: 100 }, 1, 2);
    expect(rect).toEqual({ page: 1, left: 8, top: 3, right: 42, bottom: 22 });
  });

  it("bounds poster blocks from their titles in the text layer", () => {
    const tree = readSourceDeckBlocks("latex", "poster", fixture("a1-tikz.tex"));
    const run = (text: string, left: number, top: number) => ({ text, left, top, width: 100, pt: 20 });
    const rects = matchPosterRects(tree, [run("Introduction", 50, 200), run("What the problem is", 50, 240), run("Method", 50, 400), run("Results", 450, 200), run("Conclusion", 450, 500)], { width: 900, height: 700 });
    const intro = rects.get(tree[0]!.children![0]!)!;
    expect(intro.top).toBeLessThan(200);
    expect(intro.bottom).toBeLessThan(400);
    expect(intro.right).toBeLessThanOrEqual(450);
    expect(rects.get(tree[1]!.children![1]!)!.left).toBeGreaterThan(400);
  });
});
