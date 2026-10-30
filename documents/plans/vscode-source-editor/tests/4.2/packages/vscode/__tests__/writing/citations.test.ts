// Tests that the insert, wrap and cite commands act on the LabShelf editor's updates when it is the current source, and on the native editor otherwise.
import * as vscode from "vscode";

import {
  MATH_SYMBOLS, createImageSnippet, createTableSnippet, deriveSymbolSource,
} from "@labshelf/core";
import { registerInsertActions, registerEditorActions } from "../../src/writing/citations/editing";
import { registerCitationFromLibrary, UPDATE_BIBLIOGRAPHY_COMMAND } from "../../src/writing/citations/completion";
import type { SourceView } from "../../src/writing/activeSource";
import { citationWorkspace } from "../support/citationFixtures";
import { fakeHost, fakeProjects, readyEntry } from "../support/writingFixtures";

const window = vscode.window as unknown as { activeTextEditor: unknown } & Record<string, jest.Mock>;

function updatesDouble() {
  return { insertText: jest.fn(), insertSnippet: jest.fn(), wrap: jest.fn() };
}

/** A LabShelf view on the file, with updates when `withUpdates` is true. */
function labshelfView(file: string) {
  const updates = updatesDouble();
  const view: SourceView & { updates: ReturnType<typeof updatesDouble> } = {
    uri: vscode.Uri.file(file), line: () => 1, reveal: jest.fn(), updates,
  };
  return { view, updates };
}

/** A native view: no updates. */
function nativeView(file: string): SourceView {
  return { uri: vscode.Uri.file(file), line: () => 1, reveal: jest.fn() };
}

/** A native text editor double that records every edit made to it. */
function nativeEditor(file: string, languageId: string) {
  return {
    document: { uri: vscode.Uri.file(file), languageId, getText: () => "", offsetAt: () => 0, positionAt: () => new vscode.Position(0, 0) },
    selections: [] as unknown[],
    edit: jest.fn(async () => true),
    insertSnippet: jest.fn(async () => true),
  };
}

function activeSourceOf(view: SourceView | undefined) {
  return { current: () => view };
}

const context = (): vscode.ExtensionContext => ({ subscriptions: [] }) as unknown as vscode.ExtensionContext;

function run(id: string): Promise<void> {
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.filter(([name]) => name === id).pop();
  if (!call) { throw new Error(`${id} is not registered`); }
  return call[1]();
}

const PROJECT = "/code/repo";
const projectsFor = (main: string) => fakeProjects([readyEntry(PROJECT, { main, settings: { id: "repo", format: main.endsWith(".typ") ? "typst" : "latex" } })]);

beforeEach(() => {
  window.activeTextEditor = undefined;
  window["showQuickPick"]!.mockReset();
  window["showInputBox"]!.mockReset();
  window["showOpenDialog"]!.mockReset();
});

