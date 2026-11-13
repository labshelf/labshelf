// Tests the deck editor's document sync: minimalReplace, one WorkspaceEdit per page gesture over deck.html and theme.css, stale versions, swallowed echoes and posted updates.
import * as vscode from "vscode";

import { createDeckSync, type DeckSync } from "../../../src/writing/deckEditor/deckSync";
import { minimalReplace } from "../../../src/localSync/documentText";
import type { DeckHostMessage } from "../../../src/writing/deckEditor/deckMessages";

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

const DECK_PATH = "/lib/talks/t/deck.html";
const THEME_PATH = "/lib/talks/t/theme.css";
const docs = new Map<string, FakeDocument>();
const workspace = vscode.workspace as unknown as {
  applyEdit: jest.Mock; openTextDocument: jest.Mock; _fireTextDocumentChange(event: unknown): void;
  fs: { stat: jest.Mock; readFile: jest.Mock };
};

const fire = (document: FakeDocument, reason?: number) =>
  workspace._fireTextDocumentChange({ document, contentChanges: [{ text: document.text }], reason });

/** Changes a document as the text editor, undo or git would. */
function externalChange(document: FakeDocument, text: string, reason?: number): void {
  document.text = text;
  document.version += 1;
  document.isDirty = true;
  fire(document, reason);
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
  changed.forEach((document) => fire(document));
  return true;
}

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

const DECK = `<!doctype html>
<html data-deck="talk">
<head><link rel="stylesheet" href="theme.css" data-deck-theme></head>
<body>
<section data-slide><div data-block id="b1" style="left: 10px; top: 20px; width: 300px; height: 100px"><p>Hello</p></div></section>
</body>
</html>
`;
const MOVED = DECK.replace("left: 10px", "left: 140px");
const THEME = ":root {\n  --deck-accent: #336699;\n}\n";
const RETHEMED = THEME.replace("#336699", "#aa2200");

let posted: DeckHostMessage[];
let sync: DeckSync | undefined;
let deck: FakeDocument;
const themeUri = () => vscode.Uri.file(THEME_PATH);
const updates = () => posted.filter((message) => message.type === "update");

async function start(options: { theme?: string | null } = {}): Promise<DeckSync> {
  deck = fakeDocument(DECK_PATH, DECK);
  docs.set(DECK_PATH, deck);
  const theme = options.theme === undefined ? THEME : options.theme;
  if (theme !== null) docs.set(THEME_PATH, fakeDocument(THEME_PATH, theme));
  sync = createDeckSync(deck as unknown as vscode.TextDocument, themeUri(), (message) => { posted.push(message); });
  await flush();
  return sync;
}

beforeEach(() => {
  jest.clearAllMocks();
  docs.clear();
  posted = [];
  workspace.applyEdit.mockImplementation(async (edit: unknown) => applyToWorld(edit));
  workspace.openTextDocument.mockImplementation(async (target: vscode.Uri | string) => {
    const file = typeof target === "string" ? target : target.fsPath;
    const document = docs.get(file);
    if (!document) throw new Error(`cannot open ${file}: file not found`);
    return document;
  });
  workspace.fs.stat.mockImplementation(async (uri: vscode.Uri) => {
    if (!docs.has(uri.fsPath)) throw Object.assign(new Error(`${uri.fsPath} not found`), { code: "FileNotFound" });
    return { type: 1, ctime: 0, mtime: 0, size: docs.get(uri.fsPath)!.text.length };
  });
  workspace.fs.readFile.mockImplementation(async (uri: vscode.Uri) => {
    const document = docs.get(uri.fsPath);
    if (!document) throw Object.assign(new Error(`${uri.fsPath} not found`), { code: "FileNotFound" });
    return new TextEncoder().encode(document.text);
  });
});

afterEach(() => {
  sync?.dispose();
  sync = undefined;
});

const applyText = (before: string, replace: { from: number; to: number; insert: string } | null): string =>
  replace ? before.slice(0, replace.from) + replace.insert + before.slice(replace.to) : before;

