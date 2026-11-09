/** @jest-environment jsdom */
// Split's focus on a CodeMirror view: the lines outside the range are hidden, the cursor stays inside, edits map the range, null shows all.
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { deckFocus, focusDeckRange } from "../../../src/writing/dom/sourceEditor/deckFocus";

const DOC = ["pre", "a1", "a2", "post"].join("\n");
const mount = (): EditorView => new EditorView({ parent: document.body, state: EditorState.create({ doc: DOC, extensions: [deckFocus] }) });
const hidden = (view: EditorView): string[] => [...view.dom.querySelectorAll(".cm-deck-hidden")].map((bar) => bar.textContent ?? "");

describe("deckFocus", () => {
  it("hides the lines before and after the range and moves an outside cursor to the given offset", () => {
    const view = mount();
    const a1 = DOC.indexOf("a1");
    expect(focusDeckRange(view, { from: a1, to: DOC.indexOf("a2") + 2 }, a1 + 1)).toBe(a1 + 1);
    expect(hidden(view)).toEqual(["1 line", "1 line"]);
    expect(view.state.selection.main.head).toBe(a1 + 1);
  });

  it("keeps a selection move inside the shown lines", () => {
    const view = mount();
    const a1 = DOC.indexOf("a1");
    focusDeckRange(view, { from: a1, to: DOC.indexOf("a2") + 2 });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(view.state.selection.main.head).toBe(a1);
    view.dispatch({ selection: EditorSelection.range(0, DOC.length) });
    expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([a1, DOC.indexOf("a2") + 2]);
  });

  it("keeps text typed at the range's end shown", () => {
    const view = mount();
    const end = DOC.indexOf("a2") + 2;
    focusDeckRange(view, { from: DOC.indexOf("a1"), to: end });
    view.dispatch({ changes: { from: end, insert: "\nnew" } });
    expect(view.state.doc.toString()).toBe("pre\na1\na2\nnew\npost");
    expect(hidden(view)).toEqual(["1 line", "1 line"]);
  });

  it("shows the whole file again with null", () => {
    const view = mount();
    focusDeckRange(view, { from: DOC.indexOf("a1"), to: DOC.indexOf("a2") });
    focusDeckRange(view, null);
    expect(hidden(view)).toEqual([]);
  });
});
