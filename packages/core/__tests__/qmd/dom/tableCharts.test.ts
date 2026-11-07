/** @jest-environment jsdom */
// Tests the charts of a note's tables: Chart from table puts a figure that follows the pipe table or raw LaTeX table after it
// (labelling the table when it has none), an edit of the table rewrites the figure in the same history step, and the PNG is
// drawn again outside the history once edits pause.
import { history, undo } from "prosemirror-history";
import { EditorState, NodeSelection, TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { readFigureBlock } from "../../../src/qmd/chart";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";
import { chartFromTable, tableChartsPlugin } from "../../../src/qmd/dom/tableCharts";
import { until } from "../../support/nodeViewHarness";

const PIPE = "| t | v |\n|---|---|\n| 0 | 1 |\n| 1 | 3 |\n";
const PNG = { dataUrl: "data:image/png;base64,AAAA", widthCm: 16, alt: "Data chart" };
const parts = jest.fn(async () => ({ png: PNG, picture: null, svg: null }));
const deps = { loadEditor: async () => ({ chartFigureParts: parts }) as never, loadPlotly: async () => ({}) as never, isExternal: () => false };

function stateOf(body: string, find: string): EditorState {
  const doc = bodyToDoc(body);
  let at = -1;
  doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text!.includes(find)) at = pos + node.text!.indexOf(find); });
  const selection = at >= 0 ? TextSelection.create(doc, at) : NodeSelection.create(doc, 0);
  return EditorState.create({ doc, selection, plugins: [history(), tableChartsPlugin(deps)] });
}

function run(state: EditorState, command: Command): EditorState {
  let next = state;
  command(state, (tr) => { next = state.apply(tr); });
  return next;
}

const figures = (state: EditorState) => {
  const found: ReturnType<typeof readFigureBlock>[] = [];
  state.doc.forEach((node) => { if (node.type.name === "figure") found.push(readFigureBlock(node.attrs.raw as string)); });
  return found;
};

describe("chartFromTable", () => {
  it("labels a pipe table by a caption and puts a figure that follows it after the caption", () => {
    const state = run(stateOf(PIPE, "3"), chartFromTable);
    const body = docToBody(state.doc);
    const label = /^: \{#(tbl-[0-9a-f]{8})\}$/m.exec(body)?.[1];
    expect(label).toBeDefined();
    expect(state.doc.child(1).type.name).toBe("paragraph");
    expect(state.doc.child(2).type.name).toBe("figure");
    expect(state.selection).toBeInstanceOf(NodeSelection);
    const [block] = figures(state);
    expect(block!.model).toMatchObject({ kind: "data", table: label, data: { cols: [{ name: "t", values: [0, 1] }, { name: "v", values: [1, 3] }] } });
    expect(block!.picture).toContain("\\begin{axis}");
    expect(bodyToDoc(body).child(1).textContent).toBe(`: {#${label}}`);
  });

  it("keeps a table's own caption label", () => {
    const state = run(stateOf(`${PIPE}\n: Speeds {#tbl-speed}\n`, "3"), chartFromTable);
    expect(state.doc.childCount).toBe(3);
    expect(figures(state)[0]!.model.table).toBe("tbl-speed");
  });

  it("labels a raw LaTeX table with a \\label line", () => {
    const body = "```{=latex}\n\\begin{tabular}{cc}\nx & y \\\\\n1 & 2 \\\\\n\\end{tabular}\n```\n";
    const state = run(stateOf(body, "\u0000"), chartFromTable);
    expect(state.doc.child(0).attrs.code).toMatch(/^\\label\{tab:[0-9a-f]{8}\}\n\\begin\{tabular\}/);
    expect(figures(state)[0]!.model.table).toMatch(/^tab:/);
  });

  it("does not apply outside a table", () => {
    expect(chartFromTable(stateOf("Some text\n", "text"))).toBe(false);
  });
});

describe("tableChartsPlugin", () => {
  function editCell(state: EditorState, find: string, text: string): EditorState {
    let at = -1;
    state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text === find) at = pos; });
    return state.apply(state.tr.insertText(text, at, at + find.length));
  }

  it("rewrites the figure when its table changes, and one undo takes back both", () => {
    const charted = run(stateOf(PIPE, "3"), chartFromTable);
    const edited = editCell(charted, "3", "8");
    expect(figures(edited)[0]!.model.data!.cols[1]!.values).toEqual([1, 8]);
    expect(figures(edited)[0]!.picture).toContain("(1,8)");
    const undone = run(edited, undo);
    expect(docToBody(undone.doc)).toBe(docToBody(charted.doc));
  });

  it("draws the PNG again once edits pause, outside the history", async () => {
    const charted = run(stateOf(PIPE, "3"), chartFromTable);
    const view = new EditorView(document.body, { state: charted });
    await until(() => figures(view.state)[0]!.png !== null);
    expect(figures(view.state)[0]!.png!.dataUrl).toBe(PNG.dataUrl);
    view.dispatch(view.state.tr.insertText("x", view.state.doc.content.size - 1));
    undo(view.state, view.dispatch.bind(view));
    expect(figures(view.state)).toHaveLength(1);
    view.destroy();
  });

  it("leaves figures alone for the host's text", () => {
    const external = { ...deps, isExternal: () => true };
    const charted = run(stateOf(PIPE, "3"), chartFromTable);
    const state = EditorState.create({ doc: charted.doc, plugins: [tableChartsPlugin(external)] });
    expect(figures(editCell(state, "3", "8"))[0]!.model.data!.cols[1]!.values).toEqual([1, 3]);
  });
});
