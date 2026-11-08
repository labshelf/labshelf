// Tests moving a slide (or any sibling) to an index and arranging a slide's content in one or two columns without losing any of it.
import type { SourceDeckNode } from "../../src/decks/index.js";
import type { SlideArrangement } from "../../src/decks/sourceDeckArrange.js";
import { moveSourceDeckNode, readSourceDeckBlocks } from "../../src/decks/index.js";
import { arrangeSourceSlide, moveSourceDeckNodeTo, SLIDE_ARRANGEMENTS } from "../../src/decks/sourceDeckArrange.js";

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();
const titles = (format: "latex" | "typst", text: string): Array<string | undefined> => readSourceDeckBlocks(format, "talk", text).map((node) => node.title);
const sliceOf = (text: string, node: SourceDeckNode): string => text.slice(...node.range);

describe("moveSourceDeckNodeTo", () => {
  const frame = (name: string): string => `\\begin{frame}{${name}}\n  Body ${name}.\n\\end{frame}\n`;
  const [a, b, c, d] = ["A", "B", "C", "D"].map(frame) as [string, string, string, string];
  const wrap = (...parts: string[]): string => `\\documentclass{beamer}\n\\begin{document}\n${parts.join("")}\\end{document}\n`;
  const text = wrap(a, b, c, d);
  const slides = readSourceDeckBlocks("latex", "talk", text);

  it("6.1d moves slide 0 of 4 to index 2 with whole lines kept", () => {
    const change = moveSourceDeckNodeTo(text, slides, 0, 2)!;
    expect(change.text).toBe(wrap(b, c, a, d));
    expect(titles("latex", change.text)).toEqual(["B", "C", "A", "D"]);
  });

  it("6.1d moves slide 3 of 4 to index 0 with whole lines kept", () => {
    const change = moveSourceDeckNodeTo(text, slides, 3, 0)!;
    expect(change.text).toBe(wrap(d, a, b, c));
  });

  it("6.1d moves a slide to the last index and to the middle from the end", () => {
    expect(moveSourceDeckNodeTo(text, slides, 1, 3)!.text).toBe(wrap(a, c, d, b));
    expect(moveSourceDeckNodeTo(text, slides, 3, 1)!.text).toBe(wrap(a, d, b, c));
  });

  it("6.1d puts the cursor at the moved node's new start", () => {
    const change = moveSourceDeckNodeTo(text, slides, 0, 2)!;
    expect(change.cursor).toBe(change.text.indexOf("\\begin{frame}{A}"));
    expect(moveSourceDeckNodeTo(text, slides, 3, 0)!.cursor).toBe(wrap(d).indexOf("\\begin{frame}{D}"));
  });

  it("6.1d agrees with the neighbour swap when moving one step", () => {
    expect(moveSourceDeckNodeTo(text, slides, 1, 2)!.text).toBe(moveSourceDeckNode(text, slides, 1, 1)!.text);
    expect(moveSourceDeckNodeTo(text, slides, 2, 1)!.text).toBe(moveSourceDeckNode(text, slides, 2, -1)!.text);
  });

  it("6.1d returns null for the same index", () => {
    expect(moveSourceDeckNodeTo(text, slides, 2, 2)).toBeNull();
  });

  it("6.1d returns null for an index out of range", () => {
    expect(moveSourceDeckNodeTo(text, slides, 0, 4)).toBeNull();
    expect(moveSourceDeckNodeTo(text, slides, 0, -1)).toBeNull();
    expect(moveSourceDeckNodeTo(text, slides, 4, 0)).toBeNull();
    expect(moveSourceDeckNodeTo(text, slides, -1, 0)).toBeNull();
  });

  it("6.1d moves Typst call-style slides to any index too", () => {
    const slide = (name: string): string => `#slide(title: [${name}])[\n  Body ${name}.\n]\n`;
    const typ = ["A", "B", "C"].map(slide).join("");
    const change = moveSourceDeckNodeTo(typ, readSourceDeckBlocks("typst", "talk", typ), 2, 0)!;
    expect(change.text).toBe(["C", "A", "B"].map(slide).join(""));
  });

  it("6.1d keeps the indentation of indented siblings", () => {
    const indented = `\\documentclass{beamer}\n\\begin{document}\n  \\begin{frame}{A}\n    one\n  \\end{frame}\n  \\begin{frame}{B}\n    two\n  \\end{frame}\n\\end{document}\n`;
    const change = moveSourceDeckNodeTo(indented, readSourceDeckBlocks("latex", "talk", indented), 0, 1)!;
    expect(change.text).toBe(`\\documentclass{beamer}\n\\begin{document}\n  \\begin{frame}{B}\n    two\n  \\end{frame}\n  \\begin{frame}{A}\n    one\n  \\end{frame}\n\\end{document}\n`);
  });
});