describe("bold and italic", () => {
  function setup(current: SourceView | undefined) {
    registerEditorActions({ context: context(), host: fakeHost(), activeSource: activeSourceOf(current) });
  }

  it.each([["bold", "labshelf.writing.bold"], ["italic", "labshelf.writing.italic"]] as const)(
    "4.2a %s wraps through the LabShelf view's updates, once, and edits no text editor", async (style, command) => {
      const { view, updates } = labshelfView(`${PROJECT}/main.tex`);
      const editor = nativeEditor("/elsewhere/other.tex", "latex");
      window.activeTextEditor = editor;
      setup(view);

      await run(command);

      expect(updates.wrap).toHaveBeenCalledTimes(1);
      expect(updates.wrap).toHaveBeenCalledWith(style);
      expect(updates.insertText).not.toHaveBeenCalled();
      expect(updates.insertSnippet).not.toHaveBeenCalled();
      expect(editor.edit).not.toHaveBeenCalled();
    },
  );

  it("4.2a wraps through the LabShelf view's updates when no native editor is active", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.typ`);
    setup(view);

    await run("labshelf.writing.bold");

    expect(updates.wrap).toHaveBeenCalledTimes(1);
    expect(updates.wrap).toHaveBeenCalledWith("bold");
  });

  it("4.2a bold keeps editing the native editor when the current source is native", async () => {
    const editor = nativeEditor(`${PROJECT}/main.tex`, "latex");
    window.activeTextEditor = editor;
    setup(nativeView(`${PROJECT}/main.tex`));

    await run("labshelf.writing.bold");

    expect(editor.edit).toHaveBeenCalledTimes(1);
  });

  it("4.2a italic keeps editing the native editor when no source is current", async () => {
    const editor = nativeEditor(`${PROJECT}/main.typ`, "typst");
    window.activeTextEditor = editor;
    setup(undefined);

    await run("labshelf.writing.italic");

    expect(editor.edit).toHaveBeenCalledTimes(1);
  });
});

describe("insert symbol, table and image", () => {
  function setup(current: SourceView | undefined, main = "main.tex") {
    const projects = projectsFor(main);
    registerInsertActions({ context: context(), host: fakeHost(), projects, activeSource: activeSourceOf(current) });
    return projects;
  }

  /** Picks the first symbol of the catalog, as the user would. */
  function pickFirstSymbol(): void {
    window["showQuickPick"]!.mockImplementation(async (items: Array<{ source?: string }>) => items.find((item) => item.source !== undefined));
  }

  it("4.2a symbol inserts the LaTeX source through updates.insertText for a .tex view, once", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.tex`);
    const editor = nativeEditor("/elsewhere/other.tex", "latex");
    window.activeTextEditor = editor;
    pickFirstSymbol();
    setup(view);

    await run("labshelf.writing.insertSymbol");

    expect(updates.insertText).toHaveBeenCalledTimes(1);
    expect(updates.insertText).toHaveBeenCalledWith(deriveSymbolSource(MATH_SYMBOLS[0]!, "latex"));
    expect(updates.insertSnippet).not.toHaveBeenCalled();
    expect(editor.insertSnippet).not.toHaveBeenCalled();
    expect(editor.edit).not.toHaveBeenCalled();
  });

  it("4.2a symbol inserts the Typst source for a .typ view", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.typ`);
    pickFirstSymbol();
    setup(view, "main.typ");

    await run("labshelf.writing.insertSymbol");

    expect(updates.insertText).toHaveBeenCalledTimes(1);
    expect(updates.insertText).toHaveBeenCalledWith(deriveSymbolSource(MATH_SYMBOLS[0]!, "typst"));
  });

  it("4.2a symbol inserts nothing when the pick is dismissed", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.tex`);
    window["showQuickPick"]!.mockResolvedValue(undefined);
    setup(view);

    await run("labshelf.writing.insertSymbol");

    expect(updates.insertText).not.toHaveBeenCalled();
  });

  it("4.2a symbol keeps inserting a snippet into the native editor when the current source is native", async () => {
    const editor = nativeEditor(`${PROJECT}/main.tex`, "latex");
    window.activeTextEditor = editor;
    pickFirstSymbol();
    setup(nativeView(`${PROJECT}/main.tex`));

    await run("labshelf.writing.insertSymbol");

    expect(editor.insertSnippet).toHaveBeenCalledTimes(1);
  });

  it("4.2a table inserts the core LaTeX table snippet through updates.insertSnippet for a .tex view, once", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.tex`);
    const editor = nativeEditor("/elsewhere/other.tex", "latex");
    window.activeTextEditor = editor;
    window["showInputBox"]!.mockResolvedValue("2x3");
    setup(view);

    await run("labshelf.writing.insertTable");

    expect(updates.insertSnippet).toHaveBeenCalledTimes(1);
    expect(updates.insertSnippet).toHaveBeenCalledWith(createTableSnippet("latex", { columns: 2, rows: 3 }));
    expect(updates.insertText).not.toHaveBeenCalled();
    expect(editor.insertSnippet).not.toHaveBeenCalled();
  });

  it("4.2a table inserts the Typst table snippet for a .typ view", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.typ`);
    window["showInputBox"]!.mockResolvedValue("3x1");
    setup(view, "main.typ");

    await run("labshelf.writing.insertTable");

    expect(updates.insertSnippet).toHaveBeenCalledTimes(1);
    expect(updates.insertSnippet).toHaveBeenCalledWith(createTableSnippet("typst", { columns: 3, rows: 1 }));
  });

  it("4.2a table inserts nothing when the size is not entered", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.tex`);
    window["showInputBox"]!.mockResolvedValue(undefined);
    setup(view);

    await run("labshelf.writing.insertTable");

    expect(updates.insertSnippet).not.toHaveBeenCalled();
  });

  it("4.2a table keeps inserting a snippet into the native editor when the current source is native", async () => {
    const editor = nativeEditor(`${PROJECT}/main.tex`, "latex");
    window.activeTextEditor = editor;
    window["showInputBox"]!.mockResolvedValue("2x2");
    setup(nativeView(`${PROJECT}/main.tex`));

    await run("labshelf.writing.insertTable");

    expect(editor.insertSnippet).toHaveBeenCalledTimes(1);
  });

  it("4.2a image inserts the core snippet of a project image through updates.insertSnippet, using the view's own path", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.tex`);
    const editor = nativeEditor("/elsewhere/other.tex", "latex");
    window.activeTextEditor = editor;
    window["showOpenDialog"]!.mockResolvedValue([vscode.Uri.file(`${PROJECT}/fig.png`)]);
    setup(view);

    await run("labshelf.writing.insertImage");

    expect(updates.insertSnippet).toHaveBeenCalledTimes(1);
    expect(updates.insertSnippet).toHaveBeenCalledWith(createImageSnippet("latex", "fig.png"));
    expect(editor.insertSnippet).not.toHaveBeenCalled();
  });

  it("4.2a image inserts the Typst snippet for a .typ view", async () => {
    const { view, updates } = labshelfView(`${PROJECT}/main.typ`);
    window["showOpenDialog"]!.mockResolvedValue([vscode.Uri.file(`${PROJECT}/fig.png`)]);
    setup(view, "main.typ");

    await run("labshelf.writing.insertImage");

    expect(updates.insertSnippet).toHaveBeenCalledTimes(1);
    expect(updates.insertSnippet).toHaveBeenCalledWith(createImageSnippet("typst", "fig.png"));
  });

  it("4.2a image inserts nothing when the view's file is outside every project", async () => {
    const { view, updates } = labshelfView("/elsewhere/loose.tex");
    window["showOpenDialog"]!.mockResolvedValue([vscode.Uri.file(`${PROJECT}/fig.png`)]);
    setup(view);

    await run("labshelf.writing.insertImage");

    expect(updates.insertSnippet).not.toHaveBeenCalled();
  });

  it("4.2a image keeps inserting a snippet into the native editor when the current source is native", async () => {
    const editor = nativeEditor(`${PROJECT}/main.tex`, "latex");
    window.activeTextEditor = editor;
    window["showOpenDialog"]!.mockResolvedValue([vscode.Uri.file(`${PROJECT}/fig.png`)]);
    setup(nativeView(`${PROJECT}/main.tex`));

    await run("labshelf.writing.insertImage");

    expect(editor.insertSnippet).toHaveBeenCalledTimes(1);
  });
});

