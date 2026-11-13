import * as path from "node:path";
import * as vscode from "vscode";
import { openDocumentOf, replaceDocumentText, writeThroughDocument, minimalReplace } from "../../src/localSync/documentText";
import { VscodeFileSystem } from "../../src/library/fileSystem";

const wfs = vscode.workspace.fs as unknown as Record<string, jest.Mock>;
const applyEdit = vscode.workspace.applyEdit as unknown as jest.Mock;
const openDocuments = vscode.workspace.textDocuments as unknown as FakeDocument[];

interface FakeDocument {
  uri: vscode.Uri;
  text: string;
  isDirty: boolean;
  isClosed: boolean;
  getText: jest.Mock;
  positionAt: (offset: number) => vscode.Position;
  offsetAt: (position: vscode.Position) => number;
  save: jest.Mock;
}

/** A TextDocument that keeps its text: applyEdit (below) edits it and marks it dirty, save marks it clean. */
function fakeDocument(fsPath: string, text: string, state: { dirty?: boolean; closed?: boolean } = {}): FakeDocument {
  const doc: FakeDocument = {
    uri: vscode.Uri.file(fsPath),
    text,
    isDirty: state.dirty ?? false,
    isClosed: state.closed ?? false,
    getText: jest.fn(() => doc.text),
    positionAt: (offset) => {
      const lines = doc.text.slice(0, offset).split("\n");
      return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
    },
    offsetAt: (position) => {
      const lines = doc.text.split("\n");
      let offset = 0;
      for (let i = 0; i < position.line; i++) { offset += lines[i]!.length + 1; }
      return offset + position.character;
    },
    save: jest.fn(async () => { doc.isDirty = false; return true; }),
  };
  return doc;
}

function openDocument(fsPath: string, text: string, state: { dirty?: boolean; closed?: boolean } = {}): FakeDocument {
  const doc = fakeDocument(fsPath, text, state);
  openDocuments.push(doc);
  return doc;
}

interface Replacement { uri: vscode.Uri; range: vscode.Range; text: string }
const replacementsOf = (edit: unknown): Replacement[] => (edit as { replacements: Replacement[] }).replacements;

beforeEach(() => {
  jest.clearAllMocks();
  openDocuments.length = 0;
  applyEdit.mockReset().mockImplementation(async (edit: unknown) => {
    for (const { uri, range, text } of replacementsOf(edit)) {
      const doc = openDocuments.find((d) => d.uri.toString() === uri.toString());
      if (!doc) { return false; }
      doc.text = doc.text.slice(0, doc.offsetAt(range.start)) + text + doc.text.slice(doc.offsetAt(range.end));
      doc.isDirty = true;
    }
    return true;
  });
  for (const name of ["writeFile", "createDirectory", "delete", "rename", "readFile"]) {
    wfs[name]!.mockReset().mockResolvedValue(undefined);
  }
});

const NOTES = "/lib/papers/p1/notes.qmd";

