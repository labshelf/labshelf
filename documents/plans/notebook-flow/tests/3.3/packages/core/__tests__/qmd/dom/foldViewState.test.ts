/** @jest-environment jsdom */
/**
 * Tests the fold view state of 3.3 on bare EditorViews that carry foldPlugin(), through a fake in-memory QmdViewStatePort and
 * fake timers (the 300 ms debounce): bindFoldViewState loads the port's value for a key once, applies it, saves debounced on every
 * fold change, and its returned function flushes and unbinds. A second view of the same body bound to the same port and key shows
 * the same folds (3.3a), and no document content ever changes (A7).
 *
 * BODY: the cell "load" sits outside any section; "# Top" contains the unlabelled cell "cell-2" and the section "## Sub".
 */
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { bindFoldViewState } from "../../../src/qmd/dom/foldViewState";
import { foldPlugin, foldStateOf, setFold } from "../../../src/qmd/dom/foldPlugin";
import { bodyToDoc, docToBody, qmdSchema } from "../../../src/qmd/editor";
import type { NoteViewState, QmdViewStatePort } from "../../../src/qmd/noteViewState";

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const DEBOUNCE_MS = 300;
const KEY = "note-a\nitem-1";
const OTHER_KEY = "note-a\nitem-2";

const cellBody = (code: string, label?: string): string => `\`\`\`{python}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n`;
const BODY = [cellBody("a = 1", "load"), "# Top\n\nSome text.\n", cellBody("b = 2"), "## Sub\n\nMore text.\n", "# Other\n\nEnd.\n"].join("\n");

/** An in-memory port: `store` holds whatever load returns per key; `saves` records every save call in order. */
class FakePort implements QmdViewStatePort {
  readonly store = new Map<string, unknown>();
  readonly saves: Array<{ key: string; state: NoteViewState }> = [];
  readonly loads: string[] = [];
  load(key: string): unknown {
    this.loads.push(key);
    return this.store.get(key);
  }
  save(key: string, state: NoteViewState): void {
    this.saves.push({ key, state });
    // Round-trip through JSON as a real store would, so the next view reads plain data.
    this.store.set(key, JSON.parse(JSON.stringify(state)));
  }
  last(): NoteViewState | undefined {
    return this.saves[this.saves.length - 1]?.state;
  }
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();
const advance = (ms: number): void => { jest.advanceTimersByTime(ms); };

let views: EditorView[] = [];

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  for (const view of views) { try { view.destroy(); } catch { /* already destroyed */ } }
  views = [];
  document.body.innerHTML = "";
  jest.useRealTimers();
});

function viewOf(body = BODY): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView(host, { state: EditorState.create({ schema: qmdSchema, doc: bodyToDoc(body), plugins: [foldPlugin()] }) });
  views.push(view);
  return view;
}

/** Folds the cell "load", the section "1:Top:0" and reading mode on `view`. */
function foldSome(view: EditorView): void {
  setFold(view, { cell: ["load", true] });
  setFold(view, { section: ["1:Top:0", true] });
  setFold(view, { reading: true });
}

