/** Contract of listing a paper's objects from PDF text, the box conversion and the table readers (PDF text, pipe tables, tabular). */
import {
  boxToRegion, formatPipeTable, listPaperObjects, parsePipeTable, readPdfPages, regionToBox, tableFromTabular, tableFromTextItems,
} from "../../src/paperObjects/index";
import { item, samplePages } from "./fixtures";

const fourDecimals = (n: number): boolean => Math.abs(n * 10_000 - Math.round(n * 10_000)) < 1e-6;

describe("listPaperObjects", () => {
  it("finds the equation, figure and table in document order, first occurrence winning", () => {
    const objects = listPaperObjects(samplePages());
    expect(objects.map(({ kind, label, page, caption }) => ({ kind, label, page, caption }))).toEqual([
      { kind: "equation", label: "3", page: 1, caption: "E = mc^2 (3)" },
      { kind: "figure", label: "2", page: 1, caption: "Figure 2. A plot of things." },
      { kind: "table", label: "1", page: 2, caption: "Table 1: Results of the study" },
    ]);
    for (const { box } of objects) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(1);
      expect(box.y + box.h).toBeLessThanOrEqual(1);
      expect([box.x, box.y, box.w, box.h].every(fourDecimals)).toBe(true);
    }
  });

  it("reads nothing past page 150 and skips pages without a size", () => {
    const [first] = samplePages();
    expect(listPaperObjects([{ ...first!, pageNumber: 151 }, { ...first!, width: 0 }])).toEqual([]);
  });
});

describe("box conversion", () => {
  it("turns a PDF region into fractions from the top-left and back", () => {
    const box = regionToBox({ x0: 60, x1: 540, yTop: 700, yBottom: 500 }, 600, 800);
    expect(box).toEqual({ x: 0.1, y: 0.125, w: 0.8, h: 0.25 });
    expect(boxToRegion(box, 600, 800)).toEqual({ x0: 60, x1: 540, yTop: 700, yBottom: 500 });
  });

  it("clamps to the page and rounds to 4 decimals", () => {
    expect(regionToBox({ x0: -10, x1: 700, yTop: 900, yBottom: 100 / 3 }, 600, 800)).toEqual({ x: 0, y: 0, w: 1, h: 0.9583 });
  });
});

describe("readPdfPages", () => {
  it("maps pdf.js items like the reader and leaves out a page whose text fails", async () => {
    const doc = {
      numPages: 3,
      getPage: async (n: number) => ({
        getViewport: () => ({ width: 600, height: 800 }),
        getTextContent: async () => {
          if (n === 2) { throw new Error("broken"); }
          return { items: [{ str: "Hi", transform: [1, 0, 0, 12, 50, 700], width: 20, height: 12 }, { type: "beginMarkedContent" }] };
        },
      }),
    };
    const pages = await readPdfPages(doc, 2);
    expect(pages).toEqual([{ pageNumber: 1, width: 600, height: 800, items: [{ str: "Hi", x: 50, y: 700, width: 20, height: 12, orientation: 0 }] }]);
  });
});

describe("tableFromTextItems", () => {
  it("reads a 3x3 table under its caption, caption left out", () => {
    const table = listPaperObjects(samplePages()).find((o) => o.kind === "table")!;
    const page = samplePages()[1]!;
    expect(tableFromTextItems(page.items, boxToRegion(table.box, 600, 800))).toEqual([
      ["Method", "Acc", "Time"],
      ["Ours", "91.2", "3.1"],
      ["Base", "88.0", "2.9"],
    ]);
  });

  it("joins a header set on two lines", () => {
    const items = [
      item("Accuracy", 250, 700, 50), item("Time", 400, 700, 30),
      item("Method", 72, 688, 50), item("(%)", 255, 688, 20), item("(s)", 405, 688, 15),
      item("Ours", 72, 674, 30), item("91.2", 250, 674, 30), item("3.1", 400, 674, 20),
      item("Base", 72, 660, 30), item("88.0", 250, 660, 30), item("2.9", 400, 660, 20),
    ];
    expect(tableFromTextItems(items, { x0: 0, x1: 600, yTop: 720, yBottom: 640 })).toEqual([
      ["Method", "Accuracy (%)", "Time (s)"],
      ["Ours", "91.2", "3.1"],
      ["Base", "88.0", "2.9"],
    ]);
  });

  it("returns null for a paragraph of prose", () => {
    const words = ["The", "results", "show", "that", "the", "method", "works", "well"];
    const items = [700, 686, 672, 658].flatMap((y, row) => {
      let x = 72 + row * 7;
      return words.map((w) => { const it = item(w, x, y, w.length * 5); x += w.length * 5 + 3; return it; });
    });
    expect(tableFromTextItems(items, { x0: 0, x1: 600, yTop: 720, yBottom: 640 })).toBeNull();
  });
});

describe("pipe tables", () => {
  it("writes a header, a separator and escaped pipes outside math", () => {
    const rows = [["a", "b|c"], ["$|x|$", "1"]];
    const text = formatPipeTable(rows);
    expect(text).toBe("| a     | b\\|c |\n| ----- | ---- |\n| $|x|$ | 1    |");
    expect(parsePipeTable(text)).toEqual(rows);
  });

  it("pads short rows and rejects text that is not one clean table", () => {
    expect(formatPipeTable([["a", "b"], ["c"]])).toBe("| a   | b   |\n| --- | --- |\n| c   |     |");
    expect(parsePipeTable("a | b\nno separator")).toBeNull();
    expect(parsePipeTable("| a | b |\n| --- | --- |\n| 1 | 2 | 3 |")).toBeNull();
    expect(parsePipeTable("Just prose.")).toBeNull();
  });
});

describe("tableFromTabular", () => {
  const tex = String.raw`
\begin{table}[h]\begin{tabular}{ll} a & b \\ c & d \end{tabular}\end{table}
\begin{figure}\caption{A figure}\end{figure}
\begin{table}[t]\centering
\begin{tabular}{lcc}
\toprule
\textbf{Model} & BLEU & $\Delta$ \\
\midrule
\multicolumn{2}{c}{Base} & $+0.1$ \\
Ours & \emph{28.4} & $|x|$ \\ \bottomrule
\end{tabular}
\caption{Results} % a comment with \begin{table}
\end{table}
\begin{table*}\caption{Second}\begin{tabularx}{\linewidth}{XX} x \& y & 50\% \\ \hline 1 & 2 \end{tabularx}\end{table*}
`;

  it("reads the Nth captioned table environment", () => {
    expect(tableFromTabular(tex, "1")).toEqual([["Model", "BLEU", "$\\Delta$"], ["Base", "", "$+0.1$"], ["Ours", "28.4", "$|x|$"]]);
    expect(tableFromTabular(tex, "2")).toEqual([["x & y", "50%"], ["1", "2"]]);
  });

  it("gives up on labels it cannot count and on what it cannot parse", () => {
    expect(tableFromTabular(tex, "2.1")).toBeNull();
    expect(tableFromTabular(tex, "1a")).toBeNull();
    expect(tableFromTabular(tex, "3")).toBeNull();
    expect(tableFromTabular(String.raw`\begin{table}\caption{x}\begin{tabular}{ll} \textbf{a & b \\ c & d \end{tabular}\end{table}`, "1")).toBeNull();
  });
});
