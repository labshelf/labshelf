// Spec 6.3: the VS Code deck bridge and the files of a multi-file talk: deckSourceAt answers the line and project path of a hit in an
// included file, deckBoxes takes a path, and writeFile writes a project file through applyEdit, refusing a path outside the project.
// Acceptance ids: 6.3c.
import * as vscode from "vscode";

import { posixPathOps } from "@labshelf/core";
import { createDeckWorkspaceBridge, provideDeckWorkspace } from "../../../src/writing/sourceEditor/deckWorkspaceHost";

const box = (tag: number, line: number): unknown => ({ tag, line, left: 10, right: 50, top: 10, bottom: 30, baseline: 28, children: [] });
const index = {
  files: new Map([[1, "/proj/talk/main.tex"], [2, "/proj/talk/part.tex"], [3, "/usr/share/texmf/beamer.sty"]]),
  pages: new Map([[1, [box(1, 4)]], [2, [box(2, 7)]], [3, [box(3, 9)]]]),
  byFile: new Map(),
};

jest.mock("@labshelf/core", () => {
  const actual = jest.requireActual("@labshelf/core");
  return { ...actual, ProjectSynctex: class { load = async () => ({ status: "found", index }); } };
});

const project = { kind: "ready", folder: "/proj", main: "talk/main.tex", settings: {} };
const document = { uri: vscode.Uri.file("/proj/talk/main.tex"), getText: () => "" } as unknown as vscode.TextDocument;
let disposable: vscode.Disposable;

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
  disposable = provideDeckWorkspace({ projects: { list: () => [project], paths: posixPathOps, data: {}, fs: {} } as never, logger: { log: jest.fn(), error: jest.fn() } as never, recompile: jest.fn() });
});
afterEach(() => disposable.dispose());

const bridge = () => createDeckWorkspaceBridge(document, {} as vscode.Webview);

describe("deckSourceAt", () => {
  it("6.3c answers the line and the root path of a hit in the main file", async () => {
    expect(await bridge().handle("deckSourceAt", { page: 1, x: 20, y: 20 })).toEqual({ line: 4, path: "talk/main.tex" });
  });

  it("6.3c answers the line and the project path of a hit in an included file", async () => {
    expect(await bridge().handle("deckSourceAt", { page: 2, x: 20, y: 20 })).toEqual({ line: 7, path: "talk/part.tex" });
  });

  it("6.3c answers undefined for a hit outside the project", async () => {
    expect(await bridge().handle("deckSourceAt", { page: 3, x: 20, y: 20 })).toBeUndefined();
  });
});

describe("deckBoxes", () => {
  it("6.3c gives the boxes of the file named by path, else of the main file", async () => {
    expect(await bridge().handle("deckBoxes", { from: 1, to: 10, path: "talk/part.tex" })).toEqual([{ page: 2, left: 10, top: 10, right: 50, bottom: 30 }]);
    expect(await bridge().handle("deckBoxes", { from: 1, to: 10 })).toEqual([{ page: 1, left: 10, top: 10, right: 50, bottom: 30 }]);
  });
});

describe("writeFile", () => {
  it("6.3c replaces an open document's whole text through applyEdit and saves it", async () => {
    const save = jest.fn(async () => true);
    const open = { uri: vscode.Uri.file("/proj/talk/part.tex"), getText: () => "old text", positionAt: (offset: number) => new vscode.Position(0, offset), save };
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [open];
    await bridge().handle("writeFile", { path: "talk/part.tex", text: "new text" });
    const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0]![0] as { replacements: Array<{ uri: vscode.Uri; text: string; range: vscode.Range }> };
    expect(edit.replacements).toHaveLength(1);
    expect(edit.replacements[0]!.uri.fsPath).toBe("/proj/talk/part.tex");
    expect(edit.replacements[0]!.text).toBe("new text");
    expect(edit.replacements[0]!.range.end.character).toBe("old text".length);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("6.3c refuses a path outside the project", async () => {
    await expect(bridge().handle("writeFile", { path: "../etc/passwd", text: "x" })).rejects.toThrow("outside the project");
    await expect(bridge().handle("writeFile", { path: "/etc/passwd", text: "x" })).rejects.toThrow("outside the project");
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });
});

// Spec 7.1: the host reports the cursor of another file of the deck's project, so Split selects the slide under it. Acceptance id: 7.1d.
describe("deckCursor", () => {
  type SelectionEvent = { textEditor: { document: { uri: vscode.Uri } }; selections: Array<{ active: { line: number } }> };
  const move = (path: string, line: number): void => {
    const handler = (vscode.window.onDidChangeTextEditorSelection as jest.Mock).mock.calls.at(-1)![0] as (event: SelectionEvent) => void;
    handler({ textEditor: { document: { uri: vscode.Uri.file(path) } }, selections: [{ active: { line } }] });
  };

  it("7.1d posts the project path and 1-based line of a selection in an included file", () => {
    const post = jest.fn();
    const watching = bridge().watch(post);
    move("/proj/talk/part.tex", 6);
    expect(post).toHaveBeenCalledWith({ type: "deckCursor", path: "talk/part.tex", line: 7 });
    watching.dispose();
  });

  it("7.1d posts nothing for the deck's own document or a file outside the project", () => {
    const post = jest.fn();
    const watching = bridge().watch(post);
    move("/proj/talk/main.tex", 2);
    move("/elsewhere/notes.tex", 2);
    expect(post.mock.calls.filter(([message]) => (message as { type: string }).type === "deckCursor")).toEqual([]);
    watching.dispose();
  });
});

// Spec 7.3: an image dropped from the Explorer resolves, relative to the deck's folder, when it is inside the project. Acceptance id: 7.3d.
describe("deckDropImage", () => {
  it("7.3d resolves a file uri inside the project relative to the deck's folder", async () => {
    expect(await bridge().handle("deckDropImage", { uris: ["file:///proj/figures/plot.png"] })).toBe("../figures/plot.png");
  });

  it("7.3d refuses a file outside the project and a file that is not an image", async () => {
    expect(await bridge().handle("deckDropImage", { uris: ["file:///elsewhere/plot.png"] })).toBeNull();
    expect(await bridge().handle("deckDropImage", { uris: ["file:///proj/notes.txt"] })).toBeNull();
  });
});