describe("5.1 Every LabShelf text write to a file that is open as a TextDocument in the window goes through that document (minimal-diff WorkspaceEdit + save) and reads see the document's text: VscodeFileSystem.readText/writeText and the paper notes port (D6a).", () => {
  describe("5.1a openDocumentOf", () => {
    it("5.1a openDocumentOf finds the open document whose uri has the same string form", () => {
      const doc = openDocument(NOTES, "x");
      openDocument("/lib/papers/p2/notes.qmd", "y");
      expect(openDocumentOf(vscode.Uri.file(NOTES))).toBe(doc);
    });

    it("5.1a openDocumentOf is undefined for a file that is not open", () => {
      openDocument("/lib/papers/p2/notes.qmd", "y");
      expect(openDocumentOf(vscode.Uri.file(NOTES))).toBeUndefined();
    });

    it("5.1a openDocumentOf ignores a closed document", () => {
      openDocument(NOTES, "x", { closed: true });
      expect(openDocumentOf(vscode.Uri.file(NOTES))).toBeUndefined();
    });
  });

  describe("5.1a minimalReplace", () => {
    it("5.1a minimalReplace is null for equal texts", () => {
      expect(minimalReplace("same", "same")).toBeNull();
    });

    it("5.1a minimalReplace replaces only the changed middle", () => {
      expect(minimalReplace("hello world", "hello brave world")).toEqual({ from: 6, to: 6, insert: "brave " });
      expect(minimalReplace("one two three", "one 2 three")).toEqual({ from: 4, to: 7, insert: "2" });
    });

    it("5.1a minimalReplace expresses a pure deletion and a pure append in before's offsets", () => {
      expect(minimalReplace("abcdef", "abef")).toEqual({ from: 2, to: 4, insert: "" });
      expect(minimalReplace("abc", "abcdef")).toEqual({ from: 3, to: 3, insert: "def" });
    });

    it("5.1a minimalReplace never lets the common suffix overlap the common prefix", () => {
      expect(minimalReplace("aaa", "aaaa")).toEqual({ from: 3, to: 3, insert: "a" });
      expect(minimalReplace("abab", "ab")).toEqual({ from: 2, to: 4, insert: "" });
      expect(minimalReplace("", "text")).toEqual({ from: 0, to: 0, insert: "text" });
    });
  });

  describe("5.1a replaceDocumentText", () => {
    it("5.1a replaceDocumentText applies one WorkspaceEdit replacing only the changed range, and does not save", async () => {
      const doc = openDocument(NOTES, "alpha\nbeta\ngamma\n");

      await replaceDocumentText(doc as unknown as vscode.TextDocument, "alpha\nbexa\ngamma\n");

      expect(applyEdit).toHaveBeenCalledTimes(1);
      const edit = applyEdit.mock.calls[0]![0];
      expect(edit).toBeInstanceOf(vscode.WorkspaceEdit);
      const [replacement, ...rest] = replacementsOf(edit);
      expect(rest).toEqual([]);
      expect(replacement!.uri.toString()).toBe(doc.uri.toString());
      expect(replacement!.range.start).toEqual({ line: 1, character: 2 });
      expect(replacement!.range.end).toEqual({ line: 1, character: 3 });
      expect(replacement!.text).toBe("x");
      expect(doc.save).not.toHaveBeenCalled();
    });

    it("5.1a replaceDocumentText applies no edit when the text is equal", async () => {
      const doc = openDocument(NOTES, "same");
      await replaceDocumentText(doc as unknown as vscode.TextDocument, "same");
      expect(applyEdit).not.toHaveBeenCalled();
    });

    it("5.1a replaceDocumentText throws 'Could not edit <path>' when VS Code refuses the edit", async () => {
      const doc = openDocument(NOTES, "before");
      applyEdit.mockResolvedValue(false);
      await expect(replaceDocumentText(doc as unknown as vscode.TextDocument, "after")).rejects.toThrow(`Could not edit ${NOTES}`);
    });
  });

  describe("5.1a writeThroughDocument", () => {
    it("5.1a writeThroughDocument with no open document resolves false and calls neither applyEdit nor save", async () => {
      const other = openDocument("/lib/papers/p2/notes.qmd", "y");
      await expect(writeThroughDocument(vscode.Uri.file(NOTES), "text")).resolves.toBe(false);
      expect(applyEdit).not.toHaveBeenCalled();
      expect(other.save).not.toHaveBeenCalled();
      expect(wfs["writeFile"]).not.toHaveBeenCalled();
    });

    it("5.1a writeThroughDocument treats a closed document as not open", async () => {
      const doc = openDocument(NOTES, "before", { closed: true });
      await expect(writeThroughDocument(vscode.Uri.file(NOTES), "after")).resolves.toBe(false);
      expect(applyEdit).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it("5.1a writeThroughDocument with an open document applies one edit over only the changed range", async () => {
      openDocument(NOTES, "alpha\nbeta\ngamma\n");

      await writeThroughDocument(vscode.Uri.file(NOTES), "alpha\nbexa\ngamma\n");

      expect(applyEdit).toHaveBeenCalledTimes(1);
      const [replacement, ...rest] = replacementsOf(applyEdit.mock.calls[0]![0]);
      expect(rest).toEqual([]);
      expect(replacement!.range.start).toEqual({ line: 1, character: 2 });
      expect(replacement!.range.end).toEqual({ line: 1, character: 3 });
      expect(replacement!.text).toBe("x");
    });

    it("5.1a writeThroughDocument saves the edited document after the edit and resolves true", async () => {
      const doc = openDocument(NOTES, "before");

      await expect(writeThroughDocument(vscode.Uri.file(NOTES), "after")).resolves.toBe(true);

      expect(doc.text).toBe("after");
      expect(doc.save).toHaveBeenCalledTimes(1);
      expect(applyEdit.mock.invocationCallOrder[0]!).toBeLessThan(doc.save.mock.invocationCallOrder[0]!);
      expect(doc.isDirty).toBe(false);
    });

    it("5.1a writeThroughDocument with equal text on a clean document applies no edit and does not save, and resolves true", async () => {
      const doc = openDocument(NOTES, "same");
      await expect(writeThroughDocument(vscode.Uri.file(NOTES), "same")).resolves.toBe(true);
      expect(applyEdit).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it("5.1a writeThroughDocument saves a document that was already dirty, with its unsaved edits", async () => {
      const doc = openDocument(NOTES, "unsaved edit", { dirty: true });
      await expect(writeThroughDocument(vscode.Uri.file(NOTES), "unsaved edit")).resolves.toBe(true);
      expect(applyEdit).not.toHaveBeenCalled();
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it("5.1a writeThroughDocument matches the document through a different Uri object of the same file", async () => {
      const doc = openDocument(NOTES, "before");
      await expect(writeThroughDocument(vscode.Uri.parse(`file://${NOTES}`), "after")).resolves.toBe(true);
      expect(doc.text).toBe("after");
    });

    it("5.1a writeThroughDocument throws 'Could not save <path>' when the save resolves false", async () => {
      const doc = openDocument(NOTES, "before");
      doc.save.mockResolvedValue(false);
      await expect(writeThroughDocument(vscode.Uri.file(NOTES), "after")).rejects.toThrow(`Could not save ${NOTES}`);
    });

    it("5.1a writeThroughDocument throws 'Could not edit <path>' when the edit is refused, and does not save", async () => {
      const doc = openDocument(NOTES, "before");
      applyEdit.mockResolvedValue(false);
      await expect(writeThroughDocument(vscode.Uri.file(NOTES), "after")).rejects.toThrow(`Could not edit ${NOTES}`);
      expect(doc.save).not.toHaveBeenCalled();
    });
  });

  describe("5.1b VscodeFileSystem", () => {
    const makeFs = (): VscodeFileSystem => new VscodeFileSystem("/lib", path, vscode.Uri.file);

    it("5.1b VscodeFileSystem.writeText of a path whose document is open edits and saves the document", async () => {
      const doc = openDocument(NOTES, "alpha\nbeta\n");

      await makeFs().writeText(NOTES, "alpha\nbeta\ngamma\n");

      expect(doc.text).toBe("alpha\nbeta\ngamma\n");
      expect(applyEdit).toHaveBeenCalledTimes(1);
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it("5.1b VscodeFileSystem.writeText of a path whose document is open does not write or rename through workspace.fs", async () => {
      openDocument(NOTES, "before");

      await makeFs().writeText(NOTES, "after");

      expect(wfs["writeFile"]).not.toHaveBeenCalled();
      expect(wfs["rename"]).not.toHaveBeenCalled();
    });

    it("5.1b VscodeFileSystem.writeText with no open document keeps the temp + rename write", async () => {
      openDocument("/lib/papers/p2/notes.qmd", "other");

      await makeFs().writeText(NOTES, "héllo");

      expect(applyEdit).not.toHaveBeenCalled();
      const [tmp, content] = wfs["writeFile"]!.mock.calls[0] as [vscode.Uri, Uint8Array];
      expect(tmp.fsPath).toMatch(/^\/lib\/\.research\/tmp\/\.notes\.qmd\.[0-9a-f-]{36}\.tmp$/);
      expect(Buffer.from(content).toString("utf8")).toBe("héllo");
      expect(wfs["rename"]).toHaveBeenCalledWith(tmp, vscode.Uri.file(NOTES), { overwrite: true });
    });

    it("5.1b VscodeFileSystem.writeText with only a closed document keeps the temp + rename write", async () => {
      const doc = openDocument(NOTES, "before", { closed: true });

      await makeFs().writeText(NOTES, "after");

      expect(applyEdit).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
      expect(wfs["rename"]).toHaveBeenCalledTimes(1);
    });

    it("5.1b VscodeFileSystem.readText returns the open document's text, including unsaved edits, without reading the disk", async () => {
      openDocument(NOTES, "unsaved edits only in memory", { dirty: true });
      wfs["readFile"]!.mockResolvedValue(Buffer.from("old disk text", "utf8"));

      await expect(makeFs().readText(NOTES)).resolves.toBe("unsaved edits only in memory");
      expect(wfs["readFile"]).not.toHaveBeenCalled();
    });

    it("5.1b VscodeFileSystem.readText with no open document reads the disk", async () => {
      wfs["readFile"]!.mockResolvedValue(Buffer.from("disk text", "utf8"));
      await expect(makeFs().readText(NOTES)).resolves.toBe("disk text");
      expect(wfs["readFile"]).toHaveBeenCalledWith(vscode.Uri.file(NOTES));
    });

    it("5.1b VscodeFileSystem.readText ignores a closed document and reads the disk", async () => {
      openDocument(NOTES, "stale document text", { closed: true });
      wfs["readFile"]!.mockResolvedValue(Buffer.from("disk text", "utf8"));
      await expect(makeFs().readText(NOTES)).resolves.toBe("disk text");
    });

    it("5.1b VscodeFileSystem.writeFile of bytes never consults the open document", async () => {
      const doc = openDocument("/lib/papers/p1/notes.bin", "text");

      await makeFs().writeFile("/lib/papers/p1/notes.bin", new Uint8Array([1, 2]));

      expect(applyEdit).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
      expect(wfs["writeFile"]).toHaveBeenCalledTimes(1);
      expect(wfs["rename"]).toHaveBeenCalledTimes(1);
    });
  });
});
