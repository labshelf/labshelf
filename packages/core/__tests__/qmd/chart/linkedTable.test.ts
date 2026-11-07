// Tests the tables a data figure follows: cell values, rows into a chart table, the LaTeX tables of a text with their labels, the
// figure a table starts with and Quarto caption labels.
import { captionLabel, cellValue, figureOfTable, findLatexTables, labelLine, sameTable, tableChartKinds, readFigureModel, tableOfLatex, tableOfRows } from "../../../src/qmd/chart";

describe("cellValue", () => {
  it.each([
    ["", null], ["  ", null], ["3", 3], ["-1.5e3", -1500], ["$2.5$", 2.5], ["\\num{12}", 12], ["−4", -4], ["1{,}5", 1.5], ["10\\,000", 10000], ["abc", "abc"], ["3 m", "3 m"],
  ])("reads %j as %j", (text, value) => {
    expect(cellValue(text)).toBe(value);
  });
});

describe("tableOfRows", () => {
  it("names the columns by a text first row and types the cells", () => {
    expect(tableOfRows([["t", "v"], ["0", "1.5"], ["1", ""]])).toEqual({ cols: [{ name: "t", values: [0, 1] }, { name: "v", values: [1.5, null] }] });
  });

  it("names the columns A, B, … when the first row holds a number", () => {
    expect(tableOfRows([["1", "2"], ["3", "4"]]).cols.map((col) => col.name)).toEqual(["A", "B"]);
  });

  it("keeps a header row when told so, naming an empty header cell by its letter", () => {
    expect(tableOfRows([["", "2020"], ["a", "1"]], true).cols.map((col) => col.name)).toEqual(["A", "2020"]);
  });
});

const FLOAT = String.raw`\begin{table}[h]
  \centering
  \caption{Results}
  \begin{tabular}{lr}
    x & y \\ \hline
    1 & 2 \\
    2 & 4 \\
  \end{tabular}
\end{table}`;

describe("findLatexTables", () => {
  it("takes a tabular's float, its label and its cells", () => {
    const text = FLOAT.replace("\\caption{Results}", "\\caption{Results}\\label{tab:res}");
    const [span] = findLatexTables(`intro\n${text}\nafter`);
    expect(span).toMatchObject({ from: 6, to: 6 + text.length, label: "tab:res" });
    expect(span!.table).toEqual({ cols: [{ name: "x", values: [1, 2] }, { name: "y", values: [2, 4] }] });
  });

  it("puts a float's new label before \\end{table}, after the caption", () => {
    const [span] = findLatexTables(FLOAT);
    expect(span!.label).toBeNull();
    const line = labelLine(span!, "tab:new");
    const text = FLOAT.slice(0, line.at) + line.text + FLOAT.slice(line.at);
    expect(text).toContain("  \\end{tabular}\n  \\label{tab:new}\n\\end{table}");
    expect(findLatexTables(text)[0]!.label).toBe("tab:new");
  });

  it("reads a bare tabular's label from the line above it", () => {
    const text = "\\label{tab:bare}\n\\begin{tabular}{cc}\n1 & 2 \\\\\n\\end{tabular}";
    expect(findLatexTables(text)[0]).toMatchObject({ label: "tab:bare", from: 17 });
  });

  it("skips tables in comments and lists each table in order", () => {
    const text = "% \\begin{tabular}{c}\n\\begin{tabular}{c}\na \\\\\n\\end{tabular}\n\\begin{tabular}{c}\nb \\\\\n\\end{tabular}";
    expect(findLatexTables(text).map((span) => span.table?.cols[0]?.name)).toEqual(["a", "b"]);
  });
});

describe("tableOfLatex", () => {
  it("places a multicolumn cell at its first column", () => {
    const table = tableOfLatex("\\begin{tabular}{ccc}\n\\multicolumn{2}{c}{ab} & c \\\\\n1 & 2 & 3 \\\\\n\\end{tabular}");
    expect(table!.cols.map((col) => col.name)).toEqual(["ab", "B", "c"]);
  });
});

