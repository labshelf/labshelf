/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The source editor reports its main selection (anchor, head, 1-based line of the head) and accepts extra CodeMirror extensions.
import { EditorSelection, EditorState, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger } from "@labshelf/core";
import { mountSourceEditor, type SourceFileAccess } from "../../../../src/writing/dom/sourceEditor/editor";
import { createSelectionListener } from "../../../../src/writing/dom/sourceEditor/selectionListener";

type Selection = { anchor: number; head: number; line: number };

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

// The new deps (extensions, onSelection) are passed untyped so the file compiles before SourceEditorDeps has them.
async function mount(text: string, extra: Record<string, unknown> = {}) {
  const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => text, write: async () => undefined };
  const host = document.createElement("div");
  const deps = { projectId: "p", path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty: () => undefined, ...extra };
  const editor = await mountSourceEditor(host, deps as Parameters<typeof mountSourceEditor>[1]);
  const view = EditorView.findFromDOM(host)!;
  return { editor, view };
}

function standalone(text: string) {
  const seen: Selection[] = [];
  const view = new EditorView({
    parent: document.createElement("div"),
    state: EditorState.create({ doc: text, extensions: [createSelectionListener((s) => seen.push(s))] }),
  });
  return { view, seen };
}

describe("createSelectionListener", () => {
  it("5.3a reports anchor, head and the 1-based line of the head when the selection changes", () => {
    const { view, seen } = standalone("a\nbb\nccc\n");
    view.dispatch({ selection: EditorSelection.single(2, 4) });
    expect(seen).toEqual([{ anchor: 2, head: 4, line: 2 }]);
    view.destroy();
  });

  it("5.3a uses the line of the head, not of the anchor, for a backwards selection", () => {
    const { view, seen } = standalone("a\nbb\nccc\n");
    view.dispatch({ selection: EditorSelection.single(7, 0) });
    expect(seen).toEqual([{ anchor: 7, head: 0, line: 1 }]);
    view.destroy();
  });

  it("5.3a does not report an edit that leaves the selection in place", () => {
    const { view, seen } = standalone("a\nbb\nccc\n");
    view.dispatch({ selection: EditorSelection.cursor(0) });
    seen.length = 0;
    view.dispatch({ changes: { from: 9, insert: "!" } });
    expect(seen).toEqual([]);
    view.destroy();
  });

  it("5.3a reports each distinct selection change", () => {
    const { view, seen } = standalone("a\nbb\nccc\n");
    view.dispatch({ selection: EditorSelection.cursor(2) });
    view.dispatch({ selection: EditorSelection.cursor(5) });
    expect(seen).toEqual([{ anchor: 2, head: 2, line: 2 }, { anchor: 5, head: 5, line: 3 }]);
    view.destroy();
  });
});

// What createSelectionListener reports for one dispatch on a standalone view: the reference the mounted editor must match.
function reference(text: string, dispatch: (view: EditorView) => void): Selection[] {
  const { view, seen } = standalone(text);
  dispatch(view);
  view.destroy();
  return seen;
}

describe("mountSourceEditor hooks", () => {
  it("5.3a calls deps.onSelection with anchor, head and line when the selection changes", async () => {
    const text = "a\nbb\nccc\n";
    const expected = reference(text, (v) => v.dispatch({ selection: EditorSelection.single(2, 4) }));
    const seen: Selection[] = [];
    const { editor, view } = await mount(text, { onSelection: (s: Selection) => seen.push(s) });
    seen.length = 0;
    view.dispatch({ selection: EditorSelection.single(2, 4) });
    expect(seen).toEqual(expected);
    expect(seen).toEqual([{ anchor: 2, head: 4, line: 2 }]);
    await editor.dispose();
  });

  it("5.3a does not call deps.onSelection for an edit that leaves the selection in place", async () => {
    const text = "a\nbb\nccc\n";
    const expected = reference(text, (v) => { v.dispatch({ selection: EditorSelection.cursor(0) }); v.dispatch({ changes: { from: 9, insert: "!" } }); });
    const seen: Selection[] = [];
    const { editor, view } = await mount(text, { onSelection: (s: Selection) => seen.push(s) });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    seen.length = 0;
    view.dispatch({ changes: { from: 9, insert: "!" } });
    expect(seen).toEqual([]);
    expect(expected).toHaveLength(1);
    await editor.dispose();
  });

  it("5.3b runs an update listener passed in deps.extensions", async () => {
    const reported: Selection[] = [];
    let updates = 0;
    const extensions = [createSelectionListener((s) => reported.push(s)), EditorView.updateListener.of(() => { updates++; })];
    const { editor, view } = await mount("abc", { extensions });
    const before = updates;
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(updates).toBeGreaterThan(before);
    await editor.dispose();
  });

  it("5.3b keeps a createSelectionListener passed in deps.extensions active in the editor", async () => {
    const reported: Selection[] = [];
    const { editor, view } = await mount("a\nbb\n", { extensions: [createSelectionListener((s) => reported.push(s))] });
    reported.length = 0;
    view.dispatch({ selection: EditorSelection.cursor(3) });
    expect(reported).toEqual([{ anchor: 3, head: 3, line: 2 }]);
    await editor.dispose();
  });

  it("5.3b makes a facet value from deps.extensions visible in the editor state", async () => {
    const marker = Facet.define<string, string[]>({ combine: (values) => [...values] });
    const extensions = [createSelectionListener(() => undefined), marker.of("mine")];
    const { editor, view } = await mount("abc", { extensions });
    expect(view.state.facet(marker)).toEqual(["mine"]);
    await editor.dispose();
  });
});
