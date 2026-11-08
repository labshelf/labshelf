// Tests reading and writing the layout of a compiled (tikzposter, beamerposter, Typst) poster as source edits: block moves, column ratios, spacing, orientation, overflow.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceDeckBlocks } from "../../src/decks/index.js";
import type { SourceDeckChange } from "../../src/decks/sourceDeckEdit.js";
import {
  moveSourcePosterBlock, overflowingPosterBlocks, readSourcePosterLayout, resizeSourcePosterGap, setSourcePosterRatios, setSourcePosterSpacing,
  switchSourcePosterOrientation,
} from "../../src/decks/sourceDeckPoster.js";

type Format = "latex" | "typst";

const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");
const TIKZ = fixture("a1-tikz.tex");
const BEAMER = fixture("beamerposter.tex");
const TYPST = fixture("typst-a0.typ");

/** The block titles of each poster column, read back from the text. */
const columnTitles = (format: Format, text: string): Array<Array<string | undefined>> =>
  readSourceDeckBlocks(format, "poster", text).filter((node) => node.kind === "column").map((column) => (column.children ?? []).filter((child) => child.kind === "block").map((child) => child.title));
/** Every non-blank line, trimmed and sorted: a move keeps whole lines, so this does not change. */
const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter(Boolean).sort();
const ok = (change: SourceDeckChange | null): string => {
  expect(change).not.toBeNull();
  return change!.text;
};

const TYPST_GRID = `#set page(width: 841mm, height: 1189mm, margin: 3cm)
#grid(columns: (1fr, 2fr), gutter: 3cm,
  [
    = Introduction
    Intro text.
  ],
  [
    = Results
    Results text.
  ],
)
`;

/** A Typst grid poster with two blocks in each cell. */
const TYPST_GRID_4 = `#set page(width: 841mm, height: 1189mm, margin: 3cm)
#grid(columns: (1fr, 1fr), gutter: 3cm,
  [
    = Alpha
    Alpha text.

    = Beta
    Beta text.
  ],
  [
    = Gamma
    Gamma text.

    = Delta
    Delta text.
  ],
)
`;

const TIKZ_3 = `\\documentclass[25pt, a1paper, portrait]{tikzposter}
\\begin{document}
\\begin{columns}
  \\column{0.33}
  \\block{A}{
    a
  }
  \\column{0.33}
  \\block{B}{
    b
  }
  \\column{0.34}
  \\block{C}{
    c
  }
\\end{columns}
\\end{document}
`;

const widths = (format: Format, text: string): Array<number | undefined> =>
  readSourceDeckBlocks(format, "poster", text).filter((node) => node.kind === "column").map((column) => column.props.columnWidth);