describe("figureOfTable", () => {
  const table = { cols: [{ name: "t", values: [0, 1] }, { name: "a", values: [1, 2] }, { name: "note", values: ["x", "y"] }, { name: "b", values: [3, 4] }] };

  it("charts the first column against each column of numbers, following the label", () => {
    const model = readFigureModel(figureOfTable(table, "tab:x", "0a1b2c3d"))!;
    expect(model).toMatchObject({ kind: "data", table: "tab:x", data: table });
    expect(model.traces).toEqual([{ type: "scatter", mode: "lines+markers", name: "a", x: "A", y: "B" }, { type: "scatter", mode: "lines+markers", name: "b", x: "A", y: "D" }]);
    expect(model.layout.xaxis.title).toBe("t");
  });

  it("draws bars over a text first column and titles the Y axis of one series", () => {
    const model = figureOfTable({ cols: [{ name: "city", values: ["a", "b"] }, { name: "n", values: [1, 2] }] }, "tbl-c", "0a1b2c3d");
    expect(model.traces).toEqual([{ type: "bar", name: "n", x: "A", y: "B" }]);
    expect(model.layout.yaxis.title).toBe("n");
  });
});

describe("tableChartKinds", () => {
  const grid = { cols: [{ name: "y", values: [0, 1] }, { name: "x0", values: [1, 2] }, { name: "x1", values: [3, 4] }] };

  it("puts the suggested kind first and offers 3D only with enough numeric columns", () => {
    expect(tableChartKinds(grid)).toEqual(["lines", "scatter", "area", "bar", "stacked", "pie", "heatmap", "surface", "scatter3d"]);
    expect(tableChartKinds({ cols: [{ name: "c", values: ["a"] }, { name: "n", values: [1] }] })).toEqual(["bar", "lines", "scatter", "area", "stacked", "pie"]);
    expect(tableChartKinds({ cols: [{ name: "c", values: ["a"] }] })).toEqual([]);
  });

  it("builds one trace over all series for a surface and 3D axes for points", () => {
    expect(figureOfTable(grid, "t", "0a1b2c3d", "surface").traces).toEqual([{ type: "surface", y: "A", z: ["B", "C"] }]);
    const points = readFigureModel(figureOfTable(grid, "t", "0a1b2c3d", "scatter3d"))!;
    expect(points.traces).toEqual([{ type: "scatter3d", mode: "markers", x: "A", y: "B", z: ["C"] }]);
    expect(points.layout.zaxis?.title).toBe("x1");
    expect(figureOfTable(grid, "t", "0a1b2c3d", "pie").traces).toEqual([{ type: "pie", name: "x0", x: "A", y: "B" }]);
  });
});

describe("sameTable", () => {
  it("compares the cells, not the objects", () => {
    const table = { cols: [{ name: "a", values: [1] }] };
    expect(sameTable(table, JSON.parse(JSON.stringify(table)))).toBe(true);
    expect(sameTable(undefined, table)).toBe(false);
  });
});

describe("readFigureModel table", () => {
  const base = { v: 1, id: "0a1b2c3d", kind: "data", data: { cols: [] }, traces: [], fns: [], vars: [], layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } } };

  it("keeps a valid label and refuses a bad one or one beside src", () => {
    expect(readFigureModel({ ...base, table: "tbl-a" })?.table).toBe("tbl-a");
    expect(readFigureModel({ ...base, table: "has space" })).toBeNull();
    const { data: _data, ...noData } = base;
    expect(readFigureModel({ ...noData, src: "assets/x.csv", table: "tbl-a" })).toBeNull();
  });
});

describe("captionLabel", () => {
  it.each([[": Results {#tbl-res}", "tbl-res"], [": {#tbl-a .striped}", "tbl-a"], ["Table: x {#tbl-b}", "tbl-b"], [": no label", null], ["{#tbl-a}", null], ["text {#tbl-a}", null]])("reads %j as %j", (text, label) => {
    expect(captionLabel(text)).toBe(label);
  });
});