describe("bindFoldViewState restores through the port", () => {
  it("3.3a a new view of the same body collapses the same cell, section and reading mode", () => {
    const port = new FakePort();
    const first = viewOf();
    const unbind = bindFoldViewState(first, { port, key: KEY });
    foldSome(first);
    advance(DEBOUNCE_MS);
    unbind();

    const second = viewOf();
    bindFoldViewState(second, { port, key: KEY });
    const state = foldStateOf(second.state);
    expect(sorted(state.cells)).toEqual(["load"]);
    expect(sorted(state.sections)).toEqual(["1:Top:0"]);
    expect(state.reading).toBe(true);
  });

  it("3.3a the new view shows the restored state as classes", () => {
    const port = new FakePort();
    const first = viewOf();
    const unbind = bindFoldViewState(first, { port, key: KEY });
    foldSome(first);
    advance(DEBOUNCE_MS);
    unbind();

    const second = viewOf();
    bindFoldViewState(second, { port, key: KEY });
    // Reading mode (3.2) also summarises every output-less code cell, so the collapsed cells are compared with the first view's
    // instead of counted: the restored view must show exactly what the view that saved the state showed.
    const classed = (view: EditorView, cls: string): string[] => Array.from(view.dom.querySelectorAll(cls)).map((el) => el.textContent ?? "");
    expect(foldStateOf(second.state).reading).toBe(true);
    expect(classed(second, ".qmd-collapsed").length).toBeGreaterThanOrEqual(1);
    expect(classed(second, ".qmd-collapsed")).toEqual(classed(first, ".qmd-collapsed"));
    expect(classed(second, ".qmd-section-collapsed")).toHaveLength(1);
    expect(classed(second, ".qmd-section-collapsed")).toEqual(classed(first, ".qmd-section-collapsed"));
  });

  it("3.3a restores a state saved only by the unbind flush", () => {
    const port = new FakePort();
    const first = viewOf();
    const unbind = bindFoldViewState(first, { port, key: KEY });
    setFold(first, { reading: true });
    unbind();

    const second = viewOf();
    bindFoldViewState(second, { port, key: KEY });
    expect(foldStateOf(second.state).reading).toBe(true);
  });

  it("3.3a restores an unlabelled cell and a nested section from a stored value", () => {
    const port = new FakePort();
    port.store.set(KEY, { cells: ["cell-2"], sections: ["2:Sub:0"], reading: false });
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    const state = foldStateOf(view.state);
    expect(sorted(state.cells)).toEqual(["cell-2"]);
    expect(sorted(state.sections)).toEqual(["2:Sub:0"]);
    expect(state.reading).toBe(false);
  });

  it("3.3a loads the port's value for the given key, once", () => {
    const port = new FakePort();
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    setFold(view, { section: ["1:Top:0", true] });
    advance(DEBOUNCE_MS * 2);
    expect(port.loads).toEqual([KEY]);
  });

  it("3.3a starts with nothing folded when the port has no value", () => {
    const view = viewOf();
    bindFoldViewState(view, { port: new FakePort(), key: KEY });
    const state = foldStateOf(view.state);
    expect(state.cells.size).toBe(0);
    expect(state.sections.size).toBe(0);
    expect(state.reading).toBe(false);
  });

  it.each([
    ["a string", "garbage"],
    ["null", null],
    ["a number", 42],
    ["an array", [1, 2]],
  ])("3.3a starts with nothing folded when the port returns %s", (_name, value) => {
    const port = new FakePort();
    port.store.set(KEY, value);
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    const state = foldStateOf(view.state);
    expect(state.cells.size + state.sections.size).toBe(0);
    expect(state.reading).toBe(false);
  });

  it("3.3a ignores stored cell and section keys that are not in the body", () => {
    const port = new FakePort();
    port.store.set(KEY, { cells: ["ghost", "load", 5], sections: ["9:Nowhere:0", "1:Top:0", null], reading: false });
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    const state = foldStateOf(view.state);
    expect(sorted(state.cells)).toEqual(["load"]);
    expect(sorted(state.sections)).toEqual(["1:Top:0"]);
  });

  it("3.3a keeps the state of one key apart from another key", () => {
    const port = new FakePort();
    const first = viewOf();
    const unbind = bindFoldViewState(first, { port, key: KEY });
    foldSome(first);
    advance(DEBOUNCE_MS);
    unbind();

    const other = viewOf();
    bindFoldViewState(other, { port, key: OTHER_KEY });
    const state = foldStateOf(other.state);
    expect(state.cells.size + state.sections.size).toBe(0);
    expect(state.reading).toBe(false);
  });
});

