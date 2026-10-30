/** @jest-environment jsdom */
/**
 * Tests the code editor inside a code cell: its keys (newlines, Tab, paste, run, undo through the note's history,
 * leaving the cell with the arrow keys or Escape, removing an empty cell), read-only notes, and completion from the
 * note's cells and the modules it imports.
 */
import { EditorState, TextSelection, type Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node as PmNode } from "prosemirror-model";
import { EditorView as CodeEditorView } from "@codemirror/view";
import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { editNodeAt } from "../../../src/qmd/dom/inlineViews";
import { para, text, until } from "../../support/nodeViewHarness";

// jsdom has no layout; the completion popup measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

const runs: Array<[string, string]> = [];
beforeEach(() => { runs.length = 0; });

function mountDoc(doc: PmNode, options: { plugins?: Plugin[]; editable?: boolean } = {}): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, {
    state: EditorState.create({ doc, plugins: options.plugins ?? [] }),
    nodeViews: { code_cell: createCodeCellView((label, code) => runs.push([label, code])) },
    editable: () => options.editable ?? true,
    handleScrollToSelection: () => true,
  });
  views.push(view);
  return view;
}

const cell = (code: string, options = "") => s.node("code_cell", { lang: "python", options, code, info: "{python}" });
const cellDoc = (code: string, plugins: Plugin[] = []) => mountDoc(s.node("doc", null, [para(text("above")), cell(code), para(text("below"))]), { plugins });
const cellPos = 7;
const content = (view: EditorView, index = 0) => view.dom.querySelectorAll<HTMLElement>(".qmd-cell-code .cm-content")[index]!;
const codeEditor = (view: EditorView, index = 0) => CodeEditorView.findFromDOM(content(view, index))!;
const stored = (view: EditorView) => view.state.doc.child(1).attrs.code as string;
const key = (target: Element, init: KeyboardEventInit) => !target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

