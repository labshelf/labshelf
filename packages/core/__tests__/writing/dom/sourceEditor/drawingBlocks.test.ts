/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the figure blocks of a LaTeX source: their spans are found between readable markers, and the Edit figure button shows
// while the cursor is in one.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { figureEditButton, findFigureSpans } from "../../../../src/writing/dom/sourceEditor/drawingBlocks";
import { chartTableAt } from "../../../../src/writing/dom/sourceEditor/tableCharts";

const TABLE = String.raw`\begin{table}
  \begin{tabular}{cc}
    t & v \\
    0 & 1 \\
  \end{tabular}
\end{table}`;

/** A source with a table and the data figure charted from it. */
function charted(): string {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: TABLE }) });
  chartTableAt(view, TABLE.indexOf("0 & 1"));
  const text = view.state.doc.toString();
  view.destroy();
  return text;
}

describe("findFigureSpans", () => {
  it("spans each block with a readable model and skips an unreadable one", () => {
    const text = charted();
    const from = text.indexOf("% labshelf-figure");
    expect(findFigureSpans(text)).toEqual([{ from, to: text.length }]);
    expect(findFigureSpans("% labshelf-drawing {oops\n\\begin{tikzpicture}\\end{tikzpicture}\n% end labshelf-drawing")).toEqual([]);
  });
});

describe("figureEditButton", () => {
  it("shows while the cursor is in a figure block and hides outside it", () => {
    const text = charted();
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: text, extensions: [figureEditButton] }) });
    const button = document.querySelector<HTMLButtonElement>(".ls-figure-edit")!;
    expect(button.hidden).toBe(true);
    view.focus();
    view.dispatch({ selection: { anchor: text.indexOf("\\begin{axis}") } });
    expect(button.textContent).toBe("Edit figure");
    view.destroy();
    expect(document.querySelector(".ls-figure-edit")).toBeNull();
  });
});
