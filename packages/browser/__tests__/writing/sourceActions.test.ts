/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The source tab's title-bar actions: their order, labels and overflow, and what they do before the editor has loaded.
import type { ILogger, LibraryFileSystem, ProjectEntry } from "@labshelf/core";
import { pickQuickEntry } from "@labshelf/core/dom";
import { createSourceActions, splitSourceActions, type SourceActionDeps } from "../../src/writing/source";

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), showToast: jest.fn(), pickQuickEntry: jest.fn(async () => undefined), askInputBox: jest.fn(async () => undefined) }));

function setup(over: Partial<SourceActionDeps> = {}) {
  const edits = { insertText: jest.fn(), insertSnippet: jest.fn(), wrap: jest.fn() };
  const openHistory = jest.fn();
  const openSearch = jest.fn();
  const entry = { kind: "ready", folder: "lib/p", main: "main.tex", settings: { id: "p" } } as unknown as ProjectEntry;
  const actions = createSourceActions({
    projectId: "p", path: "main.tex", language: "latex", fs: {} as LibraryFileSystem,
    logger: { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as ILogger,
    target: () => ({ edits, flush: async () => true, entry }), openHistory, openSearch, papers: async () => [], ...over,
  });
  const run = (id: string): void => actions.find((action) => action.id === id)!.run();
  return { actions, edits, openHistory, openSearch, run };
}

describe("splitSourceActions", () => {
  it("groups the toolbar buttons like the VS Code editor and leaves the note actions to the tab menu", () => {
    const { toolbar, tab } = splitSourceActions(setup().actions);
    expect(toolbar.map((group) => group.map(({ label, glyph }) => [label, glyph]))).toEqual([
      [["Bold", "bold"], ["Italic", "italic"]],
      [["Insert Symbol", "symbol-operator"], ["Insert Table", "table"], ["Insert Image", "file-media"], ["Cite from Library", "quote"]],
      [["Search in Project", "search"], ["Show Project History", "history"]],
    ]);
    expect(tab.map(({ id, overflow }) => [id, overflow])).toEqual([["insertFromNote", true], ["updateFromNote", true], ["showNoteDifferences", true]]);
  });

  it("runs the same actions as the tab did, and none of them edits without a target", () => {
    const { actions, edits } = setup({ target: () => undefined });
    splitSourceActions(actions).toolbar[0]![0]!.run();
    expect(edits.wrap).not.toHaveBeenCalled();
  });
});

describe("createSourceActions", () => {
  it("lists the actions in the VS Code order, with bold and italic in the overflow menu", () => {
    const { actions } = setup();
    expect(actions.map(({ id, label, icon, overflow }) => [id, label, icon, overflow ?? false])).toEqual([
      ["history", "Show Project History", "history", false],
      ["insertSymbol", "Insert Symbol", "symbol-operator", false],
      ["insertTable", "Insert Table", "table", false],
      ["insertImage", "Insert Image", "file-media", false],
      ["searchInProject", "Search in Project", "search", false],
      ["citeFromLibrary", "Cite from Library", "quote", false],
      ["bold", "Bold", "bold", true],
      ["italic", "Italic", "italic", true],
      ["insertFromNote", "Insert from note", "symbol-operator", true],
      ["updateFromNote", "Update from note", "refresh", true],
      ["showNoteDifferences", "Show differences", "replace", true],
    ]);
  });

  it("opens the project history and wraps the selection", () => {
    const { run, openHistory, edits } = setup();
    run("history");
    run("bold");
    run("italic");
    expect(openHistory).toHaveBeenCalledTimes(1);
    expect(edits.wrap.mock.calls).toEqual([["bold"], ["italic"]]);
  });

  it("opens the project search", () => {
    const { run, openSearch } = setup();
    run("searchInProject");
    expect(openSearch).toHaveBeenCalledTimes(1);
  });

  it("does nothing that needs the editor before it has loaded, but still opens the history", () => {
    const { run, openHistory, edits } = setup({ target: () => undefined });
    for (const id of ["insertSymbol", "insertTable", "insertImage", "citeFromLibrary", "bold", "italic"]) run(id);
    run("history");
    expect(pickQuickEntry).not.toHaveBeenCalled();
    expect(edits.wrap).not.toHaveBeenCalled();
    expect(openHistory).toHaveBeenCalledTimes(1);
  });
});
