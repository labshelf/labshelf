// Tests that the LabShelf editor's registered view posts one command message to its webview for each call of its updates.
import * as vscode from "vscode";

import { createSourceEditorProvider } from "../../../src/writing/sourceEditor/provider";
import type { SourceView } from "../../../src/writing/activeSource";
import { fakeLogger, fakeProjects } from "../../support/writingFixtures";

// The shared vscode mock has no EndOfLine enum and no languages.onDidChangeDiagnostics, which the provider uses.
jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  return {
    ...actual,
    EndOfLine: { LF: 1, CRLF: 2 },
    languages: { ...actual.languages, onDidChangeDiagnostics: jest.fn(() => ({ dispose() {} })), getDiagnostics: jest.fn(() => []) },
  };
});

type Posted = { type: string; [key: string]: unknown };
type Updates = { insertText(text: string): void; insertSnippet(snippet: string): void; wrap(style: "bold" | "italic"): void };

function fakeDocument(file: string, initial: string) {
  const document = {
    uri: vscode.Uri.file(file), languageId: "latex", fileName: file, version: 1, isDirty: false, eol: 1,
    save: jest.fn(async () => true),
    getText: () => initial,
    get lineCount() { return initial.split("\n").length; },
    offsetAt: (position: vscode.Position): number => {
      const lines = initial.split("\n");
      return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
    },
    positionAt: (offset: number): vscode.Position => {
      const before = initial.slice(0, offset).split("\n");
      return new vscode.Position(before.length - 1, before[before.length - 1]!.length);
    },
  };
  return document;
}

/** A webview panel double: records what the page is sent and lets the test speak as the page. */
function fakePanel() {
  const received: Array<(message: unknown) => void> = [];
  const disposed: Array<() => void> = [];
  const postMessage = jest.fn(async (_message: unknown) => true);
  const panel = {
    active: true, visible: true, viewColumn: 1, reveal: jest.fn(),
    webview: {
      options: {}, html: "", cspSource: "vscode-resource:", postMessage,
      asWebviewUri: (uri: vscode.Uri) => ({ toString: () => String(uri.fsPath) }),
      onDidReceiveMessage: (handler: (message: unknown) => void) => { received.push(handler); return { dispose() {} }; },
    },
    onDidDispose: (handler: () => void) => { disposed.push(handler); return { dispose() {} }; },
    onDidChangeViewState: () => ({ dispose() {} }),
  };
  return {
    panel,
    postMessage,
    fromPage: (message: unknown) => received.forEach((handler) => handler(message)),
    close: () => disposed.forEach((handler) => handler()),
    /** The command messages sent to the page so far, in order. */
    commands: (): Posted[] => postMessage.mock.calls.map(([message]) => message as Posted).filter((message) => message.type === "command"),
  };
}

async function open() {
  const register = jest.fn((_view: SourceView, _focused: unknown) => ({ dispose() {} }));
  const provider = createSourceEditorProvider({
    extensionUri: vscode.Uri.file("/ext"),
    projects: fakeProjects([]),
    logger: fakeLogger(),
    activeSource: { register } as never,
    library: { listPapers: async () => [] },
    paperNotes: { read: async () => undefined } as never,
    noteSource: () => ({ listProjectNotes: async () => [], readProjectNote: async () => undefined, listCitedPaperIds: async () => [], readPaperNote: async () => undefined }),
    openNotes: jest.fn(),
  });
  const host = fakePanel();
  await provider.resolveCustomTextEditor(fakeDocument("/p/main.tex", "hello") as never, host.panel as never, { isCancellationRequested: false } as never);
  const view = register.mock.calls[0]![0];
  return { ...host, view, updates: view.updates as Updates };
}

describe("the view's updates", () => {
  it("4.2c the registered view has updates", async () => {
    const { view } = await open();
    expect(view.updates).toBeDefined();
  });

  it("4.2c insertText posts one command message with the text", async () => {
    const { fromPage, updates, commands } = await open();
    fromPage({ type: "ready" });

    updates.insertText("\\alpha");

    expect(commands()).toEqual([{ type: "command", command: { kind: "insertText", text: "\\alpha" } }]);
  });

  it("4.2c insertSnippet posts one command message with the snippet", async () => {
    const { fromPage, updates, commands } = await open();
    fromPage({ type: "ready" });

    updates.insertSnippet("\\begin{table}${1}\n$0");

    expect(commands()).toEqual([{ type: "command", command: { kind: "insertSnippet", snippet: "\\begin{table}${1}\n$0" } }]);
  });

  it.each(["bold", "italic"] as const)("4.2c wrap(%s) posts one command message with the style", async (style) => {
    const { fromPage, updates, commands } = await open();
    fromPage({ type: "ready" });

    updates.wrap(style);

    expect(commands()).toEqual([{ type: "command", command: { kind: "wrap", style } }]);
  });

  it("4.2c each call posts its own message, in call order", async () => {
    const { fromPage, updates, commands } = await open();
    fromPage({ type: "ready" });

    updates.insertText("a");
    updates.wrap("bold");
    updates.insertText("b");

    expect(commands()).toEqual([
      { type: "command", command: { kind: "insertText", text: "a" } },
      { type: "command", command: { kind: "wrap", style: "bold" } },
      { type: "command", command: { kind: "insertText", text: "b" } },
    ]);
  });

  it("4.2c the message goes to the webview of the panel the view belongs to", async () => {
    const first = await open();
    const second = await open();
    first.fromPage({ type: "ready" });
    second.fromPage({ type: "ready" });

    first.updates.insertText("only first");

    expect(first.commands()).toHaveLength(1);
    expect(second.commands()).toHaveLength(0);
  });
});
