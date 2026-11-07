// Tests parseLatexTable: raw LaTeX tables become a model of cells, spans, rules, alignment and caption; anything else is null.
// Also pins the width and alignment the editor writes into the LaTeX and reads back.
import { parseLatexTable, readLatexTableLayout, setLatexTableLayout, type LatexCell, type LatexInline } from "../../src/qmd/latexTable";

const BOOKTABS = String.raw`#| label: cell-1
\begin{table}[h]
  \centering
  \caption{Progressões aritméticas de primos}
  \begin{tabular}{@{}lrrl@{}}
    \toprule
    $k$ & primeiro termo & razão & observação \\
    \midrule
    3 & 3 & 2 & $3, 5, 7$ \\
    4 & 5 & 6 & $5, 11, 17, 23$ \\
    5 & 5 & 6 & $5, 11, 17, 23, 29$ \\
    10 & 199 & 210 & menor conhecida \\
    \bottomrule
  \end{tabular}
  \label{tab:pas}
\end{table}
`;

const SPANS = String.raw`#| label: cell-2
\begin{tabular}{|c|c|c|c|}
  \hline
  \multirow{2}{*}{Método} & \multicolumn{2}{c|}{Erro} & \multirow{2}{*}{Tempo (s)} \\
  \cline{2-3}
   & $L^2$ & $L^\infty$ & \\
  \hline
  Euler & $1.2 \times 10^{-2}$ & $3.4 \times 10^{-2}$ & 0.01 \\
  RK4 & $4.5 \times 10^{-7}$ & $9.8 \times 10^{-7}$ & 0.04 \\
  \hline
\end{tabular}
`;

/** A cell's content as plain text, math as `$…$`. */
const flat = (nodes: LatexInline[]): string => nodes.map((n) => (n.type === "text" ? n.text : n.type === "math" ? `$${n.tex}$` : `<${n.type}>${flat(n.children)}</${n.type}>`)).join("");
const texts = (row: LatexCell[] | undefined): string[] => (row ?? []).map((cell) => flat(cell.content));
const table = (source: string) => {
  const parsed = parseLatexTable(source);
  if (!parsed) throw new Error("expected a table");
  return parsed;
};

describe("parseLatexTable booktabs table", () => {
  const t = table(BOOKTABS);

  it("reads the caption above the rows, dropping the label and option lines", () => {
    expect(t.caption && flat(t.caption)).toBe("Progressões aritméticas de primos");
    expect(t.captionPosition).toBe("above");
  });

  it("reads the column alignment from lrrl with @{} ignored", () => {
    expect(t.columns.map((c) => c.align)).toEqual(["left", "right", "right", "left"]);
  });

  it("reads the cells with their math", () => {
    expect(t.rows).toHaveLength(5);
    expect(texts(t.rows[0])).toEqual(["$k$", "primeiro termo", "razão", "observação"]);
    expect(texts(t.rows[4])).toEqual(["10", "199", "210", "menor conhecida"]);
    expect(t.rows[1]?.[3]?.content).toEqual([{ type: "math", tex: "3, 5, 7" }]);
  });

  it("places toprule above the first row, midrule above the second and bottomrule under the last", () => {
    expect(t.rules).toHaveLength(6);
    expect(t.rules[0]).toEqual([{ kind: "toprule", from: 1, to: 4 }]);
    expect(t.rules[1]).toEqual([{ kind: "midrule", from: 1, to: 4 }]);
    expect(t.rules[2]).toEqual([]);
    expect(t.rules[5]).toEqual([{ kind: "bottomrule", from: 1, to: 4 }]);
  });

  it("has no vertical bars", () => {
    expect(t.rows.flat().every((cell) => cell.leftRule === 0 && cell.rightRule === 0)).toBe(true);
  });
});