describe("10b.1 Core compiled-poster layout", () => {
  describe("readSourcePosterLayout", () => {
    it("10b.1a reads ratios, spacing defaults and orientation of the tikzposter fixture", () => {
      expect(readSourcePosterLayout("latex", TIKZ)).toEqual({ format: "latex", template: "tikzposter", ratios: [0.5, 0.5], columnsCall: null, margin: 0, gap: 15, landscape: true });
    });

    it("10b.1a reads the tikzposter margin, colspace and blockverticalspace options as millimetres", () => {
      const text = TIKZ.replace("[25pt, a1paper, landscape]", "[25pt, a1paper, portrait, margin=2cm, colspace=12mm, blockverticalspace=12mm]");
      expect(readSourcePosterLayout("latex", text)).toMatchObject({ margin: 20, gap: 12, landscape: false });
    });

    it("10b.1a reads the beamerposter fixture: ratios from the column widths, no margin or gap, portrait", () => {
      expect(readSourcePosterLayout("latex", BEAMER)).toEqual({ format: "latex", template: "beamerposter", ratios: [0.45, 0.45], columnsCall: null, margin: null, gap: null, landscape: false });
    });

    it("10b.1a reads orientation=landscape from the beamerposter options", () => {
      expect(readSourcePosterLayout("latex", BEAMER.replace("size=a0,scale=1.4", "size=a0,orientation=landscape"))).toMatchObject({ landscape: true });
    });

    it("10b.1a reads the Typst #columns fixture: equal ratios, columns call, page margin and gutter, portrait", () => {
      const layout = readSourcePosterLayout("typst", TYPST)!;
      expect(layout).toMatchObject({ format: "typst", template: "typst", columnsCall: "columns", margin: 30, gap: 30, landscape: false });
      expect(layout.ratios).toHaveLength(2);
      expect(layout.ratios![0]).toBe(layout.ratios![1]);
    });

    it("10b.1a reads a Typst #grid poster: the fr tracks as ratios", () => {
      expect(readSourcePosterLayout("typst", TYPST_GRID)).toEqual({ format: "typst", template: "typst", ratios: [1, 2], columnsCall: "grid", margin: 30, gap: 30, landscape: false });
    });

    it("10b.1a reads an integer #grid columns count as that many 1s and a non-fr track as null ratios", () => {
      const cells = "  [\n    = A\n    a\n  ],\n  [\n    = B\n    b\n  ],\n  [\n    = C\n    c\n  ],\n)\n";
      expect(readSourcePosterLayout("typst", `#set page(width: 841mm, height: 1189mm)\n#grid(columns: 3, gutter: 1cm,\n${cells}`)!.ratios).toEqual([1, 1, 1]);
      const mixed = readSourcePosterLayout("typst", `#set page(width: 841mm, height: 1189mm)\n#grid(columns: (1fr, 5cm), gutter: 1cm,\n${cells.split("  [\n    = C")[0]})\n`);
      expect(mixed).not.toBeNull();
      expect(mixed!.ratios).toBeNull();
      expect(mixed!.columnsCall).toBe("grid");
    });

    it("10b.1a reads a missing #grid gutter as 0 and a missing #columns gutter as null", () => {
      expect(readSourcePosterLayout("typst", TYPST_GRID.replace(" gutter: 3cm,", ""))!.gap).toBe(0);
      expect(readSourcePosterLayout("typst", TYPST.replace("#columns(2, gutter: 3cm)", "#columns(2)"))!.gap).toBeNull();
    });

    it("10b.1a reads a dictionary page margin as null and still reads the rest of the page call", () => {
      const text = TYPST.replace("#set page(width: 841mm, height: 1189mm, margin: 3cm)", "#set page(margin: (x: 3cm, y: 2cm), width: 1189mm, height: 841mm)");
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ margin: null, landscape: true });
    });

    it("10b.1a reads a Typst page with a paper name and flipped as landscape", () => {
      expect(readSourcePosterLayout("typst", TYPST.replace("width: 841mm, height: 1189mm, margin: 3cm", "\"a0\", margin: 3cm"))!.landscape).toBe(false);
      expect(readSourcePosterLayout("typst", TYPST.replace("width: 841mm, height: 1189mm, margin: 3cm", "\"a0\", flipped: true, margin: 3cm"))!.landscape).toBe(true);
    });

    it("10b.1a returns null for a talk, an unknown template and a poster with no column structure, and never throws", () => {
      expect(readSourcePosterLayout("latex", fixture("defesa-beamer.tex"))).toBeNull();
      expect(readSourcePosterLayout("typst", fixture("typst-relampago.typ"))).toBeNull();
      expect(readSourcePosterLayout("latex", "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n")).toBeNull();
      expect(readSourcePosterLayout("typst", "#set page(width: 841mm, height: 1189mm)\n= Title\nBody.\n")).toBeNull();
      for (const format of ["latex", "typst"] as const) for (const text of ["", "\\begin{", "#grid(columns: (", "#columns(", "]]]]"]) expect(() => readSourcePosterLayout(format, text)).not.toThrow();
    });
  });

  describe("moveSourcePosterBlock", () => {
    it("10b.1b moves a LaTeX block to another column at an index and the reparsed tree shows it there", () => {
      const text = ok(moveSourcePosterBlock("latex", TIKZ, { column: 0, index: 1 }, { column: 1, index: 0 }));
      expect(columnTitles("latex", text)).toEqual([["Introduction"], ["Method", "Results", "Conclusion"]]);
      expect(lines(text)).toEqual(lines(TIKZ));
    });

    it("10b.1b moves a LaTeX block into the middle of another column", () => {
      const text = ok(moveSourcePosterBlock("latex", TIKZ, { column: 1, index: 1 }, { column: 0, index: 1 }));
      expect(columnTitles("latex", text)).toEqual([["Introduction", "Conclusion", "Method"], ["Results"]]);
    });

    it("10b.1b clamps a target index past the end of the column to after its last block", () => {
      const text = ok(moveSourcePosterBlock("latex", TIKZ, { column: 0, index: 0 }, { column: 1, index: 99 }));
      expect(columnTitles("latex", text)).toEqual([["Method"], ["Results", "Conclusion", "Introduction"]]);
    });

    it("10b.1b moves a LaTeX block within its column", () => {
      const text = ok(moveSourcePosterBlock("latex", TIKZ, { column: 1, index: 1 }, { column: 1, index: 0 }));
      expect(columnTitles("latex", text)).toEqual([["Introduction", "Method"], ["Conclusion", "Results"]]);
      expect(lines(text)).toEqual(lines(TIKZ));
    });

    it("10b.1b moves a beamerposter block to the other column", () => {
      const text = ok(moveSourcePosterBlock("latex", BEAMER, { column: 0, index: 0 }, { column: 1, index: 0 }));
      expect(columnTitles("latex", text)).toEqual([[], ["Introduction", "Results"]]);
      expect(lines(text)).toEqual(lines(BEAMER));
    });

    it("10b.1b moves a block into an empty LaTeX column", () => {
      const text = "\\documentclass[25pt, a1paper, portrait]{tikzposter}\n\\begin{document}\n\\begin{columns}\n  \\column{0.5}\n  \\block{A}{\n    a\n  }\n  \\block{B}{\n    b\n  }\n  \\column{0.5}\n\\end{columns}\n\\end{document}\n";
      const moved = ok(moveSourcePosterBlock("latex", text, { column: 0, index: 0 }, { column: 1, index: 0 }));
      expect(columnTitles("latex", moved)).toEqual([["B"], ["A"]]);
      expect(lines(moved)).toEqual(lines(text));
    });

    it("10b.1b re-bases the moved block's indentation to the target column's", () => {
      const text = "\\documentclass[25pt, a1paper, portrait]{tikzposter}\n\\begin{document}\n\\begin{columns}\n  \\column{0.5}\n  \\block{A}{\n    a text\n  }\n  \\column{0.5}\n      \\block{B}{\n        b text\n      }\n\\end{columns}\n\\end{document}\n";
      const moved = ok(moveSourcePosterBlock("latex", text, { column: 0, index: 0 }, { column: 1, index: 0 }));
      expect(moved).toContain("      \\block{A}{\n        a text\n      }\n      \\block{B}{\n        b text\n      }\n");
      expect(columnTitles("latex", moved)).toEqual([[], ["A", "B"]]);
    });

    it("10b.1b moves a Typst block, heading and body, to another column", () => {
      const text = ok(moveSourcePosterBlock("typst", TYPST, { column: 0, index: 1 }, { column: 1, index: 0 }));
      expect(columnTitles("typst", text)).toEqual([["Introduction"], ["Method", "Results", "Conclusion"]]);
      expect(lines(text)).toEqual(lines(TYPST));
      const method = readSourceDeckBlocks("typst", "poster", text)[1]!.children![0]!;
      expect(method.title).toBe("Method");
      expect(method.children?.map((child) => child.kind)).toEqual(["equation"]);
    });

    it("10b.1b moves a Typst block to the end of the previous column", () => {
      const text = ok(moveSourcePosterBlock("typst", TYPST, { column: 1, index: 0 }, { column: 0, index: 2 }));
      expect(columnTitles("typst", text)).toEqual([["Introduction", "Method", "Results"], ["Conclusion"]]);
      expect(lines(text)).toEqual(lines(TYPST));
    });

    it("10b.1b moves a Typst block within its column", () => {
      const text = ok(moveSourcePosterBlock("typst", TYPST, { column: 1, index: 1 }, { column: 1, index: 0 }));
      expect(columnTitles("typst", text)).toEqual([["Introduction", "Method"], ["Conclusion", "Results"]]);
    });

    it("10b.1b moves a block between the cells of a Typst #grid", () => {
      const text = ok(moveSourcePosterBlock("typst", TYPST_GRID_4, { column: 0, index: 0 }, { column: 1, index: 1 }));
      expect(columnTitles("typst", text)).toEqual([["Beta"], ["Gamma", "Alpha", "Delta"]]);
      expect(lines(text)).toEqual(lines(TYPST_GRID_4));
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ columnsCall: "grid", ratios: [1, 1] });
    });

    it("10b.1b returns null when an index is out of range", () => {
      for (const [from, to] of [
        [{ column: 5, index: 0 }, { column: 0, index: 0 }],
        [{ column: 0, index: 9 }, { column: 1, index: 0 }],
        [{ column: -1, index: 0 }, { column: 1, index: 0 }],
        [{ column: 0, index: 0 }, { column: 9, index: 0 }],
      ] as const) {
        expect(moveSourcePosterBlock("latex", TIKZ, from, to)).toBeNull();
        expect(moveSourcePosterBlock("typst", TYPST, from, to)).toBeNull();
      }
    });

    it("10b.1b returns null when the block would stay where it is", () => {
      expect(moveSourcePosterBlock("latex", TIKZ, { column: 0, index: 1 }, { column: 0, index: 1 })).toBeNull();
      expect(moveSourcePosterBlock("typst", TYPST, { column: 1, index: 0 }, { column: 1, index: 0 })).toBeNull();
    });
  });

  describe("setSourcePosterRatios", () => {
    it("10b.1c writes LaTeX tikzposter column fractions normalised to sum 1 and changes nothing else", () => {
      const text = ok(setSourcePosterRatios("latex", TIKZ, [1, 3]));
      expect(text).toBe(TIKZ.replace("\\column{0.5}", "\\column{0.25}").replace("\\column{0.5}", "\\column{0.75}"));
    });

    it("10b.1c gives the last LaTeX column the remainder so the fractions sum to exactly 1.00", () => {
      const text = ok(setSourcePosterRatios("latex", TIKZ_3, [1, 1, 1]));
      const written = widths("latex", text) as number[];
      expect(written.slice(0, 2)).toEqual([0.33, 0.33]);
      expect(written[2]).toBe(0.34);
      expect(Math.round(written.reduce((sum, value) => sum + value, 0) * 100)).toBe(100);
    });

    it("10b.1c replaces only the number of a beamerposter column width and keeps \\textwidth", () => {
      const text = ok(setSourcePosterRatios("latex", BEAMER, [1, 3]));
      expect(widths("latex", text)).toEqual([0.25, 0.75]);
      expect(text.match(/\\textwidth/g)).toHaveLength(2);
      expect(text.match(/\\begin\{column\}\{[\d.]+\\textwidth\}/g)).toHaveLength(2);
      expect(lines(text.replace(/\{0\.\d+\\textwidth\}/g, "{W}"))).toEqual(lines(BEAMER.replace(/\{0\.\d+\\textwidth\}/g, "{W}")));
    });

    it("10b.1c writes Typst grid fr tracks normalised to sum the column count", () => {
      const text = ok(setSourcePosterRatios("typst", TYPST_GRID, [1, 3]));
      expect(text).toContain("#grid(columns: (0.5fr, 1.5fr), gutter: 3cm,");
      expect(text.replace("(0.5fr, 1.5fr)", "(1fr, 2fr)")).toBe(TYPST_GRID);
    });

    it("10b.1c writes equal Typst ratios as 1fr tracks without trailing zeros", () => {
      expect(ok(setSourcePosterRatios("typst", TYPST_GRID, [2, 2]))).toContain("columns: (1fr, 1fr)");
    });

    it("10b.1c writes a single Typst column as (1fr,)", () => {
      const single = "#set page(width: 841mm, height: 1189mm)\n#grid(columns: (1fr,), gutter: 3cm,\n  [\n    = A\n    a\n  ],\n)\n";
      expect(ok(setSourcePosterRatios("typst", single, [5]))).toContain("columns: (1fr,)");
    });

    it("10b.1c rewrites a Typst #columns call as a #grid with one cell per column", () => {
      const text = ok(setSourcePosterRatios("typst", TYPST, [1, 3]));
      expect(text).toContain("#grid(columns: (0.5fr, 1.5fr), gutter: 3cm,");
      expect(text).not.toContain("#columns(");
      expect(text).not.toContain("#colbreak()");
      expect(text.slice(0, text.indexOf("#grid("))).toBe(TYPST.slice(0, TYPST.indexOf("#columns(")));
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ columnsCall: "grid", ratios: [0.5, 1.5], gap: 30, margin: 30 });
      expect(columnTitles("typst", text)).toEqual([["Introduction", "Method"], ["Results", "Conclusion"]]);
    });

    it("10b.1c returns null unless there is one positive ratio per existing column", () => {
      for (const ratios of [[1], [1, 1, 1], [], [1, 0], [1, -1], [Number.NaN, 1]]) {
        expect(setSourcePosterRatios("latex", TIKZ, ratios)).toBeNull();
        expect(setSourcePosterRatios("typst", TYPST, ratios)).toBeNull();
      }
    });
  });

  describe("resizeSourcePosterGap", () => {
    // Typst page 841mm, margin 3cm, gutter 3cm, two columns: the column area is 841 - 60 - 30 = 751mm, 10% of it 75.1mm.
    it("10b.1c moves width from the column after the gap to the column before it in a Typst #grid", () => {
      const text = ok(resizeSourcePosterGap("typst", TYPST_GRID_4, 0, 75.1));
      expect(text).toContain("columns: (1.2fr, 0.8fr)");
    });

    it("10b.1c moves width the other way for a negative delta", () => {
      expect(ok(resizeSourcePosterGap("typst", TYPST_GRID_4, 0, -75.1))).toContain("columns: (0.8fr, 1.2fr)");
    });

    it("10b.1c converts a Typst #columns call to a #grid when the gap is resized", () => {
      const text = ok(resizeSourcePosterGap("typst", TYPST, 0, 75.1));
      expect(text).toContain("columns: (1.2fr, 0.8fr)");
      expect(text).not.toContain("#columns(");
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ columnsCall: "grid", ratios: [1.2, 0.8] });
    });

    it("10b.1c keeps at least 10% of the column area in each Typst column", () => {
      expect(ok(resizeSourcePosterGap("typst", TYPST_GRID_4, 0, 100000))).toContain("columns: (1.8fr, 0.2fr)");
      expect(ok(resizeSourcePosterGap("typst", TYPST_GRID_4, 0, -100000))).toContain("columns: (0.2fr, 1.8fr)");
    });

    it("10b.1c writes LaTeX fractions that sum to 1 from the paper width, margin and gap", () => {
      // a1 portrait is 594mm wide: area 594 - 2*20 - 10 = 544mm, and 10% of it 54.4mm.
      const base = TIKZ.replace("[25pt, a1paper, landscape]", "[25pt, a1paper, portrait, margin=20mm, colspace=10mm, blockverticalspace=10mm]");
      const text = ok(resizeSourcePosterGap("latex", base, 0, 54.4));
      expect(widths("latex", text)).toEqual([0.6, 0.4]);
    });

    it("10b.1c keeps at least 10% of the column area in each LaTeX column", () => {
      expect(widths("latex", ok(resizeSourcePosterGap("latex", TIKZ, 0, 100000)))).toEqual([0.9, 0.1]);
      expect(widths("latex", ok(resizeSourcePosterGap("latex", TIKZ, 0, -100000)))).toEqual([0.1, 0.9]);
    });

    it("10b.1c returns null when the gap index is out of range", () => {
      for (const gap of [-1, 1, 5]) {
        expect(resizeSourcePosterGap("latex", TIKZ, gap, 10)).toBeNull();
        expect(resizeSourcePosterGap("typst", TYPST_GRID_4, gap, 10)).toBeNull();
      }
    });

    it("10b.1c returns null when the Typst page width is unknown", () => {
      expect(resizeSourcePosterGap("typst", TYPST_GRID_4.replace("width: 841mm, height: 1189mm, ", ""), 0, 10)).toBeNull();
    });
  });

  describe("setSourcePosterSpacing", () => {
    it("10b.1d writes tikzposter margin, colspace and blockverticalspace in mm and keeps the other options in order", () => {
      const text = ok(setSourcePosterSpacing("latex", TIKZ, { margin: 20, gap: 12 }));
      const options = /\\documentclass\[([^\]]*)\]\{tikzposter\}/.exec(text)![1]!.split(",").map((option) => option.trim());
      expect(options.slice(0, 3)).toEqual(["25pt", "a1paper", "landscape"]);
      expect(options.slice(3).sort()).toEqual(["blockverticalspace=12mm", "colspace=12mm", "margin=20mm"]);
      expect(text.split("\n").filter((line) => !line.startsWith("\\documentclass"))).toEqual(TIKZ.split("\n").filter((line) => !line.startsWith("\\documentclass")));
      expect(readSourcePosterLayout("latex", text)).toMatchObject({ margin: 20, gap: 12, landscape: true });
    });

    it("10b.1d replaces an existing tikzposter spacing key instead of repeating it", () => {
      const once = ok(setSourcePosterSpacing("latex", TIKZ, { margin: 20, gap: 12 }));
      const twice = ok(setSourcePosterSpacing("latex", once, { margin: 30 }));
      expect(twice.match(/margin=/g)).toHaveLength(1);
      expect(readSourcePosterLayout("latex", twice)).toMatchObject({ margin: 30, gap: 12 });
    });

    it("10b.1d writes only the margin when only the margin changes", () => {
      const text = ok(setSourcePosterSpacing("latex", TIKZ, { margin: 5 }));
      expect(text).toContain("margin=5mm");
      expect(text).not.toContain("colspace");
      expect(text).not.toContain("blockverticalspace");
    });

    it("10b.1d writes the Typst page margin and #columns gutter in cm when the source used cm", () => {
      const text = ok(setSourcePosterSpacing("typst", TYPST, { margin: 20, gap: 15 }));
      expect(text).toContain("margin: 2cm");
      expect(text).toContain("gutter: 1.5cm");
      expect(text).toContain("width: 841mm, height: 1189mm");
      expect(text).toContain("#columns(2, gutter: 1.5cm)");
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ margin: 20, gap: 15, columnsCall: "columns" });
    });

    it("10b.1d writes mm when the Typst source used mm", () => {
      const mm = TYPST.replace("margin: 3cm", "margin: 30mm").replace("gutter: 3cm", "gutter: 30mm");
      const text = ok(setSourcePosterSpacing("typst", mm, { margin: 20, gap: 15 }));
      expect(text).toContain("margin: 20mm");
      expect(text).toContain("gutter: 15mm");
    });

    it("10b.1d writes the gutter of a Typst #grid", () => {
      const text = ok(setSourcePosterSpacing("typst", TYPST_GRID, { gap: 10 }));
      expect(text).toContain("gutter: 1cm");
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ gap: 10, columnsCall: "grid", ratios: [1, 2] });
    });

    it("10b.1d adds a gutter to a Typst call that has none", () => {
      expect(readSourcePosterLayout("typst", ok(setSourcePosterSpacing("typst", TYPST_GRID.replace(" gutter: 3cm,", ""), { gap: 10 })))).toMatchObject({ gap: 10 });
      const columns = ok(setSourcePosterSpacing("typst", TYPST.replace("#columns(2, gutter: 3cm)", "#columns(2)"), { gap: 10 }));
      expect(readSourcePosterLayout("typst", columns)).toMatchObject({ gap: 10, columnsCall: "columns" });
    });

    it("10b.1d keeps other page arguments that hold commas inside parentheses", () => {
      const text = ok(setSourcePosterSpacing("typst", TYPST.replace("margin: 3cm)", "margin: 3cm, fill: rgb(255, 255, 255))"), { margin: 20 }));
      expect(text).toContain("fill: rgb(255, 255, 255)");
      expect(text).toContain("margin: 2cm");
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ margin: 20 });
    });

    it("10b.1d does not write a Typst dictionary margin", () => {
      const text = TYPST.replace("margin: 3cm)", "margin: (x: 3cm, y: 2cm))");
      expect(setSourcePosterSpacing("typst", text, { margin: 20 })).toBeNull();
    });

    it("10b.1d returns null for beamerposter", () => {
      expect(setSourcePosterSpacing("latex", BEAMER, { margin: 10 })).toBeNull();
      expect(setSourcePosterSpacing("latex", BEAMER, { gap: 10 })).toBeNull();
    });

    it("10b.1d returns null for values that are negative or not finite", () => {
      for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(setSourcePosterSpacing("latex", TIKZ, { margin: value })).toBeNull();
        expect(setSourcePosterSpacing("latex", TIKZ, { gap: value })).toBeNull();
        expect(setSourcePosterSpacing("typst", TYPST, { margin: value })).toBeNull();
        expect(setSourcePosterSpacing("typst", TYPST, { gap: value })).toBeNull();
      }
    });
  });

  describe("switchSourcePosterOrientation", () => {
    it("10b.1e swaps landscape for portrait in the tikzposter options and back again", () => {
      const portrait = ok(switchSourcePosterOrientation("latex", TIKZ));
      expect(portrait).toContain("\\documentclass[25pt, a1paper, portrait]{tikzposter}");
      expect(readSourcePosterLayout("latex", portrait)).toMatchObject({ landscape: false, ratios: [0.5, 0.5] });
      expect(ok(switchSourcePosterOrientation("latex", portrait))).toBe(TIKZ);
    });

    it("10b.1e reads a tikzposter with neither option as portrait and switches it to landscape", () => {
      const text = ok(switchSourcePosterOrientation("latex", TIKZ.replace("[25pt, a1paper, landscape]", "[25pt, a1paper]")));
      expect(readSourcePosterLayout("latex", text)!.landscape).toBe(true);
      expect(text).toContain("landscape");
    });

    it("10b.1e sets orientation=landscape in the beamerposter options and back to portrait", () => {
      const landscape = ok(switchSourcePosterOrientation("latex", BEAMER));
      expect(landscape).toContain("orientation=landscape");
      expect(landscape).toContain("size=a0");
      expect(landscape).toContain("scale=1.4");
      expect(readSourcePosterLayout("latex", landscape)).toMatchObject({ landscape: true, ratios: [0.45, 0.45] });
      const portrait = ok(switchSourcePosterOrientation("latex", landscape));
      expect(readSourcePosterLayout("latex", portrait)!.landscape).toBe(false);
      expect(portrait).not.toContain("orientation=landscape");
    });

    it("10b.1e swaps the width and height of the Typst page and back again", () => {
      const landscape = ok(switchSourcePosterOrientation("typst", TYPST));
      expect(landscape).toContain("#set page(width: 1189mm, height: 841mm, margin: 3cm)");
      expect(readSourcePosterLayout("typst", landscape)).toMatchObject({ landscape: true, margin: 30, gap: 30 });
      expect(ok(switchSourcePosterOrientation("typst", landscape))).toBe(TYPST);
    });

    it("10b.1e toggles flipped on a Typst page with a paper name", () => {
      const named = TYPST.replace("width: 841mm, height: 1189mm, margin: 3cm", "\"a0\", margin: 3cm");
      const flipped = ok(switchSourcePosterOrientation("typst", named));
      expect(flipped).toContain("flipped: true");
      expect(readSourcePosterLayout("typst", flipped)!.landscape).toBe(true);
      expect(readSourcePosterLayout("typst", ok(switchSourcePosterOrientation("typst", flipped)))!.landscape).toBe(false);
      const keyed = TYPST.replace("width: 841mm, height: 1189mm, margin: 3cm", "paper: \"a0\", margin: 3cm");
      expect(readSourcePosterLayout("typst", ok(switchSourcePosterOrientation("typst", keyed)))!.landscape).toBe(true);
    });

    it("10b.1e leaves the column ratios, spacing and content alone", () => {
      for (const [format, text] of [["latex", TIKZ], ["typst", TYPST], ["typst", TYPST_GRID]] as const) {
        const switched = ok(switchSourcePosterOrientation(format, text));
        const before = readSourcePosterLayout(format, text)!;
        const after = readSourcePosterLayout(format, switched)!;
        expect({ ...after, landscape: before.landscape }).toEqual(before);
        expect(after.landscape).toBe(!before.landscape);
        expect(columnTitles(format, switched)).toEqual(columnTitles(format, text));
      }
    });
  });

  describe("overflowingPosterBlocks", () => {
    // a1-tikz.tex blocks by line: Introduction 17-19, Method 20-22 (column 0), Results 25-27, Conclusion 28-30 (column 1).
    const latexTree = readSourceDeckBlocks("latex", "poster", TIKZ);
    const typstTree = readSourceDeckBlocks("typst", "poster", TYPST);

    it("10b.1f maps an Overfull vbox line to the key of the block holding it", () => {
      expect(overflowingPosterBlocks(latexTree, [{ file: "main.tex", line: 21 }], "main.tex", 1)).toEqual(["0.1"]);
      expect(overflowingPosterBlocks(latexTree, [{ file: "main.tex", line: 26 }], "main.tex", 1)).toEqual(["1.0"]);
    });

    it("10b.1f returns every block that holds a mark, the first and last line of a block included", () => {
      const marks = [{ file: "main.tex", line: 17 }, { file: "main.tex", line: 19 }, { file: "main.tex", line: 30 }];
      expect([...overflowingPosterBlocks(latexTree, marks, "main.tex", 1)].sort()).toEqual(["0.0", "1.1"]);
    });

    it("10b.1f ignores marks outside every block and marks in other files", () => {
      expect(overflowingPosterBlocks(latexTree, [{ file: "main.tex", line: 23 }, { file: "main.tex", line: 24 }, { file: "main.tex", line: 5 }], "main.tex", 1)).toEqual([]);
      expect(overflowingPosterBlocks(latexTree, [{ file: "other.tex", line: 21 }], "main.tex", 1)).toEqual([]);
    });

    it("10b.1f returns nothing for LaTeX without marks, however many pages", () => {
      expect(overflowingPosterBlocks(latexTree, [], "main.tex", 1)).toEqual([]);
      expect(overflowingPosterBlocks(latexTree, [], "main.tex", 2)).toEqual([]);
    });

    it("10b.1f returns every block of the last column when a Typst poster spills onto a second page", () => {
      expect(overflowingPosterBlocks(typstTree, [], "poster.typ", 2)).toEqual(["1.0", "1.1"]);
    });

    it("10b.1f returns nothing for a Typst poster that fits on one page", () => {
      expect(overflowingPosterBlocks(typstTree, [], "poster.typ", 1)).toEqual([]);
    });
  });

  describe("A10 compiled half", () => {
    it("A10 reorders, drags a gap, sets margins as lengths, switches orientation and finds the overflow on a Typst poster", () => {
      let text = ok(moveSourcePosterBlock("typst", TYPST, { column: 0, index: 1 }, { column: 1, index: 0 }));
      expect(columnTitles("typst", text)).toEqual([["Introduction"], ["Method", "Results", "Conclusion"]]);
      text = ok(resizeSourcePosterGap("typst", text, 0, 75.1));
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ columnsCall: "grid", ratios: [1.2, 0.8] });
      text = ok(setSourcePosterSpacing("typst", text, { margin: 20 }));
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ margin: 20, gap: 30 });
      text = ok(switchSourcePosterOrientation("typst", text));
      expect(readSourcePosterLayout("typst", text)).toMatchObject({ landscape: true, margin: 20, ratios: [1.2, 0.8] });
      expect(columnTitles("typst", text)).toEqual([["Introduction"], ["Method", "Results", "Conclusion"]]);
      expect(overflowingPosterBlocks(readSourceDeckBlocks("typst", "poster", text), [], "poster.typ", 2)).toEqual(["1.0", "1.1", "1.2"]);
    });

    it("A10 reorders, drags a gap, sets margins, switches orientation and finds the overflow on a tikzposter", () => {
      let text = ok(moveSourcePosterBlock("latex", TIKZ, { column: 1, index: 0 }, { column: 0, index: 0 }));
      expect(columnTitles("latex", text)).toEqual([["Results", "Introduction", "Method"], ["Conclusion"]]);
      text = ok(resizeSourcePosterGap("latex", text, 0, 100000));
      expect(widths("latex", text)).toEqual([0.9, 0.1]);
      text = ok(setSourcePosterSpacing("latex", text, { margin: 20, gap: 12 }));
      expect(readSourcePosterLayout("latex", text)).toMatchObject({ margin: 20, gap: 12, ratios: [0.9, 0.1], landscape: true });
      text = ok(switchSourcePosterOrientation("latex", text));
      expect(readSourcePosterLayout("latex", text)).toMatchObject({ landscape: false, margin: 20, gap: 12 });
      const tree = readSourceDeckBlocks("latex", "poster", text);
      const block = tree[0]!.children![0]!;
      expect(overflowingPosterBlocks(tree, [{ file: "main.tex", line: block.line }], "main.tex", 1)).toEqual(["0.0"]);
    });
  });
});
