// Tests the LabShelf deck editor's registration and its provider: the contributed custom editor, the ready-gated init, the webview resources and the page edit round trip.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { registerDeckEditor } from "../../../src/writing/deckEditor/index";
import { createDeckEditorProvider } from "../../../src/writing/deckEditor/provider";
import { fakeLogger, fakeProjects } from "../../support/writingFixtures";

// The shared mock's WorkspaceEdit only replaces, Uri has no with(), TextEdit has no replace() and tabGroups has no activeTabGroup.
jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  type Op = { kind: "replace" | "insert" | "createFile"; uri: { fsPath: string }; range?: unknown; text?: string; options?: unknown };
  class WorkspaceEdit {
    ops: Op[] = [];
    get replacements(): Op[] { return this.ops.filter((op) => op.kind !== "createFile"); }
    get size(): number { return new Set(this.ops.map((op) => op.uri.fsPath)).size; }
    replace(uri: Op["uri"], range: unknown, text: string): void { this.ops.push({ kind: "replace", uri, range, text }); }
    insert(uri: Op["uri"], position: unknown, text: string): void { this.ops.push({ kind: "insert", uri, range: new actual.Range(position, position), text }); }
    createFile(uri: Op["uri"], options?: unknown): void { this.ops.push({ kind: "createFile", uri, options }); }
    set(uri: Op["uri"], edits: Array<{ range: unknown; newText: string }>): void { for (const e of edits) this.ops.push({ kind: "replace", uri, range: e.range, text: e.newText }); }
  }
  actual.TextEdit.replace = (range: unknown, newText: string) => new actual.TextEdit(range, newText);
  actual.Uri.prototype.with = function (this: { scheme: string; authority: string; path: string; query: string; fragment: string; fsPath: string }, change: Record<string, string | undefined>) {
    const uri = new actual.Uri(change.scheme ?? this.scheme, change.authority ?? this.authority, change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment);
    uri.fsPath = change.path ?? this.fsPath;
    return uri;
  };
  return {
    ...actual,
    WorkspaceEdit,
    window: { ...actual.window, tabGroups: { ...actual.window.tabGroups, activeTabGroup: { activeTab: undefined, tabs: [] } } },
  };
});

type Op = { kind: "replace" | "insert" | "createFile"; uri: vscode.Uri; range?: vscode.Range; text?: string };
type Posted = { type: string; [key: string]: unknown };

const offsetIn = (text: string, position: vscode.Position): number => {
  const lines = text.split("\n");
  return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
};

/** A TextDocument double whose text the fake workspace edits. */
function fakeDocument(file: string, initial: string) {
  const document = {
    uri: vscode.Uri.file(file), fileName: file, languageId: file.endsWith(".css") ? "css" : "html",
    version: 1, isDirty: false, isUntitled: false, isClosed: false, eol: 1,
    text: initial,
    save: jest.fn(async () => { document.isDirty = false; return true; }),
    getText: (range?: vscode.Range) => (range ? document.text.slice(offsetIn(document.text, range.start), offsetIn(document.text, range.end)) : document.text),
    get lineCount() { return document.text.split("\n").length; },
    offsetAt: (position: vscode.Position) => offsetIn(document.text, position),
    positionAt: (offset: number): vscode.Position => {
      const before = document.text.slice(0, offset).split("\n");
      return new vscode.Position(before.length - 1, before[before.length - 1]!.length);
    },
  };
  return document;
}
type FakeDocument = ReturnType<typeof fakeDocument>;

const docs = new Map<string, FakeDocument>();
const workspace = vscode.workspace as unknown as {
  applyEdit: jest.Mock; openTextDocument: jest.Mock; _fireTextDocumentChange(event: unknown): void;
  fs: { stat: jest.Mock; readFile: jest.Mock };
};

function externalChange(document: FakeDocument, text: string): void {
  document.text = text;
  document.version += 1;
  document.isDirty = true;
  workspace._fireTextDocumentChange({ document, contentChanges: [{ text }], reason: undefined });
}

const opsOf = (edit: unknown): Op[] => (edit as { ops: Op[] }).ops;

/** Applies an edit to the fake documents and fires their change events before resolving, as VS Code does. */
function applyToWorld(edit: unknown): boolean {
  const ops = opsOf(edit);
  for (const op of ops) {
    if (op.kind === "createFile" && !docs.has(op.uri.fsPath)) docs.set(op.uri.fsPath, fakeDocument(op.uri.fsPath, ""));
  }
  const byPath = new Map<string, Op[]>();
  for (const op of ops) if (op.kind !== "createFile") byPath.set(op.uri.fsPath, [...(byPath.get(op.uri.fsPath) ?? []), op]);
  const changed: FakeDocument[] = [];
  for (const [file, list] of byPath) {
    const document = docs.get(file);
    if (!document) return false;
    const spans = list.map((op) => ({ from: offsetIn(document.text, op.range!.start), to: offsetIn(document.text, op.range!.end), text: op.text ?? "" }))
      .sort((a, b) => b.from - a.from);
    document.text = spans.reduce((text, span) => text.slice(0, span.from) + span.text + text.slice(span.to), document.text);
    document.version += 1;
    document.isDirty = true;
    changed.push(document);
  }
  changed.forEach((document) => workspace._fireTextDocumentChange({ document, contentChanges: [{ text: document.text }], reason: undefined }));
  return true;
}

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