describe("parseLatexTable multirow and multicolumn table", () => {
  const t = table(SPANS);

  it("reads four centred columns", () => {
    expect(t.columns.map((c) => c.align)).toEqual(["center", "center", "center", "center"]);
  });

  it("reads the spans and drops the cells a multirow covers", () => {
    expect(t.rows[0]?.map((c) => [flat(c.content), c.column, c.colspan, c.rowspan])).toEqual([
      ["Método", 0, 1, 2],
      ["Erro", 1, 2, 1],
      ["Tempo (s)", 3, 1, 2],
    ]);
    expect(t.rows[1]?.map((c) => [flat(c.content), c.column])).toEqual([["$L^2$", 1], ["$L^\\infty$", 2]]);
    expect(texts(t.rows[2])).toEqual(["Euler", "$1.2 \\times 10^{-2}$", "$3.4 \\times 10^{-2}$", "0.01"]);
  });

  it("reads hline and cline rules", () => {
    expect(t.rules[0]).toEqual([{ kind: "hline", from: 1, to: 4 }]);
    expect(t.rules[1]).toEqual([{ kind: "cline", from: 2, to: 3 }]);
    expect(t.rules[2]).toEqual([{ kind: "hline", from: 1, to: 4 }]);
    expect(t.rules[3]).toEqual([]);
    expect(t.rules[4]).toEqual([{ kind: "hline", from: 1, to: 4 }]);
  });

  it("draws the bars of the spec, the multicolumn's own spec for its cell", () => {
    const [first, erro, last] = t.rows[0] ?? [];
    expect([first?.leftRule, first?.rightRule]).toEqual([1, 1]);
    expect([erro?.leftRule, erro?.rightRule, erro?.align]).toEqual([0, 1, "center"]);
    expect([last?.leftRule, last?.rightRule]).toEqual([0, 1]);
  });

  it("has no caption", () => {
    expect(t.caption).toBeUndefined();
  });
});

describe("parseLatexTable cells", () => {
  it("keeps an escaped \\& in a cell", () => {
    const t = table(String.raw`\begin{tabular}{ll} A \& B & C \\ \end{tabular}`);
    expect(texts(t.rows[0])).toEqual(["A & B", "C"]);
  });

  it("does not split on & inside math or braces", () => {
    const t = table(String.raw`\begin{tabular}{ll} $\begin{matrix} a & b \end{matrix}$ & {x & y} \\ \end{tabular}`);
    expect(t.rows[0]).toHaveLength(2);
    expect(t.rows[0]?.[0]?.content).toEqual([{ type: "math", tex: String.raw`\begin{matrix} a & b \end{matrix}` }]);
  });

  it("reads styles, ties, dashes and percent signs", () => {
    const t = table(String.raw`\begin{tabular}{l} \textbf{a} \emph{b} \texttt{c}~1--2 50\% \\ \end{tabular}`);
    expect(texts(t.rows[0])).toEqual(["<bold>a</bold> <italic>b</italic> <mono>c</mono> 1–2 50%"]);
  });

  it("reads tabular*, p columns, repeated columns and an optional row skip", () => {
    const t = table(String.raw`\begin{tabular*}{\linewidth}{p{3cm}*{2}{|r}} a & b & c \\[2pt] d & e & f \end{tabular*}`);
    expect(t.columns).toEqual([{ align: "justify", width: "3cm" }, { align: "right" }, { align: "right" }]);
    expect(texts(t.rows[1])).toEqual(["d", "e", "f"]);
    expect(t.rows[0]?.[0]?.rightRule).toBe(1);
  });

  it("reads a caption under the rows and a cmidrule", () => {
    const t = table(String.raw`\begin{table}\begin{tabular}{cc} a & b \\ \cmidrule(lr){1-2} c & d \\ \end{tabular}\caption{Below}\end{table}`);
    expect(t.captionPosition).toBe("below");
    expect(t.rules[1]).toEqual([{ kind: "cmidrule", from: 1, to: 2 }]);
  });
});

