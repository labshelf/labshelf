// Placing a beamerposter's blocks on its built page without SyncTeX boxes (a beamer frame tags all its content with the \end{frame} line):
// the text runs pdf.js reads from the real green-tao-a0 poster (a full-width alert block above three columns of left-aligned uppercase titles,
// shared words between the alert block and the abstract, a footer line under the columns). Each block must be its own box within its column,
// a click must pick the block under the point, and an element's rectangle must stay inside its block's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchPosterRects, matchTextRectsWithin, readSourceDeckBlocks, type SourceDeckNode, type SourceDeckRect, type SourceDeckTextRun } from "../../src/decks/index.js";
import type { PdfDeck } from "../../src/decks/dom/pdfDeck";
import { createLinking } from "../../src/decks/dom/workspace/linking";
import type { DeckSourceLinks } from "../../src/decks/dom/workspace/types";

const fixtures = join(__dirname, "fixtures");
const text = readFileSync(join(fixtures, "green-tao-a0.tex"), "utf8");
const page = JSON.parse(readFileSync(join(fixtures, "green-tao-a0.runs.json"), "utf8")) as { size: { width: number; height: number }; runs: SourceDeckTextRun[] };
const tree = readSourceDeckBlocks("latex", "poster", text);
const pdf: PdfDeck = { count: 1, labels: null, pageSize: () => page.size, render: async () => undefined, textRuns: async () => page.runs, destroy: () => undefined };
// SyncTeX as a beamer frame leaves it: no box for any line of the frame's blocks, every point on the \end{frame} line.
const links: DeckSourceLinks = { boxes: async () => [], sourceAt: async () => 210 };

const titleRun = (title: string): SourceDeckTextRun => page.runs.find((run) => run.text === title.toUpperCase())!;
const block = (column: number, index: number): SourceDeckNode => tree[column]!.children![index]!;
const isBlock = (node: { kind: string }): boolean => node.kind === "block";
/** Every block of the three lower columns with its path. */
const lower = [1, 2, 3].flatMap((c) => tree[c]!.children!.map((node, b) => ({ node, path: [c, b] })));
const FOOTER_TOP = 3283.2;
/** The x ranges the three columns' text covers on the page, and where the next column's title starts. */
const COLUMN = { 1: { text: [77.5, 768.8], next: 811.3 }, 2: { text: [846.3, 1519.5], next: 1615.1 }, 3: { text: [1615.1, 2379.1], next: page.size.width } } as const;

describe("matchPosterRects on the green-tao-a0 beamerposter", () => {
  const rects = matchPosterRects(tree.filter((node) => node.kind === "column"), page.runs, page.size);

  it("places Teoremas within its own column, from its title to above Método", () => {
    const teoremas = rects.get(block(2, 0))!;
    expect(teoremas).toBeDefined();
    expect(teoremas.left).toBeGreaterThan(COLUMN[1].text[1]);
    expect(teoremas.left).toBeLessThanOrEqual(titleRun("Teoremas").left);
    expect(teoremas.right).toBeGreaterThanOrEqual(COLUMN[2].text[1]);
    expect(teoremas.right).toBeLessThan(titleRun("Contagem").left);
    expect(teoremas.top).toBeLessThanOrEqual(titleRun("Teoremas").top);
    expect(teoremas.bottom).toBeGreaterThan(1358);
    expect(teoremas.bottom).toBeLessThanOrEqual(titleRun("Método").top);
  });

  it("keeps every block of the three columns inside its column and apart from the others", () => {
    for (const { node, path } of lower) {
      const rect = rects.get(node)!;
      expect(rect).toBeDefined();
      const column = COLUMN[path[0] as 1 | 2 | 3];
      expect(rect.left).toBeLessThanOrEqual(column.text[0]);
      expect(rect.right).toBeGreaterThanOrEqual(Math.min(column.text[1], page.size.width - 1));
      expect(rect.right).toBeLessThanOrEqual(column.next);
      expect(rect.bottom).toBeLessThan(FOOTER_TOP);
      for (const other of lower) {
        if (other.node === node) continue;
        const o = rects.get(other.node)!;
        const overlap = Math.min(rect.right, o.right) - Math.max(rect.left, o.left) > 0 && Math.min(rect.bottom, o.bottom) - Math.max(rect.top, o.top) > 0;
        expect({ block: node.title, other: other.node.title, overlap }).toEqual({ block: node.title, other: other.node.title, overlap: false });
      }
    }
  });

  it("gives the full-width alert block the width of its text and ends it above the columns", () => {
    const message = rects.get(block(0, 0))!;
    expect(message.left).toBeLessThanOrEqual(115.1);
    expect(message.right).toBeGreaterThanOrEqual(2221);
    expect(message.bottom).toBeLessThanOrEqual(titleRun("Resumo").top);
  });
});