describe("SLIDE_ARRANGEMENTS", () => {
  it("6.1e lists the four arrangements with their labels", () => {
    expect(SLIDE_ARRANGEMENTS).toEqual([
      { id: "one-column", label: "One column" },
      { id: "two-columns", label: "Two columns" },
      { id: "figure-left", label: "Figure left" },
      { id: "figure-right", label: "Figure right" },
    ]);
  });
});

describe("arrangeSourceSlide on a beamer slide", () => {
  const LIST = "\\begin{itemize}\n    \\item First point\n    \\item Second point\n  \\end{itemize}";
  const FIGURE = "\\includegraphics[width=0.8\\linewidth]{figures/plot.png}";
  const EQUATION = "\\[ E = mc^2 \\]";
  const doc = (body: string): string => `\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{Results}\n${body}\\end{frame}\n\\end{document}\n`;
  const text = doc(`  ${LIST}\n\n  ${FIGURE}\n`);
  const slideOf = (source: string): SourceDeckNode => readSourceDeckBlocks("latex", "talk", source)[0]!;
  const arrange = (source: string, arrangement: SlideArrangement): string => arrangeSourceSlide("latex", source, slideOf(source), arrangement)!.text;
  /** The kinds of the slide's children, with each `columns` child shown as the kinds of its columns. */
  const shape = (source: string): unknown => slideOf(source).children!.map((child) => (child.kind === "columns" ? child.children!.map((column) => column.children!.map((item) => item.kind)) : child.kind));

  it("6.1e turns a title, a list and a figure into two columns, keeping each item's text", () => {
    const two = arrange(text, "two-columns");
    expect(two).toContain("\\begin{frame}{Results}");
    expect(two).toContain("\\begin{columns}[T]");
    expect(two).toContain("\\begin{column}{0.48\\textwidth}");
    expect(two).toContain("\\end{columns}");
    expect(two.match(/\\begin\{column\}\{0\.48\\textwidth\}/g)).toHaveLength(2);
    expect(two).toContain(FIGURE);
    expect(squash(two)).toContain(squash(LIST));
    expect(shape(two)).toEqual([[["list"], ["figure"]]]);
  });

  it("6.1e turns two columns back into one column, keeping the title, the list and the figure", () => {
    const one = arrange(arrange(text, "two-columns"), "one-column");
    expect(one).not.toContain("\\begin{columns}");
    expect(one).toContain("\\begin{frame}{Results}");
    expect(one).toContain(FIGURE);
    expect(squash(one)).toContain(squash(LIST));
    expect(shape(one)).toEqual(["list", "figure"]);
    expect(one.indexOf("Second point")).toBeLessThan(one.indexOf(FIGURE));
  });

  it("6.1e puts the figure on the left with figure-left and on the right with figure-right", () => {
    const left = arrange(text, "figure-left");
    expect(shape(left)).toEqual([[["figure"], ["list"]]]);
    expect(left.indexOf(FIGURE)).toBeLessThan(left.indexOf("First point"));
    const right = arrange(text, "figure-right");
    expect(shape(right)).toEqual([[["list"], ["figure"]]]);
    expect(right.indexOf("First point")).toBeLessThan(right.indexOf(FIGURE));
  });

  it("6.1e splits three items ceil(n/2) left and the rest right", () => {
    const three = doc(`  ${LIST}\n\n  ${EQUATION}\n\n  ${FIGURE}\n`);
    expect(shape(arrange(three, "two-columns"))).toEqual([[["list", "equation"], ["figure"]]]);
  });

  it("6.1e puts every figure on the figure side and the other items on the other", () => {
    const three = doc(`  ${FIGURE}\n\n  ${LIST}\n\n  ${EQUATION}\n`);
    expect(shape(arrange(three, "figure-right"))).toEqual([[["list", "equation"], ["figure"]]]);
    expect(shape(arrange(three, "figure-left"))).toEqual([[["figure"], ["list", "equation"]]]);
  });

  it("6.1e flattens the items of existing columns in column order into one column", () => {
    const columns = doc(`  \\begin{columns}[T]\n    \\begin{column}{0.48\\textwidth}\n      ${EQUATION}\n    \\end{column}\n    \\begin{column}{0.48\\textwidth}\n      ${FIGURE}\n    \\end{column}\n  \\end{columns}\n`);
    const one = arrange(columns, "one-column");
    expect(shape(one)).toEqual(["equation", "figure"]);
    expect(one).toContain(EQUATION);
    expect(one).toContain(FIGURE);
  });

  it("6.1e returns null for figure-left and figure-right when there is no figure or nothing else", () => {
    const noFigure = doc(`  ${LIST}\n\n  ${EQUATION}\n`);
    expect(arrangeSourceSlide("latex", noFigure, slideOf(noFigure), "figure-left")).toBeNull();
    expect(arrangeSourceSlide("latex", noFigure, slideOf(noFigure), "figure-right")).toBeNull();
    const onlyFigure = doc(`  ${FIGURE}\n`);
    expect(arrangeSourceSlide("latex", onlyFigure, slideOf(onlyFigure), "figure-left")).toBeNull();
    expect(arrangeSourceSlide("latex", onlyFigure, slideOf(onlyFigure), "figure-right")).toBeNull();
  });

  it("6.1e returns null when the body holds text outside every child", () => {
    const stray = doc(`  \\note{Say this slowly.}\n\n  ${LIST}\n\n  ${FIGURE}\n`);
    for (const arrangement of ["one-column", "two-columns", "figure-left", "figure-right"] as const) {
      expect(arrangeSourceSlide("latex", stray, slideOf(stray), arrangement)).toBeNull();
    }
  });

  it("6.1e counts a comment as whitespace, not as stray text", () => {
    const commented = doc(`  % remember to cite\n  ${LIST}\n\n  ${FIGURE}\n`);
    expect(arrangeSourceSlide("latex", commented, slideOf(commented), "two-columns")).not.toBeNull();
  });

  it("6.1e changes nothing outside the slide", () => {
    const two = arrange(text, "two-columns");
    expect(two.startsWith("\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{Results}")).toBe(true);
    expect(two.endsWith("\\end{frame}\n\\end{document}\n")).toBe(true);
  });

  it("6.1e gives the same text when the current arrangement is applied again", () => {
    for (const arrangement of ["one-column", "two-columns", "figure-left", "figure-right"] as const) {
      const once = arrange(text, arrangement);
      expect(arrange(once, arrangement)).toBe(once);
    }
  });

  it("6.1e puts the cursor inside the rewritten slide", () => {
    const change = arrangeSourceSlide("latex", text, slideOf(text), "two-columns")!;
    expect(change.cursor).toBeGreaterThanOrEqual(0);
    expect(change.cursor).toBeLessThanOrEqual(change.text.length);
  });
});