describe("parseLatexTable fallback", () => {
  it("returns null for a tikzpicture", () => {
    expect(parseLatexTable(String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`)).toBeNull();
  });

  it("returns null without a tabular", () => {
    expect(parseLatexTable(String.raw`\section{Hi} Some text.`)).toBeNull();
  });

  it("returns null for a missing \\end", () => {
    expect(parseLatexTable(String.raw`\begin{tabular}{ll} a & b \\`)).toBeNull();
  });

  it("returns null for unbalanced braces", () => {
    expect(parseLatexTable(String.raw`\begin{tabular}{ll} \textbf{a & b \\ \end{tabular}`)).toBeNull();
  });

  it("returns null for a missing column spec", () => {
    expect(parseLatexTable(String.raw`\begin{tabular} a & b \\ \end{tabular}`)).toBeNull();
  });
});

describe("table layout", () => {
  const BARE = "\\begin{tabular}{ll}\n  a & b \\\\\n\\end{tabular}\n";
  const FLOAT = "\\begin{table}[h]\n\\caption{Cap}\n\\begin{tabular}{ll}\n  a & b \\\\\n\\end{tabular}\n\\end{table}\n";

  it("reads natural width, centred, from a table without layout, and tolerates an existing \\centering", () => {
    expect(readLatexTableLayout(BARE)).toEqual({ width: null, align: "center" });
    expect(readLatexTableLayout(FLOAT)).toEqual({ width: null, align: "center" });
    expect(readLatexTableLayout(BOOKTABS)).toEqual({ width: null, align: "center" });
    expect(readLatexTableLayout("no table here")).toEqual({ width: null, align: "center" });
  });

  it("wraps a table environment's tabular in a resize box and puts the alignment first in the table", () => {
    const out = setLatexTableLayout(FLOAT, { width: 60, align: "right" });
    expect(out).toBe("\\begin{table}[h]\n\\raggedleft\n\\caption{Cap}\n\\resizebox{0.6\\linewidth}{!}{%\n\\begin{tabular}{ll}\n  a & b \\\\\n\\end{tabular}%\n}\n\\end{table}\n");
    expect(readLatexTableLayout(out)).toEqual({ width: 60, align: "right" });
    expect(parseLatexTable(out)?.rows[0]?.length).toBe(2);
    expect(parseLatexTable(out)?.caption).toBeDefined();
    const back = setLatexTableLayout(out, { width: null, align: "center" });
    expect(back).toBe("\\begin{table}[h]\n\\centering\n\\caption{Cap}\n\\begin{tabular}{ll}\n  a & b \\\\\n\\end{tabular}\n\\end{table}\n");
    expect(readLatexTableLayout(back)).toEqual({ width: null, align: "center" });
  });

  it("replaces an existing \\centering in place", () => {
    const out = setLatexTableLayout(BOOKTABS, { width: null, align: "left" });
    expect(out).toBe(BOOKTABS.replace("\\centering", "\\raggedright"));
    expect(readLatexTableLayout(out).align).toBe("left");
  });

  it("wraps a bare tabular in flushleft, center or flushright, after its option lines", () => {
    const left = setLatexTableLayout(`#| label: t\n${BARE}`, { width: 45, align: "left" });
    expect(left).toBe("#| label: t\n\\begin{flushleft}\n\\resizebox{0.45\\linewidth}{!}{%\n\\begin{tabular}{ll}\n  a & b \\\\\n\\end{tabular}%\n}\n\\end{flushleft}\n");
    expect(readLatexTableLayout(left)).toEqual({ width: 45, align: "left" });
    expect(parseLatexTable(left)?.rows[0]?.length).toBe(2);
    const right = setLatexTableLayout(left, { width: 45, align: "right" });
    expect(right).toBe(left.replace("{flushleft}", "{flushright}").replace("{flushleft}", "{flushright}"));
    const full = setLatexTableLayout(right, { width: null, align: "center" });
    expect(full).toBe(`#| label: t\n\\begin{center}\n${BARE.trimEnd()}\n\\end{center}\n`);
    expect(readLatexTableLayout(full)).toEqual({ width: null, align: "center" });
  });
});