describe("minimalReplace", () => {
  it("8.1f gives null for equal texts", () => {
    expect(minimalReplace("abc", "abc")).toBeNull();
    expect(minimalReplace("", "")).toBeNull();
  });

  it("8.1f replaces only the changed middle", () => {
    expect(minimalReplace("left: 10px; top: 5px", "left: 140px; top: 5px")).toEqual({ from: 7, to: 7, insert: "4" });
    expect(minimalReplace("top: 20px", "top: 35px")).toEqual({ from: 5, to: 7, insert: "35" });
  });

  it("8.1f gives an empty range for a pure insertion", () => {
    expect(minimalReplace("abc", "abXc")).toEqual({ from: 2, to: 2, insert: "X" });
  });

  it("8.1f gives an empty insert for a pure deletion", () => {
    expect(minimalReplace("abXc", "abc")).toEqual({ from: 2, to: 3, insert: "" });
  });

  it("8.1f takes the prefix first and keeps the suffix from overlapping it", () => {
    expect(minimalReplace("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
    expect(minimalReplace("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
    expect(minimalReplace("abab", "ab")).toEqual({ from: 2, to: 4, insert: "" });
  });

  it("8.1f handles a change from or to empty text", () => {
    expect(minimalReplace("", "abc")).toEqual({ from: 0, to: 0, insert: "abc" });
    expect(minimalReplace("abc", "")).toEqual({ from: 0, to: 3, insert: "" });
  });

  it("8.1f counts offsets in UTF-16 code units", () => {
    expect(minimalReplace("😀ab", "😀Xb")).toEqual({ from: 2, to: 3, insert: "X" });
    expect(minimalReplace("日本語", "日X語")).toEqual({ from: 1, to: 2, insert: "X" });
  });

  it.each([
    ["abcdef", "abXYef"],
    ["the quick fox", "a quick brown fox"],
    ["xyz", "abc"],
    [DECK, MOVED],
    [THEME, RETHEMED],
  ])("8.1f its replace turns %j into the after text", (before, after) => {
    expect(applyText(before, minimalReplace(before, after))).toBe(after);
  });
});

describe("createDeckSync.applyFromPage", () => {
  it("8.1d a deck gesture is exactly one WorkspaceEdit with the minimal replace on deck.html", async () => {
    await start();
    await expect(sync!.applyFromPage({ deck: MOVED, baseVersion: 1 })).resolves.toBe(true);

    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    const ops = opsOf(workspace.applyEdit.mock.calls[0]![0]);
    expect(ops).toHaveLength(1);
    const [op] = ops;
    expect(op!.uri.fsPath).toBe(DECK_PATH);
    const expected = minimalReplace(DECK, MOVED)!;
    expect({ from: offsetIn(DECK, op!.range!.start), to: offsetIn(DECK, op!.range!.end), insert: op!.text }).toEqual(expected);
    expect(deck.text).toBe(MOVED);
  });

  it("8.1d a deck and theme gesture is one WorkspaceEdit holding the minimal replace of each file", async () => {
    await start();
    await expect(sync!.applyFromPage({ deck: MOVED, theme: RETHEMED, baseVersion: 1 })).resolves.toBe(true);

    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    const ops = opsOf(workspace.applyEdit.mock.calls[0]![0]).filter((op) => op.kind !== "createFile");
    const deckOps = ops.filter((op) => op.uri.fsPath === DECK_PATH);
    const themeOps = ops.filter((op) => op.uri.fsPath === THEME_PATH);
    expect(deckOps).toHaveLength(1);
    expect(themeOps).toHaveLength(1);
    expect({ from: offsetIn(THEME, themeOps[0]!.range!.start), to: offsetIn(THEME, themeOps[0]!.range!.end), insert: themeOps[0]!.text })
      .toEqual(minimalReplace(THEME, RETHEMED));
    expect(deck.text).toBe(MOVED);
    expect(docs.get(THEME_PATH)!.text).toBe(RETHEMED);
  });

  it("8.1d a theme-only gesture edits theme.css alone", async () => {
    await start();
    await expect(sync!.applyFromPage({ deck: DECK, theme: RETHEMED, baseVersion: 1 })).resolves.toBe(true);

    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    const ops = opsOf(workspace.applyEdit.mock.calls[0]![0]);
    expect(ops.every((op) => op.uri.fsPath === THEME_PATH)).toBe(true);
    expect(docs.get(THEME_PATH)!.text).toBe(RETHEMED);
    expect(deck.text).toBe(DECK);
  });

  it("8.1d an unchanged theme adds no theme.css edit", async () => {
    await start();
    await sync!.applyFromPage({ deck: MOVED, theme: THEME, baseVersion: 1 });

    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(opsOf(workspace.applyEdit.mock.calls[0]![0]).some((op) => op.uri.fsPath === THEME_PATH)).toBe(false);
  });

  it("8.1d a missing theme.css is created and filled in the same WorkspaceEdit", async () => {
    await start({ theme: null });
    await expect(sync!.applyFromPage({ deck: MOVED, theme: RETHEMED, baseVersion: 1 })).resolves.toBe(true);

    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    const ops = opsOf(workspace.applyEdit.mock.calls[0]![0]);
    expect(ops.some((op) => op.kind === "createFile" && op.uri.fsPath === THEME_PATH)).toBe(true);
    expect(ops.some((op) => op.kind !== "createFile" && op.uri.fsPath === DECK_PATH)).toBe(true);
    expect(docs.get(THEME_PATH)!.text).toBe(RETHEMED);
  });

  it("8.1d resolves the result of applyEdit", async () => {
    await start();
    workspace.applyEdit.mockImplementationOnce(async () => false);
    await expect(sync!.applyFromPage({ deck: MOVED, baseVersion: 1 })).resolves.toBe(false);
  });

  it("8.1d a stale baseVersion posts update with the current texts and edits nothing", async () => {
    await start();
    externalChange(deck, DECK.replace("Hello", "Hi"));
    await flush();
    posted = [];

    await expect(sync!.applyFromPage({ deck: MOVED, theme: RETHEMED, baseVersion: 1 })).resolves.toBe(false);
    await flush();

    expect(workspace.applyEdit).not.toHaveBeenCalled();
    expect(updates()).toEqual([{ type: "update", deck: DECK.replace("Hello", "Hi"), theme: THEME, version: 2 }]);
    expect(deck.text).toBe(DECK.replace("Hello", "Hi"));
  });

  it("8.1d a gesture on the current version after an outside change applies", async () => {
    await start();
    externalChange(deck, DECK.replace("Hello", "Hi"));
    await flush();

    await expect(sync!.applyFromPage({ deck: MOVED.replace("Hello", "Hi"), baseVersion: 2 })).resolves.toBe(true);
    expect(deck.text).toBe(MOVED.replace("Hello", "Hi"));
  });
});

describe("createDeckSync echoes and outside changes", () => {
  it("8.1e the sync's own deck edit is not echoed back", async () => {
    await start();
    await sync!.applyFromPage({ deck: MOVED, baseVersion: 1 });
    await flush();

    expect(updates()).toEqual([]);
  });

  it("8.1e the sync's own theme edit is not echoed back", async () => {
    await start();
    await sync!.applyFromPage({ deck: MOVED, theme: RETHEMED, baseVersion: 1 });
    await flush();

    expect(updates()).toEqual([]);
  });

  it("8.1e a change typed in the text editor posts update with deck, theme and version", async () => {
    await start();
    externalChange(deck, DECK.replace("Hello", "Hello world"));
    await flush();

    expect(updates()).toEqual([{ type: "update", deck: DECK.replace("Hello", "Hello world"), theme: THEME, version: 2 }]);
  });

  it("8.1e an undo of the sync's own edit posts update", async () => {
    await start();
    await sync!.applyFromPage({ deck: MOVED, baseVersion: 1 });
    await flush();

    externalChange(deck, DECK, 1);
    await flush();

    expect(updates()).toEqual([{ type: "update", deck: DECK, theme: THEME, version: deck.version }]);
  });

  it("8.1e an outside change of theme.css posts update", async () => {
    await start();
    externalChange(docs.get(THEME_PATH)!, RETHEMED);
    await flush();

    expect(updates()).toEqual([{ type: "update", deck: DECK, theme: RETHEMED, version: deck.version }]);
  });

  it("8.1e a change of another document posts nothing", async () => {
    await start();
    const other = fakeDocument("/lib/talks/other/deck.html", DECK);
    docs.set(other.fileName, other);
    externalChange(other, MOVED);
    await flush();

    expect(updates()).toEqual([]);
  });

  it("8.1e posts nothing after dispose", async () => {
    const disposed = await start();
    sync = undefined;
    disposed.dispose();
    externalChange(deck, MOVED);
    await flush();

    expect(updates()).toEqual([]);
  });
});