/** A webview panel double: records what the page is sent and lets the test speak as the page. */
function fakePanel() {
  const received: Array<(message: unknown) => void> = [];
  const disposed: Array<() => void> = [];
  const postMessage = jest.fn(async (_message: unknown) => true);
  const panel = {
    active: true, visible: true, viewColumn: 1, reveal: jest.fn(),
    webview: {
      options: {} as { enableScripts?: boolean; localResourceRoots?: vscode.Uri[] }, html: "", cspSource: "vscode-resource:", postMessage,
      asWebviewUri: (uri: vscode.Uri) => ({ toString: () => `vscode-resource:${uri.fsPath}` }),
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
    posted: (): Posted[] => postMessage.mock.calls.map(([message]) => message as Posted),
  };
}

const TALK = `<!doctype html>
<html data-deck="talk">
<head><link rel="stylesheet" href="theme.css" data-deck-theme></head>
<body>
<section data-slide><div data-block id="b1" style="left: 10px; top: 20px; width: 300px; height: 100px"><p>Hello</p></div></section>
</body>
</html>
`;
const THEME = ":root {\n  --deck-accent: #336699;\n}\n";

let closers: Array<() => void> = [];
const trim = (file: string) => file.replace(/\/+$/, "");

/** Writes a deck folder and a built extension to temp dirs and resolves the deck editor on the deck document. */
async function open(options: { folder?: string; deck?: string; theme?: string | null } = {}) {
  const library = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-deck-lib-"));
  const folder = path.join(library, options.folder ?? "talks/t1");
  fs.mkdirSync(folder, { recursive: true });
  const deckPath = path.join(folder, "deck.html");
  const themePath = path.join(folder, "theme.css");
  const text = options.deck ?? TALK;
  const theme = options.theme === undefined ? THEME : options.theme;
  fs.writeFileSync(deckPath, text);
  const deck = fakeDocument(deckPath, text);
  docs.set(deckPath, deck);
  if (theme !== null) {
    fs.writeFileSync(themePath, theme);
    docs.set(themePath, fakeDocument(themePath, theme));
  }
  const extension = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-deck-ext-"));
  fs.mkdirSync(path.join(extension, "dist", "deckEditor"), { recursive: true });
  fs.mkdirSync(path.join(extension, "dist", "chunks"), { recursive: true });
  fs.writeFileSync(path.join(extension, "dist", "deckEditor", "deckEditor.js"), "");
  fs.writeFileSync(path.join(extension, "dist", "deckEditor", "deckEditor.css"), "");

  const provider = createDeckEditorProvider({ extensionUri: vscode.Uri.file(extension), logger: fakeLogger(), projects: fakeProjects([]) });
  const host = fakePanel();
  closers.push(host.close);
  await provider.resolveCustomTextEditor(deck as unknown as vscode.TextDocument, host.panel as unknown as vscode.WebviewPanel, { isCancellationRequested: false } as vscode.CancellationToken);
  await flush();
  return { ...host, deck, folder, extension, deckPath, themePath };
}

beforeEach(() => {
  jest.clearAllMocks();
  docs.clear();
  workspace.applyEdit.mockImplementation(async (edit: unknown) => applyToWorld(edit));
  workspace.openTextDocument.mockImplementation(async (target: vscode.Uri | string) => {
    const file = typeof target === "string" ? target : target.fsPath;
    const document = docs.get(file);
    if (!document) throw new Error(`cannot open ${file}: file not found`);
    return document;
  });
  workspace.fs.stat.mockImplementation(async (uri: vscode.Uri) => {
    if (!docs.has(uri.fsPath) && !fs.existsSync(uri.fsPath)) throw Object.assign(new Error(`${uri.fsPath} not found`), { code: "FileNotFound" });
    return { type: 1, ctime: 0, mtime: 0, size: 0 };
  });
  workspace.fs.readFile.mockImplementation(async (uri: vscode.Uri) => {
    const document = docs.get(uri.fsPath);
    if (document) return new TextEncoder().encode(document.text);
    return new Uint8Array(fs.readFileSync(uri.fsPath));
  });
});

afterEach(() => {
  closers.forEach((close) => close());
  closers = [];
});

const PACKAGE_JSON = path.resolve(__dirname, "../../../package.json");
type CustomEditor = { viewType: string; displayName: string; selector: Array<{ filenamePattern: string }>; priority: string };
const customEditors = (): CustomEditor[] => JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")).contributes.customEditors;

describe("the deck editor contribution", () => {
  it("8.1b package.json registers labshelf.deckEditor as an option for talks and posters decks", () => {
    expect(customEditors().find((editor) => editor.viewType === "labshelf.deckEditor")).toEqual({
      viewType: "labshelf.deckEditor",
      displayName: "LabShelf Deck Editor",
      selector: [{ filenamePattern: "**/talks/*/deck.html" }, { filenamePattern: "**/posters/*/deck.html" }],
      priority: "option",
    });
  });

  it("8.1b the deck editor comes right after the notes editor", () => {
    const types = customEditors().map((editor) => editor.viewType);
    expect(types.indexOf("labshelf.deckEditor")).toBe(types.indexOf("labshelf.notesEditor") + 1);
  });

  it("8.1b labshelf.sourceEditor is unchanged", () => {
    expect(customEditors().find((editor) => editor.viewType === "labshelf.sourceEditor")).toEqual({
      viewType: "labshelf.sourceEditor",
      displayName: "LabShelf Editor",
      selector: [{ filenamePattern: "*.tex" }, { filenamePattern: "*.typ" }],
      priority: "default",
    });
  });

  it("8.1b registerDeckEditor registers the provider once per document, retained when hidden, and keeps the disposable", () => {
    const context = { subscriptions: [] as Array<{ dispose(): unknown }>, extensionUri: vscode.Uri.file("/ext") };
    registerDeckEditor(context as unknown as vscode.ExtensionContext, { extensionUri: vscode.Uri.file("/ext"), logger: fakeLogger(), projects: fakeProjects([]) });

    const register = vscode.window.registerCustomEditorProvider as unknown as jest.Mock;
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(
      "labshelf.deckEditor",
      expect.objectContaining({ resolveCustomTextEditor: expect.any(Function) }),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
    );
    expect(context.subscriptions).toContain(register.mock.results[0]!.value);
  });
});

describe("createDeckEditorProvider", () => {
  it("8.1a the page is the deck shell with its own policy", async () => {
    const { panel } = await open();
    expect(panel.webview.html).toContain("style-src vscode-resource: 'unsafe-inline';");
    expect(panel.webview.html).toContain("frame-src 'self' about: blob:;");
    expect(panel.webview.html).toContain("deckEditor.js");
  });

  it("8.1c posts nothing before the page is ready, even when the document changes", async () => {
    const { postMessage, deck } = await open();
    externalChange(deck, TALK.replace("Hello", "Hi"));
    await flush();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("8.1c posts init with deck, theme, version, the deck folder's asset base and the kind once ready", async () => {
    const { fromPage, posted, folder } = await open();
    fromPage({ type: "ready" });
    await flush();

    expect(posted()[0]).toEqual({ type: "init", deck: TALK, theme: THEME, version: 1, assetBase: `vscode-resource:${folder}/`, kind: "talk" });
  });

  it("8.1c init carries an empty theme when theme.css is missing", async () => {
    const { fromPage, posted } = await open({ theme: null });
    fromPage({ type: "ready" });
    await flush();

    expect(posted()[0]).toMatchObject({ type: "init", theme: "" });
  });

  it("8.1c init carries the poster kind", async () => {
    const { fromPage, posted } = await open({ folder: "posters/p1", deck: TALK.replace('data-deck="talk"', 'data-deck="poster"') });
    fromPage({ type: "ready" });
    await flush();

    expect(posted()[0]).toMatchObject({ type: "init", kind: "poster" });
  });

  it("8.1c init carries a null kind when the text is not a deck", async () => {
    const { fromPage, posted } = await open({ deck: "just text, no html element\n" });
    fromPage({ type: "ready" });
    await flush();

    expect(posted()[0]).toMatchObject({ type: "init", deck: "just text, no html element\n", kind: null });
  });

  it("8.1c the webview runs scripts and may load the bundle, the chunks and the deck folder", async () => {
    const { panel, folder, extension } = await open();
    const roots = (panel.webview.options.localResourceRoots ?? []).map((uri) => trim(uri.fsPath));

    expect(panel.webview.options.enableScripts).toBe(true);
    expect(roots).toEqual(expect.arrayContaining([trim(folder), path.join(extension, "dist", "deckEditor"), path.join(extension, "dist", "chunks")]));
  });

  it("A4 a page gesture writes one WorkspaceEdit and a text editor change comes back as update", async () => {
    const { fromPage, posted, deck, postMessage, deckPath } = await open();
    fromPage({ type: "ready" });
    await flush();
    postMessage.mockClear();

    const moved = TALK.replace("left: 10px", "left: 140px");
    fromPage({ type: "edit", deck: moved, baseVersion: 1 });
    await flush();

    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(opsOf(workspace.applyEdit.mock.calls[0]![0]).every((op) => op.uri.fsPath === deckPath)).toBe(true);
    expect(deck.text).toBe(moved);
    expect(posted().filter((message) => message.type === "update")).toEqual([]);

    const typed = moved.replace("Hello", "Hello world");
    externalChange(deck, typed);
    await flush();

    expect(posted().filter((message) => message.type === "update")).toEqual([{ type: "update", deck: typed, theme: THEME, version: deck.version }]);
  });
});