describe("code cell keys", () => {
  it("shows the code with line numbers and Python highlighting", () => {
    const view = cellDoc("x = True\nprint('a')\n");
    expect(codeEditor(view).state.doc.toString()).toBe("x = True\nprint('a')");
    expect(view.dom.querySelectorAll(".qmd-cell .cm-lineNumbers .cm-gutterElement").length).toBeGreaterThanOrEqual(2);
    expect(view.dom.querySelector(".qmd-cell-lang")!.textContent).toBe("Python");
  });

  it("Enter indents after a colon, and the code is stored as whole lines", () => {
    const view = cellDoc("def f():\n");
    editNodeAt(view, cellPos, "end");
    key(content(view), { key: "Enter" });
    expect(stored(view)).toBe("def f():\n    \n");
  });

  it("Enter at the end of a plain line stores an empty last line", () => {
    const view = cellDoc("x = 1\n");
    editNodeAt(view, cellPos, "end");
    key(content(view), { key: "Enter" });
    expect(stored(view)).toBe("x = 1\n\n");
    expect(codeEditor(view).state.doc.toString()).toBe("x = 1\n");
  });

  it("Tab inserts four spaces and pasting inserts plain text", () => {
    const view = cellDoc("x\n");
    editNodeAt(view, cellPos, "start");
    key(content(view), { key: "Tab" });
    expect(stored(view)).toBe("    x\n");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? "a\r\nb" : "") } });
    content(view).dispatchEvent(paste);
    expect(stored(view)).toBe("    a\nbx\n");
  });

  it("Mod-Enter and Shift-Enter run the cell without changing its code", () => {
    const view = cellDoc("print(1)\n");
    editNodeAt(view, cellPos, "end");
    key(content(view), { key: "Enter", ctrlKey: true });
    key(content(view), { key: "Enter", shiftKey: true });
    expect(runs).toEqual([["cell-1", "print(1)\n"], ["cell-1", "print(1)\n"]]);
    expect(stored(view)).toBe("print(1)\n");
  });

  it("Shift-Enter runs the cell and puts the caret in the text after the cell", () => {
    const view = cellDoc("print(1)\n");
    editNodeAt(view, cellPos, "end");
    key(content(view), { key: "Enter", shiftKey: true });
    expect(runs).toEqual([["cell-1", "print(1)\n"]]);
    expect(view.state.selection.$from.parent.textContent).toBe("below");
  });

  it("undo goes through the note's history and brings the code back into the editor", () => {
    const view = cellDoc("x\n", [history(), keymap({ "Mod-z": undo })]);
    editNodeAt(view, cellPos, "end");
    key(content(view), { key: "Enter" });
    expect(stored(view)).toBe("x\n\n");
    expect(key(content(view), { key: "z", ctrlKey: true })).toBe(true);
    expect(stored(view)).toBe("x\n");
    expect(codeEditor(view).state.doc.toString()).toBe("x");
  });

  it("ArrowDown on the last line and Escape move the caret to the paragraph after the cell", () => {
    const view = cellDoc("a\nb\n");
    editNodeAt(view, cellPos, "end");
    key(content(view), { key: "ArrowDown" });
    expect(view.state.selection.$from.parent.textContent).toBe("below");
    editNodeAt(view, cellPos, "start");
    key(content(view), { key: "Escape" });
    expect(view.state.selection.$from.parent.textContent).toBe("below");
  });

  it("ArrowUp on the first line moves the caret before the cell, but not from a later line", () => {
    const view = cellDoc("a\nb\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    editNodeAt(view, cellPos, "end");
    key(content(view), { key: "ArrowUp" });
    expect(view.state.selection.$from.parent.textContent).toBe("below");
    editNodeAt(view, cellPos, "start");
    key(content(view), { key: "ArrowUp" });
    expect(view.state.selection.$from.parent.textContent).toBe("above");
  });

  it("leaving a cell that ends the note creates a paragraph after it", () => {
    const view = mountDoc(s.node("doc", null, [cell("x\n")]));
    editNodeAt(view, 0, "end");
    key(content(view), { key: "ArrowRight" });
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("Backspace in an empty cell removes it", () => {
    const view = cellDoc("");
    editNodeAt(view, cellPos, "start");
    key(content(view), { key: "Backspace" });
    expect(view.state.doc.childCount).toBe(3);
    expect(view.state.doc.child(1).type.name).toBe("paragraph");
    expect(view.state.doc.textContent).toBe("abovebelow");
  });

  it("a new cell shows its code with one quiet line under it: the language and Run", () => {
    const view = cellDoc("x = 1\n");
    const panel = view.dom.querySelector<HTMLElement>(".qmd-cell-panel")!;
    expect(panel.hidden).toBe(false);
    expect([...panel.children].map((child) => child.className)).toEqual(["qmd-cell-code", "qmd-cell-actions"]);
    expect(panel.querySelector(".qmd-cell-actions")!.textContent!.replace(/\s+/g, " ")).toBe("Python·Run");
    view.dom.querySelector<HTMLButtonElement>(".qmd-cell-run")!.click();
    expect(runs).toEqual([["cell-1", "x = 1\n"]]);
  });

  it("a read-only note shows the code without letting it be edited", () => {
    const view = mountDoc(s.node("doc", null, [cell("x = 1\n")]), { editable: false });
    expect(codeEditor(view).state.readOnly).toBe(true);
    expect(content(view).getAttribute("contenteditable")).toBe("false");
    expect(editNodeAt(view, 0)).toBe(false);
  });

  it("follows code changed outside the editor", () => {
    const view = cellDoc("x = 1\n");
    view.dispatch(view.state.tr.setNodeAttribute(cellPos, "code", "x = 2\ny = 3\n"));
    expect(codeEditor(view).state.doc.toString()).toBe("x = 2\ny = 3");
    expect(stored(view)).toBe("x = 2\ny = 3\n");
  });
});

describe("code cell completion", () => {
  async function completionsAt(view: EditorView, index: number, typed: string): Promise<string[]> {
    const editor = codeEditor(view, index);
    editNodeAt(view, view.state.doc.child(0).nodeSize * index, "end");
    editor.dispatch(editor.state.update(editor.state.replaceSelection(typed)));
    startCompletion(editor);
    await until(() => currentCompletions(editor.state).length > 0);
    return currentCompletions(editor.state).map((option) => option.label);
  }

  it("offers the members of a module the note imports under an alias", async () => {
    const view = mountDoc(s.node("doc", null, [cell("import sympy as sp\n"), cell("x = 1\n")]));
    const labels = await completionsAt(view, 1, "\nsp.int");
    expect(labels).toContain("integrate");
  });

  it("offers names defined in the other cells of the note", async () => {
    const view = mountDoc(s.node("doc", null, [cell("velocity_total = 3\n"), cell("y = 1\n")]));
    const labels = await completionsAt(view, 1, "\nvelo");
    expect(labels).toContain("velocity_total");
  });
});
