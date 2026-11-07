/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the charts of a LaTeX source's tables: Chart from Table writes a pgfplots figure after the table at the cursor and labels
// the table, and an edit of the table rewrites the figure in the same transaction, so one undo takes back both.
import { history, isolateHistory, undo } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { chartTableAtCursor, findLinkedFigures, linkedFigureEdits, linkedFigureSync } from "../../../../src/writing/dom/sourceEditor/tableCharts";

jest.mock("../../../../src/ui/dom/index.js", () => ({ showToast: jest.fn() }));

const TABLE = String.raw`\begin{table}
  \caption{Speeds}
  \begin{tabular}{cc}
    t & v \\
    0 & 1 \\
    1 & 3 \\
  \end{tabular}
\end{table}`;

function mount(doc: string, at: number): EditorView {
  return new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: at }, extensions: [history(), linkedFigureSync] }) });
}

describe("chartTableAtCursor", () => {
  it("labels the table and writes a figure that follows it after the table", () => {
    const view = mount(TABLE, TABLE.indexOf("0 & 1"));
    chartTableAtCursor(view, "latex");
    const text = view.state.doc.toString();
    const label = /\\label\{(tab:[0-9a-f]{8})\}/.exec(text)?.[1];
    expect(label).toBeDefined();
    expect(text).toMatch(/\\label\{tab:[0-9a-f]{8}\}\n\\end\{table\}\n\n% labshelf-figure \{/);
    const [figure] = findLinkedFigures(text);
    expect(figure!.model).toMatchObject({ kind: "data", table: label, data: { cols: [{ name: "t", values: [0, 1] }, { name: "v", values: [1, 3] }] } });
    expect(text).toContain("\\begin{axis}");
    expect(text.endsWith("% end labshelf-figure")).toBe(true);
    expect(view.state.selection.main.head).toBe(text.indexOf("% labshelf-figure"));
    view.destroy();
  });

  it("writes nothing outside a table or in Typst", () => {
    const view = mount(`text\n${TABLE}`, 1);
    chartTableAtCursor(view, "latex");
    chartTableAtCursor(view, "typst");
    expect(view.state.doc.toString()).toBe(`text\n${TABLE}`);
    view.destroy();
  });
});

describe("linkedFigureSync", () => {
  function charted(): EditorView {
    const view = mount(TABLE, TABLE.indexOf("0 & 1"));
    chartTableAtCursor(view, "latex");
    return view;
  }

  it("rewrites the figure when a cell of its table changes, and one undo takes back both", () => {
    const view = charted();
    const before = view.state.doc.toString();
    const at = before.indexOf("1 & 3");
    view.dispatch({ changes: { from: at + 4, to: at + 5, insert: "7" }, userEvent: "input.type", annotations: isolateHistory.of("before") });
    const after = view.state.doc.toString();
    expect(findLinkedFigures(after)[0]!.model.data!.cols[1]!.values).toEqual([1, 7]);
    expect(after).not.toBe(before.replace("1 & 3", "1 & 7"));
    expect(linkedFigureEdits(after)).toEqual([]);
    undo(view);
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });

  it("leaves the figure alone for a peer's or the disk's text", () => {
    const view = charted();
    const at = view.state.doc.toString().indexOf("1 & 3");
    view.dispatch({ changes: { from: at + 4, to: at + 5, insert: "9" }, annotations: Transaction.remote.of(true) });
    expect(findLinkedFigures(view.state.doc.toString())[0]!.model.data!.cols[1]!.values).toEqual([1, 3]);
    expect(linkedFigureEdits(view.state.doc.toString())).toHaveLength(1);
    view.destroy();
  });

  it("keeps the figure when its table is gone", () => {
    const view = charted();
    const text = view.state.doc.toString();
    view.dispatch({ changes: { from: 0, to: text.indexOf("% labshelf-figure") } });
    expect(findLinkedFigures(view.state.doc.toString())[0]!.model.data!.cols[1]!.values).toEqual([1, 3]);
    view.destroy();
  });
});
