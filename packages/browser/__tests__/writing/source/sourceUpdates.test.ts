/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Insertions and bold or italic wrapping apply to every selection of the source editor in one transaction.
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger } from "@labshelf/core";
import { tableSnippet } from "@labshelf/core";
import { mountSourceEditor } from "../../../src/writing/editor/mountSourceEditor";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const ready = { state: "ready" as const, helperVersion: "1", tex: { source: "none" as const, complete: false }, host: "helper" as const };

async function mount(text: string, path = "main.tex") {
  const files = { list: async () => [path], read: async () => text, write: jest.fn(async () => undefined) };
  const helper = { status: () => ready, edit: jest.fn(async () => undefined), save: jest.fn(async () => undefined) };
  const host = document.createElement("div");
  const editor = await mountSourceEditor(host, { projectId: "p", path, files, papers: async () => [], helper, logger, onDirty: () => undefined });
  const view = EditorView.findFromDOM(host)!;
  const select = (...ranges: [number, number][]): void => view.dispatch({ selection: EditorSelection.create(ranges.map(([anchor, head]) => EditorSelection.range(anchor, head))) });
  const selected = (): [number, number][] => view.state.selection.ranges.map((range) => [range.from, range.to]);
  return { editor, view, select, selected, doc: () => view.state.doc.toString() };
}

describe("insertText", () => {
  it("replaces every selection and leaves a cursor after each", async () => {
    const { editor, select, selected, doc } = await mount("a b c");
    select([0, 1], [2, 3], [4, 4]);
    editor.insertText("X");
    expect(doc()).toBe("X X Xc");
    expect(selected()).toEqual([[1, 1], [3, 3], [5, 5]]);
    await editor.dispose();
  });
});

describe("wrap", () => {
  it("wraps each selected range and keeps it selected", async () => {
    const { editor, select, selected, doc } = await mount("ab cd");
    select([0, 2], [3, 5]);
    editor.wrap("bold");
    expect(doc()).toBe("\\textbf{ab} \\textbf{cd}");
    expect(selected()).toEqual([[0, 11], [12, 23]]);
    await editor.dispose();
  });

  it("removes markup that is already there", async () => {
    const { editor, select, selected, doc } = await mount("\\textbf{ab} \\textbf{cd}");
    select([0, 11], [12, 23]);
    editor.wrap("bold");
    expect(doc()).toBe("ab cd");
    expect(selected()).toEqual([[0, 2], [3, 5]]);
    await editor.dispose();
  });

  it("puts an empty pair around an empty selection and the cursor inside it", async () => {
    const { editor, select, selected, doc } = await mount("x");
    select([1, 1]);
    editor.wrap("italic");
    expect(doc()).toBe("x\\emph{}");
    expect(selected()).toEqual([[7, 7]]);
    await editor.dispose();
  });

  it("wraps in Typst markers for a .typ file", async () => {
    const { editor, select, doc } = await mount("ab", "main.typ");
    select([0, 2]);
    editor.wrap("bold");
    expect(doc()).toBe("*ab*");
    await editor.dispose();
  });

  it("wraps on Mod-b", async () => {
    const { editor, view, select, doc } = await mount("ab");
    select([0, 2]);
    const event = new KeyboardEvent("keydown", { key: "b", code: "KeyB", keyCode: 66, ctrlKey: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(doc()).toBe("\\textbf{ab}");
    expect(event.defaultPrevented).toBe(true);
    await editor.dispose();
  });
});

describe("insertSnippet", () => {
  it("inserts the table at the cursor with its literal backslashes and braces", async () => {
    const { editor, select, doc } = await mount("before\nafter");
    select([7, 7]);
    editor.insertSnippet(tableSnippet("latex", { columns: 2, rows: 1 }));
    expect(doc()).toContain("before\n\\begin{table}[h]\n  \\centering\n  \\begin{tabular}{|c|c|}");
    expect(doc()).toContain("\\caption{Caption}");
    expect(doc()).toContain("\\\\\n");
    expect(doc().endsWith("\\end{table}\nafter")).toBe(true);
    await editor.dispose();
  });
});
