// A talk's pages map to its slides through SyncTeX when every slide has boxes: a page with no frame's boxes (a section divider a theme adds
// through \AtBeginSection, which the main file does not show) maps to no slide, so the slides after it stay on their own pages.
import { readSourceDeckBlocks } from "../../../../src/decks/index.js";
import { createLinking } from "../../../../src/decks/dom/workspace/linking";
import type { PdfDeck } from "../../../../src/decks/dom/pdfDeck";

const TEX = [
  "\\documentclass{beamer}", "\\usetheme{Primos}", "\\begin{document}",
  "\\begin{frame}{One}", "a", "\\end{frame}",
  "\\section{S}",
  "\\begin{frame}{Two}", "b", "\\end{frame}",
  "\\begin{frame}{Three}", "c", "\\pause d", "\\end{frame}",
  "\\end{document}",
].join("\n");
const tree = readSourceDeckBlocks("latex", "talk", TEX);
// Pages: 1 One, 2 the theme's divider, 3 Two, 4-5 Three; the labels count the divider as a frame the source does not show.
const pdf = { count: 5, labels: ["1", "2", "3", "4", "4"], pageSize: () => ({ width: 400, height: 300 }), textRuns: async () => [] } as unknown as PdfDeck;
const pageOfLine = (line: number): number[] => (line <= 6 ? [1] : line <= 10 ? [3] : [4, 5]);

describe("talk pages through SyncTeX", () => {
  it("skips a page no frame's lines are on", async () => {
    const linking = createLinking("latex", "talk", {
      boxes: async (from) => pageOfLine(from).map((page) => ({ page, left: 0, top: 0, right: 10, bottom: 10 })),
      sourceAt: async () => undefined,
    });
    await linking.reset(pdf, tree, TEX);
    expect([0, 1, 2].map((slide) => linking.pageOfSlide(slide))).toEqual([1, 3, 4]);
    expect([1, 2, 3, 4, 5].map((page) => linking.slideOfPage(page))).toEqual([0, -1, 1, 2, 2]);
  });

  it("falls back to the page labels when a slide has no boxes", async () => {
    const linking = createLinking("latex", "talk", { boxes: async () => null, sourceAt: async () => undefined });
    await linking.reset(pdf, tree, TEX);
    expect(linking.pageOfSlide(0)).toBe(1);
  });
});