describe("the workspace linking of the green-tao-a0 beamerposter without SyncTeX boxes", () => {
  async function linked() {
    const linking = createLinking("latex", "poster", links);
    await linking.reset(pdf, tree, text);
    return linking;
  }

  it("outlines Teoremas within its column", async () => {
    const rect = (await (await linked()).rectOf([2, 0], tree))!;
    expect(rect.left).toBeGreaterThan(COLUMN[1].text[1]);
    expect(rect.right).toBeLessThan(titleRun("Contagem").left);
    expect(rect.bottom).toBeLessThanOrEqual(titleRun("Método").top);
  });

  it("picks the block under the point", async () => {
    const linking = await linked();
    const at = (x: number, y: number): Promise<number[]> => linking.pathAt({ page: 1, x, y }, tree, isBlock as never);
    expect(await at(700, 1100)).toEqual([1, 0]); // the right end of Resumo's lines
    expect(await at(600, 1300)).toEqual([1, 0]);
    expect(await at(900, 1100)).toEqual([2, 0]); // Teoremas' text
    expect(await at(1500, 1200)).toEqual([2, 0]);
    expect(await at(1700, 1000)).toEqual([3, 0]); // Contagem
    expect(await at(400, 1700)).toEqual([1, 1]); // Dirichlet
    expect(await at(1000, 1600)).toEqual([2, 1]); // Método
    expect(await at(600, 700)).toEqual([0, 0]); // the alert block
  });

  it("keeps every element's rectangle inside its block's", async () => {
    const linking = await linked();
    const inside = (inner: SourceDeckRect, outer: SourceDeckRect): boolean =>
      inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
    const walk = async (nodes: readonly SourceDeckNode[], path: number[], outer: SourceDeckRect): Promise<void> => {
      for (const [i, node] of nodes.entries()) {
        const at = [...path, i];
        const rect = await linking.rectOf(at, tree);
        if (rect) expect({ at, inside: inside(rect, outer) }).toEqual({ at, inside: true });
        await walk(node.children ?? [], at, outer);
      }
    };
    for (const [c, column] of tree.entries()) {
      for (const [b, node] of (column.children ?? []).entries()) {
        const outer = (await linking.rectOf([c, b], tree))!;
        expect(outer).toBeDefined();
        await walk(node.children ?? [], [c, b], outer);
      }
    }
  });
});

describe("matchTextRectsWithin", () => {
  it("leaves the same words in another column to that column and clips to the block", () => {
    const run = (text: string, left: number, top: number, width = 300, pt = 20): SourceDeckTextRun => ({ text, left, top, width, pt });
    const runs = [run("primes have density zero", 100, 300), run("primes have density zero", 900, 300), run("and contain long progressions", 100, 330, 900)];
    const within = { page: 1, left: 80, top: 250, right: 500, bottom: 400 };
    const rects = matchTextRectsWithin([{ key: "a", words: "The primes have density zero and contain long progressions" }], runs, within);
    expect(rects.get("a")).toEqual({ page: 1, left: 98, top: 298, right: 402, bottom: 326 });
  });
});

describe("matchPosterRects with centred titles", () => {
  it("splits side-by-side columns at the gap between their text, not at their titles", () => {
    const columns = readSourceDeckBlocks("typst", "poster", readFileSync(join(fixtures, "typst-a0.typ"), "utf8")).filter((node) => node.kind === "column");
    const run = (text: string, left: number, top: number, width: number): SourceDeckTextRun => ({ text, left, top, width, pt: 20 });
    // Two columns of text 100-1100 and 1300-2300, titles centred over them.
    const runs = [run("Introduction", 520, 200, 160), run("A line of the introduction text", 100, 260, 1000), run("Method", 560, 600, 80), run("A line of the method", 100, 660, 1000),
      run("Results", 1760, 200, 80), run("A line of the results", 1300, 260, 1000), run("Conclusion", 1740, 600, 120), run("A line of the conclusion", 1300, 660, 1000)];
    const rects = matchPosterRects(columns, runs, { width: 2384, height: 1684 });
    const intro = rects.get(columns[0]!.children![0]!)!;
    const results = rects.get(columns[1]!.children![0]!)!;
    expect(intro.left).toBeLessThanOrEqual(100);
    expect(intro.right).toBeGreaterThanOrEqual(1100);
    expect(intro.right).toBeLessThanOrEqual(results.left);
    expect(results.left).toBeLessThanOrEqual(1300);
    expect(intro.bottom).toBeLessThanOrEqual(600);
  });
});
