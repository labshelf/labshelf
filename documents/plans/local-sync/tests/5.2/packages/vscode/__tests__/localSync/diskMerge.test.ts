import * as vscode from "vscode";
import { mergeText } from "@labshelf/core/node";
import type { ILogger } from "@labshelf/core";

import { createDiskMerge, type DiskMerge } from "../../src/localSync/diskMerge";

// The `vscode` mock exposes its created watchers and document-event firing helpers.
interface MockWatcher { pattern: { base: { fsPath: string }; pattern: string }; dispose: jest.Mock; _fire(kind: "create" | "change" | "delete", uri: vscode.Uri): void }
const mockVscode = vscode as unknown as { _fileWatchers: MockWatcher[] };
const mockWorkspace = vscode.workspace as unknown as { _fireDocumentEvent(kind: "save" | "open" | "close", document: unknown): void };

const readFile = vscode.workspace.fs.readFile as unknown as jest.Mock;
const writeFile = vscode.workspace.fs.writeFile as unknown as jest.Mock;
const applyEdit = vscode.workspace.applyEdit as unknown as jest.Mock;
const executeCommand = vscode.commands.executeCommand as unknown as jest.Mock;
const showWarningMessage = vscode.window.showWarningMessage as unknown as jest.Mock;
const createFileSystemWatcher = vscode.workspace.createFileSystemWatcher as unknown as jest.Mock;
const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument as unknown as jest.Mock;

const REVERT = "workbench.action.files.revert";

interface FakeDocument {
  uri: vscode.Uri;
  text: string;
  isDirty: boolean;
  isClosed: boolean;
  version: number;
  getText: jest.Mock;
  positionAt(offset: number): vscode.Position;
  save: jest.Mock;
}

/** A TextDocument stand-in over a mutable text; `log` records the order of revert, edit and save. */
function fakeDocument(fsPath: string, text: string, dirty: boolean): FakeDocument {
  const document: FakeDocument = {
    uri: vscode.Uri.file(fsPath),
    text,
    isDirty: dirty,
    isClosed: false,
    version: 1,
    getText: jest.fn(() => document.text),
    positionAt: (offset: number) => {
      const before = document.text.slice(0, offset).split("\n");
      return new vscode.Position(before.length - 1, before[before.length - 1]!.length);
    },
    save: jest.fn(async () => { log.push("save"); document.isDirty = false; return true; }),
  };
  return document;
}

function offsetAt(text: string, position: vscode.Position): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) { offset += lines[line]!.length + 1; }
  return offset + position.character;
}

let log: string[];
let disk: Map<string, string>;
let documents: FakeDocument[];
let merges: DiskMerge[];

const decoder = new TextDecoder();
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); } };
const track = async (merge: DiskMerge, document: FakeDocument): Promise<vscode.Disposable> => {
  const handle = merge.track(document as unknown as vscode.TextDocument);
  await settle();
  return handle;
};
const diskChanged = async (document: FakeDocument, text: string, kind: "change" | "create" = "change"): Promise<void> => {
  disk.set(document.uri.fsPath, text);
  const watcher = mockVscode._fileWatchers.find((w) => !w.dispose.mock.calls.length)!;
  watcher._fire(kind, document.uri);
  await settle();
};
const newMerge = (logger?: ILogger): DiskMerge => {
  const merge = createDiskMerge({ textMerge: mergeText, ...(logger ? { logger } : {}) });
  merges.push(merge);
  return merge;
};
const editCalls = (): unknown[][] => applyEdit.mock.calls;
const revertCalls = (): unknown[][] => executeCommand.mock.calls.filter(([command]) => command === REVERT);

const TEX = "/proj/chapters/intro.tex";
const BASE = "para one\n\npara two\n\npara three\n";
const LOCAL = "para ONE by local\n\npara two\n\npara three\n";
const OTHER = "para one\n\npara two\n\npara THREE by other\n";
const MERGED = "para ONE by local\n\npara two\n\npara THREE by other\n";

const A = "n-01JB2QN0000000000000000000";
const B = "n-01JB2QP0000000000000000000";
const C = "n-01JB2QQ0000000000000000000";
const item = (id: string, body: string) => `::: {#${id} .labshelf-item}\n${body}:::\n`;

