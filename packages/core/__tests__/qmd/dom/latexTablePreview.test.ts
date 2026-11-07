/** @jest-environment jsdom */
// Tests the LaTeX table preview: renderLatexTable draws spans, alignment and rules as cell classes, and a ```{=latex} code cell
// holding a tabular shows the table in place of its source until the source is opened; other blocks keep the source view.
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { renderLatexTable } from "../../../src/qmd/dom/latexTablePreview";
import { parseLatexTable } from "../../../src/qmd/latexTable/latexTable";
import { editNodeAt } from "../../../src/qmd/dom/inlineViews";
import { mount, settle } from "../../support/nodeViewHarness";

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const fakeMath = async () => ({ renderMathSvg: () => "<svg></svg>" });

const SPANS = String.raw`\begin{tabular}{|c|c|c|}
  \hline
  \multirow{2}{*}{A} & \multicolumn{2}{c|}{B} \\
  \cline{2-3}
   & $x$ & y \\
  \hline\hline
  1 & 2 & 3 \\
  \hline
\end{tabular}
`;

describe("renderLatexTable", () => {
  const table = renderLatexTable(parseLatexTable(SPANS)!, fakeMath);
  const rows = [...table.querySelectorAll("tr")];

  it("draws colspan and rowspan and drops covered cells", () => {
    expect(rows.map((row) => row.cells.length)).toEqual([2, 2, 3]);
    expect(rows[0]!.cells[0]!.rowSpan).toBe(2);
    expect(rows[0]!.cells[1]!.colSpan).toBe(2);
  });

  it("draws hline, cline, a double hline and the vertical bars as cell classes", () => {
    expect(rows[0]!.cells[0]!.classList.contains("rule-top-thin")).toBe(true);
    expect(rows[1]!.cells[0]!.classList.contains("rule-top-thin")).toBe(true);
    expect(rows[2]!.cells[0]!.classList.contains("rule-top-double")).toBe(true);
    expect(rows[2]!.cells[2]!.classList.contains("rule-bottom-thin")).toBe(true);
    expect(rows[2]!.cells[0]!.classList.contains("rule-left")).toBe(true);
    expect(rows[2]!.cells[0]!.classList.contains("align-center")).toBe(true);
  });

  it("draws a booktabs caption and thick outer rules", () => {
    const booktabs = renderLatexTable(parseLatexTable(String.raw`\begin{table}\caption{Cap}\begin{tabular}{lr}\toprule a & b \\ \bottomrule\end{tabular}\end{table}`)!, fakeMath);
    expect(booktabs.querySelector("caption")?.textContent).toBe("Cap");
    expect(booktabs.querySelector("td")?.className).toContain("rule-top-thick");
    expect(booktabs.querySelector("td")?.className).toContain("rule-bottom-thick");
    expect(booktabs.querySelectorAll("td")[1]?.className).toContain("align-right");
  });
});

describe("code cell with a raw LaTeX table", () => {
  const cell = (lang: string, code: string) => s.node("doc", null, [s.node("code_cell", { lang, options: "", code, info: `{${lang}}` })]);

  it("shows the table in place of the source, and the source once it is opened", async () => {
    const view = mount(cell("=latex", "\\begin{tabular}{ll} a & b \\\\ \\end{tabular}\n"), { code_cell: createCodeCellView() });
    const dom = view.dom.querySelector(".qmd-cell")!;
    expect(dom.classList.contains("qmd-cell-latex-table")).toBe(true);
    expect(dom.querySelector(".qmd-latex-table-preview td")?.textContent).toBe("a");
    expect(editNodeAt(view, 0)).toBe(true);
    expect(dom.classList.contains("is-editing-source")).toBe(true);
    view.focus();
    await settle(20);
    expect(dom.classList.contains("is-editing-source")).toBe(false);
  });

  it("writes the width and alignment from the controls into the LaTeX without opening the source", () => {
    const view = mount(cell("=latex", "\\begin{tabular}{ll} a & b \\\\ \\end{tabular}\n"), { code_cell: createCodeCellView() });
    const dom = view.dom.querySelector(".qmd-cell")!;
    const input = dom.querySelector<HTMLInputElement>(".qmd-latex-table-preview .qmd-width-input")!;
    input.focus();
    input.value = "50";
    input.dispatchEvent(new Event("input"));
    expect(dom.querySelector<HTMLElement>(".qmd-latex-table")!.style.getPropertyValue("--qmd-media-width")).toBe("50%");
    input.dispatchEvent(new Event("change"));
    dom.querySelector<HTMLButtonElement>('button[title="Align right"]')!.click();
    expect(view.state.doc.firstChild!.attrs.code).toBe("\\begin{flushright}\n\\resizebox{0.5\\linewidth}{!}{%\n\\begin{tabular}{ll} a & b \\\\ \\end{tabular}%\n}\n\\end{flushright}\n");
    expect(dom.classList.contains("is-editing-source")).toBe(false);
    expect(dom.querySelector<HTMLElement>(".qmd-latex-table")!.dataset.align).toBe("right");
  });

  it("keeps the source view for a tikzpicture and for a Python cell", () => {
    for (const [lang, code] of [["=latex", "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}\n"], ["python", "x = 1\n"]] as const) {
      const view = mount(cell(lang, code), { code_cell: createCodeCellView() });
      expect(view.dom.querySelector(".qmd-cell-latex-table, .qmd-latex-table-preview")).toBeNull();
    }
  });
});
