/** @jest-environment jsdom */
/**
 * Tests the table keys of the rich note editor: Tab and Shift-Tab between cells, Tab and Enter adding a row past the
 * last one, Enter in an empty last row leaving the table, Backspace that never joins out of a table, and the Table insert.
 */
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { EditorView } from "prosemirror-view";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { cellBackspace, cellBelow, goToCell, insertTable, tableKeymap } from "../../../src/qmd/dom/tableCommands";

const BODY = "before\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\nafter\n";

/** The state of `body` with the caret at the end of the first cell whose text is `text`. */
function stateIn(body: string, text: string): EditorState {
  const doc = bodyToDoc(body);
  let pos = -1;
  doc.descendants((node, at) => {
    if (pos < 0 && (node.type.name === "table_cell" || node.type.name === "table_header") && node.textContent === text) pos = at + 1 + node.content.size;
    return pos < 0;
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}

function run(state: EditorState, command: Command): EditorState {
  let next = state;
  expect(command(state, (tr) => { next = state.apply(tr); })).toBe(true);
  return next;
}

const caretCell = (state: EditorState) => state.selection.$head.parent;

describe("table commands", () => {
  it("moves through the cells with Tab and Shift-Tab", () => {
    let state = stateIn(BODY, "a");
    state = run(state, goToCell(1));
    expect(caretCell(state).textContent).toBe("b");
    state = run(state, goToCell(1));
    expect(caretCell(state).textContent).toBe("1");
    state = run(state, goToCell(-1));
    expect(caretCell(state).textContent).toBe("b");
    expect(state.selection.$head.parentOffset).toBe(1);
  });

  it("adds a row with Tab in the last cell, keeping the column alignment", () => {
    const state = run(stateIn(BODY, "2"), goToCell(1));
    expect(caretCell(state).type.name).toBe("table_cell");
    expect(caretCell(state).textContent).toBe("");
    const doc = state.doc;
    expect(docToBody(doc)).toBe("before\n\n| a   |   b |\n|-----|----:|\n| 1   |   2 |\n|     |     |\n\nafter\n");
  });

  it("moves down with Enter, adds a row at the end and leaves the table from an empty last row", () => {
    let state = run(stateIn(BODY, "b"), cellBelow);
    expect(caretCell(state).textContent).toBe("2");
    state = run(state, cellBelow);
    expect(state.doc.child(1).childCount).toBe(3);
    state = run(state, cellBelow);
    expect(state.doc.child(1).childCount).toBe(2);
    expect(caretCell(state).type.name).toBe("paragraph");
    expect(caretCell(state).textContent).toBe("after");
    expect(docToBody(state.doc)).toBe(BODY);
  });

  it("does not join out of a cell with Backspace, and drops an empty table for a paragraph", () => {
    const start = stateIn(BODY, "1");
    const at = run(start, (state, dispatch) => { dispatch!(state.tr.setSelection(TextSelection.create(state.doc, state.selection.head - 1))); return true; });
    expect(run(at, cellBackspace).doc.eq(at.doc)).toBe(true);
    const empty = stateIn("x\n\n|   |\n|---|\n", "");
    const after = run(empty, cellBackspace);
    expect(after.doc.child(1).type.name).toBe("paragraph");
    expect(after.doc.child(0).textContent).toBe("x");
  });

  it("inserts a 2 by 2 table with the caret in its first header cell", () => {
    const doc = s.node("doc", null, [s.node("paragraph")]);
    const state = run(EditorState.create({ doc, selection: TextSelection.create(doc, 1) }), insertTable);
    const table = state.doc.child(0);
    expect(table.type.name).toBe("table");
    expect([table.childCount, table.child(0).childCount]).toEqual([2, 2]);
    expect(caretCell(state).type.name).toBe("table_header");
    expect(docToBody(state.doc)).toBe("|     |     |\n|-----|-----|\n|     |     |\n");
  });

  it("moves with the Tab key in a mounted editor", () => {
    const view = new EditorView(document.createElement("div"), { state: EditorState.create({ doc: stateIn(BODY, "a").doc, selection: stateIn(BODY, "a").selection, plugins: [keymap(tableKeymap())] }) });
    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(caretCell(view.state).textContent).toBe("b");
    expect(view.dom.querySelector("table th")?.textContent).toBe("a");
    expect((view.dom.querySelectorAll("td")[1] as HTMLElement).style.textAlign).toBe("right");
    view.destroy();
  });
});