beforeEach(() => {
  log = [];
  disk = new Map();
  documents = [];
  merges = [];
  mockVscode._fileWatchers.length = 0;
  readFile.mockImplementation(async (uri: vscode.Uri) => {
    const text = disk.get(uri.fsPath);
    if (text === undefined) { throw new Error(`no such file ${uri.fsPath}`); }
    return new TextEncoder().encode(text);
  });
  writeFile.mockImplementation(async () => {});
  applyEdit.mockImplementation(async (edit: { replacements: { uri: vscode.Uri; range: vscode.Range; text: string }[] }) => {
    for (const { uri, range, text } of edit.replacements) {
      const document = documents.find((d) => d.uri.toString() === uri.toString())!;
      const from = offsetAt(document.text, range.start);
      const to = offsetAt(document.text, range.end);
      document.text = document.text.slice(0, from) + text + document.text.slice(to);
      document.isDirty = true;
    }
    log.push("edit");
    return true;
  });
  executeCommand.mockImplementation(async (command: string, uri: vscode.Uri) => {
    if (command !== REVERT) { return undefined; }
    log.push("revert");
    const document = documents.find((d) => d.uri.toString() === uri.toString())!;
    document.text = disk.get(uri.fsPath)!;
    document.isDirty = false;
    return undefined;
  });
  showWarningMessage.mockImplementation(async () => undefined);
});

afterEach(() => {
  for (const merge of merges) { merge.dispose(); }
});

/** A tracked dirty document (disk and base are BASE, the document holds LOCAL). */
async function trackedDirty(fsPath = TEX, base = BASE, local = LOCAL): Promise<{ merge: DiskMerge; document: FakeDocument }> {
  const document = fakeDocument(fsPath, local, true);
  documents.push(document);
  disk.set(fsPath, base);
  const merge = newMerge();
  await track(merge, document);
  return { merge, document };
}