describe("cite from library", () => {
  const execute = vscode.commands.executeCommand as jest.Mock;

  function setup(current: SourceView | undefined, format: "latex" | "typst" = "latex") {
    const workspace = citationWorkspace(format);
    window["showQuickPick"]!.mockImplementation(async (items: unknown[]) => items[0]);
    registerCitationFromLibrary(context(), workspace, activeSourceOf(current));
    return workspace;
  }

  it("4.2a inserts the LaTeX citation through updates.insertText once, then updates the bibliography for the view's uri", async () => {
    const { view, updates } = labshelfView("/code/repo/a.tex");
    const editor = nativeEditor("/elsewhere/other.tex", "latex");
    window.activeTextEditor = editor;
    setup(view);

    await run("labshelf.writing.citeFromLibrary");

    expect(updates.insertText).toHaveBeenCalledTimes(1);
    expect(updates.insertText).toHaveBeenCalledWith("\\cite{vaswani2017}");
    expect(editor.edit).not.toHaveBeenCalled();
    const update = execute.mock.calls.filter(([command]) => command === UPDATE_BIBLIOGRAPHY_COMMAND);
    expect(update).toHaveLength(1);
    expect((update[0] as [string, vscode.Uri])[1].fsPath).toBe(view.uri.fsPath);
  });

  it("4.2a inserts the Typst citation for a .typ view", async () => {
    const { view, updates } = labshelfView("/code/repo/a.typ");
    setup(view, "typst");

    await run("labshelf.writing.citeFromLibrary");

    expect(updates.insertText).toHaveBeenCalledTimes(1);
    expect(updates.insertText).toHaveBeenCalledWith("@vaswani2017");
  });

  it("4.2a inserts nothing and updates no bibliography when the pick is dismissed", async () => {
    const { view, updates } = labshelfView("/code/repo/a.tex");
    setup(view);
    window["showQuickPick"]!.mockResolvedValue(undefined);

    await run("labshelf.writing.citeFromLibrary");

    expect(updates.insertText).not.toHaveBeenCalled();
    expect(execute.mock.calls.filter(([command]) => command === UPDATE_BIBLIOGRAPHY_COMMAND)).toHaveLength(0);
  });

  it("4.2a does nothing for a LabShelf view on a file outside every project", async () => {
    const { view, updates } = labshelfView("/elsewhere/loose.tex");
    setup(view);

    await run("labshelf.writing.citeFromLibrary");

    expect(updates.insertText).not.toHaveBeenCalled();
  });

  it("4.2a keeps editing the native editor when the current source is native", async () => {
    const edits: string[] = [];
    const editor = {
      document: { uri: vscode.Uri.file("/code/repo/a.tex") },
      selections: [{ id: 1 }],
      edit: jest.fn(async (build: (builder: { replace: (selection: unknown, text: string) => void }) => void) => {
        build({ replace: (_selection, text) => edits.push(text) });
        return true;
      }),
    };
    window.activeTextEditor = editor;
    setup(nativeView("/code/repo/a.tex"));

    await run("labshelf.writing.citeFromLibrary");

    expect(edits).toEqual(["\\cite{vaswani2017}"]);
    expect(execute.mock.calls.filter(([command]) => command === UPDATE_BIBLIOGRAPHY_COMMAND)).toHaveLength(1);
  });
});