describe("arrangeSourceSlide on a Typst call-style slide", () => {
  const FIGURE = '#figure(image("figures/plot.png", width: 80%), caption: [Plot])';
  const doc = (body: string): string => `#slide(title: [Results])[\n${body}]\n`;
  const text = doc(`  - First point\n  - Second point\n\n  ${FIGURE}\n`);
  const slideOf = (source: string): SourceDeckNode => readSourceDeckBlocks("typst", "talk", source)[0]!;
  const arrange = (source: string, arrangement: SlideArrangement): string => arrangeSourceSlide("typst", source, slideOf(source), arrangement)!.text;
  const kinds = (source: string): string[] => slideOf(source).children!.flatMap((child) => (child.kind === "columns" ? child.children!.flatMap((column) => column.children!.map((item) => item.kind)) : [child.kind]));

  it("6.1e turns a title, a list and a figure into a two-cell #grid keeping the title and each item", () => {
    const two = arrange(text, "two-columns");
    expect(two).toContain("#slide(title: [Results])[");
    expect(two).toContain("#grid(columns: (1fr, 1fr), gutter: 1em,");
    expect(two.match(/\],/g)).toHaveLength(2);
    expect(two).toContain(FIGURE);
    expect(two).toContain("First point");
    expect(two).toContain("Second point");
    expect(two.indexOf("First point")).toBeLessThan(two.indexOf(FIGURE));
    expect(two.indexOf("],")).toBeGreaterThan(two.indexOf("Second point"));
    expect(two.indexOf("],")).toBeLessThan(two.indexOf(FIGURE));
  });

  it("6.1e turns the #grid back into one column keeping the title, the list and the figure", () => {
    const one = arrange(arrange(text, "two-columns"), "one-column");
    expect(one).not.toContain("#grid");
    expect(one).toContain("#slide(title: [Results])[");
    expect(one).toContain(FIGURE);
    expect(kinds(one)).toEqual(["list", "figure"]);
  });

  it("6.1e puts the figure in the right cell with figure-right and in the left cell with figure-left", () => {
    const right = arrange(text, "figure-right");
    expect(right.indexOf("First point")).toBeLessThan(right.indexOf("],"));
    expect(right.indexOf("],")).toBeLessThan(right.indexOf(FIGURE));
    const left = arrange(text, "figure-left");
    expect(left.indexOf(FIGURE)).toBeLessThan(left.indexOf("],"));
    expect(left.indexOf("],")).toBeLessThan(left.indexOf("First point"));
  });

  it("6.1e returns null when the body holds text outside every child", () => {
    const stray = doc(`  #speaker-note[Say this slowly.]\n\n  ${FIGURE}\n`);
    expect(arrangeSourceSlide("typst", stray, slideOf(stray), "two-columns")).toBeNull();
    expect(arrangeSourceSlide("typst", stray, slideOf(stray), "one-column")).toBeNull();
  });

  it("6.1e gives the same text when the current arrangement is applied again", () => {
    for (const arrangement of ["one-column", "two-columns", "figure-left", "figure-right"] as const) {
      const once = arrange(text, arrangement);
      expect(arrange(once, arrangement)).toBe(once);
    }
  });
});

describe("A7 core half", () => {
  it("A7 reorders and arranges a slide through the same tree the reader gives", () => {
    const text = "\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{A}\n  one\n\\end{frame}\n\\begin{frame}{B}\n  \\includegraphics{x.png}\n\n  \\[ y \\]\n\\end{frame}\n\\end{document}\n";
    const slides = readSourceDeckBlocks("latex", "talk", text);
    const moved = moveSourceDeckNodeTo(text, slides, 1, 0)!.text;
    const first = readSourceDeckBlocks("latex", "talk", moved)[0]!;
    expect(first.title).toBe("B");
    expect(sliceOf(moved, first)).toContain("includegraphics{x.png}");
    expect(arrangeSourceSlide("latex", moved, first, "figure-right")).not.toBeNull();
  });
});
