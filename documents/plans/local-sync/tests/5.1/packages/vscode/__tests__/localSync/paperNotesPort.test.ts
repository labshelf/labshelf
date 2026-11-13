import * as vscode from "vscode";
import { PaperNotesStore } from "@labshelf/core";
import type { PaperNotesPort } from "@labshelf/core";
import { createDocumentPaperNotesPort } from "../../src/localSync/paperNotesPort";

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
function openDocument(fsPath: string, text: string, state: { dirty?: boolean; closed?: boolean } = {}): FakeDocument {
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
  openDocuments.push(doc);
  return doc;
}

interface Replacement { uri: vscode.Uri; range: vscode.Range; text: string }

beforeEach(() => {
  jest.clearAllMocks();
  openDocuments.length = 0;
  applyEdit.mockReset().mockImplementation(async (edit: { replacements: Replacement[] }) => {
    for (const { uri, range, text } of edit.replacements) {
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

const notesPath = (id: string): string | undefined => (id === "nopath" ? undefined : `/lib/papers/${id}/notes.qmd`);

function makePort(): { port: PaperNotesPort; inner: { read: jest.Mock; write: jest.Mock } } {
  const inner = { read: jest.fn(async () => "inner text" as string | null), write: jest.fn(async () => undefined) };
  return { port: createDocumentPaperNotesPort(inner, notesPath, vscode.Uri.file), inner };
}

describe("5.1 the paper notes port goes through the open notes.qmd document", () => {
  it("5.1c the paper notes port reads an open notes.qmd document's text, unsaved edits included", async () => {
    const { port, inner } = makePort();
    openDocument("/lib/papers/p1/notes.qmd", "text typed in the editor, not saved", { dirty: true });

    await expect(port.read("p1")).resolves.toBe("text typed in the editor, not saved");
    expect(inner.read).not.toHaveBeenCalled();
  });

  it("5.1c the paper notes port reads through the inner port when no document is open", async () => {
    const { port, inner } = makePort();
    openDocument("/lib/papers/p2/notes.qmd", "another paper's notes");

    await expect(port.read("p1")).resolves.toBe("inner text");
    expect(inner.read).toHaveBeenCalledWith("p1");
  });

  it("5.1c the paper notes port passes the inner port's null (no notes yet) through", async () => {
    const { port, inner } = makePort();
    inner.read.mockResolvedValue(null);
    await expect(port.read("p1")).resolves.toBeNull();
  });

  it("5.1c the paper notes port reads through the inner port when the document is closed", async () => {
    const { port, inner } = makePort();
    openDocument("/lib/papers/p1/notes.qmd", "stale", { closed: true });

    await expect(port.read("p1")).resolves.toBe("inner text");
    expect(inner.read).toHaveBeenCalledWith("p1");
  });

  it("5.1c the paper notes port reads through the inner port for a paper with no notes path", async () => {
    const { port, inner } = makePort();
    await expect(port.read("nopath")).resolves.toBe("inner text");
    expect(inner.read).toHaveBeenCalledWith("nopath");
  });

  it("5.1c the paper notes port writes through an open notes.qmd document: edit and save, not the inner port", async () => {
    const { port, inner } = makePort();
    const doc = openDocument("/lib/papers/p1/notes.qmd", "old notes");

    await port.write("p1", "new notes");

    expect(doc.text).toBe("new notes");
    expect(applyEdit).toHaveBeenCalledTimes(1);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(inner.write).not.toHaveBeenCalled();
  });

  it("5.1c the paper notes port delegates a write to the inner port when no document is open", async () => {
    const { port, inner } = makePort();
    await port.write("p1", "new notes");
    expect(inner.write).toHaveBeenCalledWith("p1", "new notes");
    expect(applyEdit).not.toHaveBeenCalled();
  });

  it("5.1c the paper notes port delegates a write to the inner port when the document is closed", async () => {
    const { port, inner } = makePort();
    const doc = openDocument("/lib/papers/p1/notes.qmd", "old", { closed: true });
    await port.write("p1", "new notes");
    expect(inner.write).toHaveBeenCalledWith("p1", "new notes");
    expect(doc.save).not.toHaveBeenCalled();
  });

  it("5.1c the paper notes port delegates a write to the inner port for a paper with no notes path", async () => {
    const { port, inner } = makePort();
    await port.write("nopath", "text");
    expect(inner.write).toHaveBeenCalledWith("nopath", "text");
    expect(applyEdit).not.toHaveBeenCalled();
  });

  it("A6 a reader note write while notes.qmd is open lands in that TextDocument with no disk write behind it", async () => {
    const { port, inner } = makePort();
    inner.read.mockResolvedValue(null);
    const doc = openDocument("/lib/papers/p1/notes.qmd", "");
    const store = new PaperNotesStore(port, { newId: () => "n-01ARZ3NDEKTSV4RRFFQ69G5FAV", now: () => "2026-01-01T00:00:00.000Z" });

    await store.addItem("p1", { body: "a note from the reader" });

    expect(doc.text).toContain("a note from the reader");
    expect(doc.isDirty).toBe(false);
    expect(doc.save).toHaveBeenCalled();
    expect(inner.write).not.toHaveBeenCalled();
    expect(wfs["writeFile"]).not.toHaveBeenCalled();
    expect(wfs["rename"]).not.toHaveBeenCalled();
  });

  it("A6 a second reader note write builds on the editor's unsaved text instead of the disk copy", async () => {
    const { port, inner } = makePort();
    const doc = openDocument("/lib/papers/p1/notes.qmd", "typed in the editor, unsaved\n\n", { dirty: true });
    const store = new PaperNotesStore(port, { newId: () => "n-01ARZ3NDEKTSV4RRFFQ69G5FAW", now: () => "2026-01-01T00:00:00.000Z" });

    await store.addItem("p1", { body: "reader note" });

    expect(doc.text).toContain("typed in the editor, unsaved");
    expect(doc.text).toContain("reader note");
    expect(inner.read).not.toHaveBeenCalled();
    expect(inner.write).not.toHaveBeenCalled();
  });
});