describe("5.2 A LabShelf-edited document that is dirty when its file changes on disk takes the disk change in by a three-way merge (base = text at last save), with no VS Code 'file is newer' dialog; a conflict keeps the document side and writes the disk side to a conflict copy with a notification. The source, notes and deck editors track their documents (D6c, D4).", () => {
  it("5.2a a tracked dirty document whose file changes on disk in another paragraph ends with both edits: revert is executed for its uri, then one edit applies the merged text and the document is saved; no conflict copy is written", async () => {
    const { document } = await trackedDirty();
    await diskChanged(document, OTHER);

    expect(revertCalls()).toHaveLength(1);
    expect((revertCalls()[0] as unknown[])[1]).toBe(document.uri);
    expect(editCalls()).toHaveLength(1);
    expect(document.save).toHaveBeenCalledTimes(1);
    expect(log).toEqual(["revert", "edit", "save"]);
    expect(document.text).toBe(MERGED);
    expect(document.isDirty).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(showWarningMessage).not.toHaveBeenCalled();
  });

  it("5.2a the merge edit replaces only the changed range of the reverted document text", async () => {
    const { document } = await trackedDirty();
    await diskChanged(document, OTHER);

    const edit = editCalls()[0]![0] as { replacements: { text: string }[] };
    expect(edit.replacements).toHaveLength(1);
    expect(edit.replacements[0]!.text).not.toBe(MERGED);
    expect(edit.replacements[0]!.text.length).toBeLessThan(MERGED.length);
  });

  it("5.2a a create event for the file is handled like a change", async () => {
    const { document } = await trackedDirty();
    await diskChanged(document, OTHER, "create");

    expect(log).toEqual(["revert", "edit", "save"]);
    expect(document.text).toBe(MERGED);
  });

  it("5.2a the watcher is created for the file's folder and name, with one save listener", async () => {
    await trackedDirty();

    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1);
    const pattern = (createFileSystemWatcher.mock.calls[0] as [vscode.RelativePattern])[0];
    expect(pattern).toBeInstanceOf(vscode.RelativePattern);
    expect((pattern as unknown as { base: vscode.Uri }).base.fsPath).toBe("/proj/chapters");
    expect(pattern.pattern).toBe("intro.tex");
    expect(onDidSaveTextDocument).toHaveBeenCalledTimes(1);
  });

  it("5.2a delete events are ignored", async () => {
    const { document } = await trackedDirty();
    disk.set(document.uri.fsPath, OTHER);
    mockVscode._fileWatchers[0]!._fire("delete", document.uri);
    await settle();

    expect(log).toEqual([]);
    expect(editCalls()).toHaveLength(0);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("5.2a a failing disk read is logged and never thrown out of the watcher callback", async () => {
    const entries: unknown[][] = [];
    const logger: ILogger = {
      log: jest.fn(async (...args: unknown[]) => { entries.push(args); }),
      error: jest.fn(async (...args: unknown[]) => { entries.push(args); }),
    } as unknown as ILogger;
    const document = fakeDocument(TEX, LOCAL, true);
    documents.push(document);
    disk.set(TEX, BASE);
    await track(newMerge(logger), document);

    disk.delete(TEX);
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    try {
      expect(() => mockVscode._fileWatchers[0]!._fire("change", document.uri)).not.toThrow();
      await settle();
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(entries.length).toBeGreaterThan(0);
    expect(log).toEqual([]);
  });

  it("5.2b a tracked clean document whose file changes takes no action besides updating base (no revert, no edit, no save)", async () => {
    const document = fakeDocument(TEX, BASE, false);
    documents.push(document);
    disk.set(TEX, BASE);
    await track(newMerge(), document);

    await diskChanged(document, OTHER);

    expect(revertCalls()).toHaveLength(0);
    expect(editCalls()).toHaveLength(0);
    expect(document.save).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(showWarningMessage).not.toHaveBeenCalled();
  });

  it("5.2b after a clean document's file changed, base is the new disk text for the next merge", async () => {
    const base = "p1\n\np2\n\np3\n";
    const first = "p1\n\np2 disk\n\np3\n";
    const document = fakeDocument(TEX, base, false);
    documents.push(document);
    disk.set(TEX, base);
    await track(newMerge(), document);

    await diskChanged(document, first);
    // VS Code reloads the clean document itself; then the user edits the first paragraph.
    document.text = "p1 local\n\np2 disk\n\np3\n";
    document.isDirty = true;
    // The next disk change puts the second paragraph back and edits the third: against base = first it keeps both sides.
    await diskChanged(document, "p1\n\np2\n\np3 disk\n");

    expect(document.text).toBe("p1 local\n\np2\n\np3 disk\n");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("5.2b a change whose disk text equals base (own save) does nothing", async () => {
    const { document } = await trackedDirty();
    await diskChanged(document, BASE);

    expect(revertCalls()).toHaveLength(0);
    expect(editCalls()).toHaveLength(0);
    expect(document.save).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(document.text).toBe(LOCAL);
  });

  it("5.2b a document that is dirty at track time takes the disk text read then as base, not its own text", async () => {
    // Base is BASE (disk at track time): the local edit of paragraph one and the disk edit of paragraph three both survive.
    const { document } = await trackedDirty();
    await diskChanged(document, OTHER);

    expect(document.text).toBe(MERGED);
  });

  it("5.2c an overlapping change keeps the document's text, writes the disk text to the .labshelf-conflict copy path from mergeLocalFile, and shows one warning naming the copy", async () => {
    const { document } = await trackedDirty(TEX, BASE, LOCAL);
    const overlapping = "para one by disk\n\npara two\n\npara three\n";
    await diskChanged(document, overlapping);

    expect(document.text).toBe(LOCAL);
    expect(document.isDirty).toBe(false);

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [copyUri, bytes] = writeFile.mock.calls[0] as [vscode.Uri, Uint8Array];
    expect(copyUri.fsPath).toMatch(/^\/proj\/chapters\/intro\.tex\.labshelf-conflict-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(decoder.decode(bytes)).toBe(overlapping);

    expect(showWarningMessage).toHaveBeenCalledTimes(1);
    const message = String(showWarningMessage.mock.calls[0]![0]);
    expect(message).toContain(copyUri.fsPath.split("/").pop()!);
    expect(message).toContain("intro.tex");
  });

  it("5.2c a conflict still reverts first so the document is not left in a 'file is newer' state, then restores the document side and saves", async () => {
    const { document } = await trackedDirty();
    await diskChanged(document, "para one by disk\n\npara two\n\npara three\n");

    expect(log).toEqual(["revert", "edit", "save"]);
    expect((revertCalls()[0] as unknown[])[1]).toBe(document.uri);
  });

  it("5.2c a conflict in a notes.qmd item keeps the document's item and writes the disk side to a conflict copy", async () => {
    const base = item(A, "one\ntwo\nthree\n");
    const local = item(A, "one\nmine\nthree\n");
    const theirs = item(A, "one\ntheirs\nthree\n");
    const { document } = await trackedDirty("/lib/paper/notes.qmd", base, local);
    await diskChanged(document, theirs);

    expect(document.text).toBe(local);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [copyUri, bytes] = writeFile.mock.calls[0] as [vscode.Uri, Uint8Array];
    expect(copyUri.fsPath).toContain("/lib/paper/notes.qmd.labshelf-conflict-");
    expect(decoder.decode(bytes)).toBe(theirs);
    expect(showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it("5.2d track is refcounted: two tracks of the same uri make one watcher; the watcher is disposed only after both handles are disposed", async () => {
    const document = fakeDocument(TEX, BASE, false);
    documents.push(document);
    disk.set(TEX, BASE);
    const merge = newMerge();
    const first = await track(merge, document);
    const second = await track(merge, document);

    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1);
    expect(onDidSaveTextDocument).toHaveBeenCalledTimes(1);
    const watcher = mockVscode._fileWatchers[0]!;

    first.dispose();
    expect(watcher.dispose).not.toHaveBeenCalled();
    second.dispose();
    expect(watcher.dispose).toHaveBeenCalledTimes(1);
  });

  it("5.2d while one handle is left the document is still tracked", async () => {
    const { merge, document } = await trackedDirty();
    const extra = await track(merge, document);
    extra.dispose();

    await diskChanged(document, OTHER);

    expect(document.text).toBe(MERGED);
  });

  it("5.2d tracks of different uris make one watcher each", async () => {
    const merge = newMerge();
    const one = fakeDocument("/proj/a.tex", "a\n", false);
    const two = fakeDocument("/proj/b.tex", "b\n", false);
    documents.push(one, two);
    disk.set("/proj/a.tex", "a\n");
    disk.set("/proj/b.tex", "b\n");
    await track(merge, one);
    await track(merge, two);

    expect(createFileSystemWatcher).toHaveBeenCalledTimes(2);
  });

  it("5.2d disposing the DiskMerge disposes every watcher", async () => {
    const { merge } = await trackedDirty();
    merge.dispose();

    expect(mockVscode._fileWatchers[0]!.dispose).toHaveBeenCalled();
  });

  it("5.2d after a save base becomes the saved text, so the disk echo of that save does nothing", async () => {
    const { document } = await trackedDirty();
    // The user saves LOCAL2 (base becomes LOCAL2), then types more.
    const saved = "para ONE saved\n\npara two\n\npara three\n";
    document.text = saved;
    document.isDirty = false;
    mockWorkspace._fireDocumentEvent("save", document);
    document.text = "para ONE saved\n\npara two\n\npara three typed\n";
    document.isDirty = true;

    await diskChanged(document, saved);

    expect(revertCalls()).toHaveLength(0);
    expect(editCalls()).toHaveLength(0);
    expect(document.save).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("5.2d after a save base becomes the saved text, so a later disk change merges against it", async () => {
    const { document } = await trackedDirty();
    const saved = "para ONE saved\n\npara two\n\npara three\n";
    document.text = saved;
    document.isDirty = false;
    mockWorkspace._fireDocumentEvent("save", document);
    document.text = "para ONE saved\n\npara two typed\n\npara three\n";
    document.isDirty = true;

    // With base = saved the other side changed only paragraph three. A stale base (BASE) would see paragraph one changed on both sides.
    await diskChanged(document, "para ONE saved\n\npara two\n\npara three by disk\n");

    expect(document.text).toBe("para ONE saved\n\npara two typed\n\npara three by disk\n");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("5.2d a save of an untracked document does not disturb a tracked one", async () => {
    const { document } = await trackedDirty();
    const stranger = fakeDocument("/proj/other.tex", "zzz\n", false);
    mockWorkspace._fireDocumentEvent("save", stranger);

    await diskChanged(document, OTHER);

    expect(document.text).toBe(MERGED);
  });

  it("A4 a tracked .tex with an unsaved edit in another paragraph takes a disk save from the browser in: the document is reverted and merged, not left newer on disk", async () => {
    const { document } = await trackedDirty("/proj/main.tex");
    await diskChanged(document, OTHER);

    expect(log).toEqual(["revert", "edit", "save"]);
    expect(document.text).toBe(MERGED);
    expect(document.isDirty).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("A5 a tracked notes.qmd edited in two windows merges the other window's saved edit item by item", async () => {
    const base = `${item(A, "First.\n")}\n${item(B, "Second.\n")}`;
    const local = `${item(A, "First, edited locally.\n")}\n${item(B, "Second.\n")}`;
    const other = `${base}\n${item(C, "Appended in the other window.\n")}`;
    const { document } = await trackedDirty("/lib/paper/notes.qmd", base, local);
    await diskChanged(document, other);

    expect(log).toEqual(["revert", "edit", "save"]);
    expect(document.text).toContain("First, edited locally.");
    expect(document.text).toContain("Appended in the other window.");
    expect(document.text).toContain(`#${C}`);
    expect(document.text).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