describe("bindFoldViewState saves through the port", () => {
  it("3.3a saves a fold change after 300 ms under the given key", () => {
    const port = new FakePort();
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    port.saves.length = 0;
    setFold(view, { section: ["1:Top:0", true] });
    advance(DEBOUNCE_MS - 1);
    expect(port.saves).toHaveLength(0);
    advance(1);
    expect(port.saves).toHaveLength(1);
    expect(port.saves[0]!.key).toBe(KEY);
    expect(port.saves[0]!.state).toEqual({ cells: [], sections: ["1:Top:0"], reading: false });
  });

  it("3.3a saves the cell keys, section keys and reading flag as a NoteViewState", () => {
    const port = new FakePort();
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    port.saves.length = 0;
    foldSome(view);
    advance(DEBOUNCE_MS);
    const saved = port.last()!;
    expect(sorted(saved.cells)).toEqual(["load"]);
    expect(sorted(saved.sections)).toEqual(["1:Top:0"]);
    expect(saved.reading).toBe(true);
  });

  it("3.3a restarts the debounce on each fold change and saves the latest state once", () => {
    const port = new FakePort();
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    port.saves.length = 0;
    setFold(view, { section: ["1:Top:0", true] });
    advance(200);
    setFold(view, { section: ["1:Other:0", true] });
    advance(200);
    expect(port.saves).toHaveLength(0);
    advance(100);
    expect(port.saves).toHaveLength(1);
    expect(sorted(port.last()!.sections)).toEqual(["1:Other:0", "1:Top:0"]);
  });

  it("3.3a saves again after a later fold change", () => {
    const port = new FakePort();
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    port.saves.length = 0;
    setFold(view, { section: ["1:Top:0", true] });
    advance(DEBOUNCE_MS);
    setFold(view, { section: ["1:Top:0", false] });
    advance(DEBOUNCE_MS);
    expect(port.saves).toHaveLength(2);
    expect(port.last()).toEqual({ cells: [], sections: [], reading: false });
  });

  it("3.3a saves the reading flag", () => {
    const port = new FakePort();
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    port.saves.length = 0;
    setFold(view, { reading: true });
    advance(DEBOUNCE_MS);
    expect(port.last()).toEqual({ cells: [], sections: [], reading: true });
  });

  it("3.3a the returned function flushes a pending save at once", () => {
    const port = new FakePort();
    const view = viewOf();
    const unbind = bindFoldViewState(view, { port, key: KEY });
    port.saves.length = 0;
    setFold(view, { section: ["2:Sub:0", true] });
    unbind();
    expect(port.saves).toHaveLength(1);
    expect(port.last()).toEqual({ cells: [], sections: ["2:Sub:0"], reading: false });
    advance(DEBOUNCE_MS * 2);
    expect(port.saves).toHaveLength(1);
  });

  it("3.3a no fold change is saved after the returned function ran", () => {
    const port = new FakePort();
    const view = viewOf();
    const unbind = bindFoldViewState(view, { port, key: KEY });
    unbind();
    port.saves.length = 0;
    setFold(view, { section: ["1:Top:0", true] });
    advance(DEBOUNCE_MS * 2);
    expect(port.saves).toHaveLength(0);
  });

  it("3.3a the returned function with nothing pending saves nothing", () => {
    const port = new FakePort();
    const view = viewOf();
    const unbind = bindFoldViewState(view, { port, key: KEY });
    advance(DEBOUNCE_MS * 2);
    port.saves.length = 0;
    unbind();
    expect(port.saves).toHaveLength(0);
  });
});

describe("the .qmd is never written by view state", () => {
  it("A7 restoring a stored state leaves the document unchanged", () => {
    const port = new FakePort();
    port.store.set(KEY, { cells: ["load"], sections: ["1:Top:0"], reading: true });
    const view = viewOf();
    const before = docToBody(view.state.doc);
    bindFoldViewState(view, { port, key: KEY });
    advance(DEBOUNCE_MS * 3);
    expect(docToBody(view.state.doc)).toBe(before);
    expect(view.state.doc.eq(bodyToDoc(BODY))).toBe(true);
  });

  it("A7 fold changes and their saves leave the serialised body byte-identical", () => {
    const port = new FakePort();
    const view = viewOf();
    const before = docToBody(view.state.doc);
    const unbind = bindFoldViewState(view, { port, key: KEY });
    foldSome(view);
    setFold(view, { all: true });
    advance(DEBOUNCE_MS * 3);
    unbind();
    expect(docToBody(view.state.doc)).toBe(before);
  });

  it("A7 a view restored from the port has the same body as the one that saved", () => {
    const port = new FakePort();
    const first = viewOf();
    const unbind = bindFoldViewState(first, { port, key: KEY });
    foldSome(first);
    advance(DEBOUNCE_MS);
    unbind();

    const second = viewOf();
    bindFoldViewState(second, { port, key: KEY });
    expect(docToBody(second.state.doc)).toBe(docToBody(first.state.doc));
  });

  it("A7 the port receives view state only: every save is a plain cells/sections/reading object", () => {
    const port = new FakePort();
    const view = viewOf();
    bindFoldViewState(view, { port, key: KEY });
    foldSome(view);
    advance(DEBOUNCE_MS);
    expect(port.saves.length).toBeGreaterThan(0);
    for (const { state } of port.saves) {
      expect(Object.keys(state).sort()).toEqual(["cells", "reading", "sections"]);
      expect(JSON.stringify(state)).not.toContain("```");
    }
  });

  it("A7 state restored through the port gives the same folds on a third view", () => {
    const port = new FakePort();
    const first = viewOf();
    const unbindFirst = bindFoldViewState(first, { port, key: KEY });
    foldSome(first);
    advance(DEBOUNCE_MS);
    unbindFirst();
    const second = viewOf();
    const unbindSecond = bindFoldViewState(second, { port, key: KEY });
    advance(DEBOUNCE_MS * 3);
    unbindSecond();
    const third = viewOf();
    bindFoldViewState(third, { port, key: KEY });
    const state = foldStateOf(third.state);
    expect(sorted(state.cells)).toEqual(["load"]);
    expect(sorted(state.sections)).toEqual(["1:Top:0"]);
    expect(state.reading).toBe(true);
  });
});
