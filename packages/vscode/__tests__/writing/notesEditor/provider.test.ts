// Tests the notes editor's item edits (a page's save or create becomes one WorkspaceEdit replacing only that item's bytes of the TextDocument),
// what its init tells the page, and the note file and paper object requests it answers.
import * as vscode from "vscode";
import type { NoteFileIo, PaperObjectsPort } from "@labshelf/core";
import { answerFileRequest, initMessage, itemMessageEdit, type NotesEditorProviderDeps } from "../../../src/writing/notesEditor/provider";

const ID_A = "n-01JABCDEFGHJKMNPQRSTVWXYZ0";
const ID_B = "n-01JABCDEFGHJKMNPQRSTVWXYZ1";
const TEXT = `intro\n\n::: {#${ID_A} .labshelf-item}\nAlpha\n:::\n\nkept loose\n\n::: {#${ID_B} .labshelf-item}\nBeta\n:::\n`;

/** A TextDocument over `text` whose positions carry the offset they were made from. */
function documentOf(text: string) {
  return { uri: vscode.Uri.file("/lib/papers/x/notes.qmd"), getText: () => text, positionAt: (offset: number) => ({ offset }) as unknown as vscode.Position };
}

interface Replacement { range: { start: { offset: number }; end: { offset: number } }; text: string }
const replacementsOf = (edit: vscode.WorkspaceEdit | undefined): Replacement[] => (edit as unknown as { replacements: Replacement[] } | undefined)?.replacements ?? [];
const applied = (text: string, edit: vscode.WorkspaceEdit | undefined): string =>
  replacementsOf(edit).reduce((acc, r) => acc.slice(0, r.range.start.offset) + r.text + acc.slice(r.range.end.offset), text);

describe("itemMessageEdit", () => {
  it("replaces only the saved item's body and keeps the loose text and the other item byte for byte", () => {
    const edit = itemMessageEdit(documentOf(TEXT), { type: "save", itemId: ID_B, body: "Beta, edited" });
    const [replacement] = replacementsOf(edit);
    expect(replacementsOf(edit)).toHaveLength(1);
    expect(replacement!.range.start.offset).toBeGreaterThan(TEXT.indexOf("kept loose"));
    expect(applied(TEXT, edit)).toBe(TEXT.replace("Beta\n", "Beta, edited\n"));
  });

  it("makes no edit when the body is unchanged", () => {
    expect(itemMessageEdit(documentOf(TEXT), { type: "save", itemId: ID_A, body: "Alpha\n" })).toBeUndefined();
  });

  it("appends a created item stamped with the time, after everything else", () => {
    const edit = itemMessageEdit(documentOf(TEXT), { type: "create", itemId: "n-01JABCDEFGHJKMNPQRSTVWXYZ2", body: "Gamma" }, () => "2026-11-01T00:00:00Z");
    const next = applied(TEXT, edit);
    expect(next.startsWith(TEXT)).toBe(true);
    expect(next).toContain('created="2026-11-01T00:00:00Z"');
    expect(next).toContain("Gamma\n:::");
  });

  it("throws for a body the item writer rejects", () => {
    expect(() => itemMessageEdit(documentOf(TEXT), { type: "save", itemId: ID_A, body: ":::\n" })).toThrow();
  });
});

describe("the notes editor's host requests", () => {
  const document = { ...documentOf(TEXT), getText: () => TEXT } as unknown as vscode.TextDocument;
  const base = { extensionUri: vscode.Uri.file("/ext"), logger: { log: async () => undefined, error: async () => undefined } };
  const written = new Map<string, Uint8Array>();
  const io: NoteFileIo = {
    fs: {
      stat: async (path) => (written.has(path) ? { isFile: true } as never : undefined),
      readFile: async (path) => written.get(path)!,
      writeFile: async (path, bytes) => { written.set(path, bytes); },
      ensureDir: async () => undefined,
    },
    join: (...parts) => parts.join("/"),
    pick: async () => null,
  };
  const port: PaperObjectsPort = {
    papers: async () => [{ id: "p1", citeKey: "smith2020", title: "T", authors: "A", year: "2020" }],
    list: async () => { throw new Error("This paper has no PDF."); },
    preview: async () => null,
    insert: async () => ({ markdown: "m", assets: [], via: "image" }),
  };
  const deps: NotesEditorProviderDeps = { ...base, files: { io, folderOf: () => "/lib/papers/x" }, paperObjects: port, paperOf: async () => "p1" };

  it("tells the page it serves files and From paper…, starting on the note's paper", async () => {
    expect(await initMessage(deps, document, "file:x", false)).toEqual({ type: "init", text: TEXT, noteKey: "file:x", canRun: false, files: true, paperObjects: true, defaultPaperId: "p1" });
  });

  it("offers neither without a port, nor files for a folder the host cannot reach", async () => {
    const message = await initMessage({ ...base, files: { io, folderOf: () => undefined } }, document, "file:x", true);
    expect(message).toEqual({ type: "init", text: TEXT, noteKey: "file:x", canRun: true, files: false, paperObjects: false });
  });

  it("writes and reads a note file beside the note", async () => {
    expect(await answerFileRequest(deps, document, { type: "noteFile.write", requestId: "w", path: "assets/a.png", base64: "AQI=" })).toEqual({ type: "noteFile.reply", requestId: "w" });
    expect(written.get("/lib/papers/x/assets/a.png")).toEqual(new Uint8Array([1, 2]));
    expect(await answerFileRequest(deps, document, { type: "noteFile.read", requestId: "r", path: "assets/a.png" })).toEqual({ type: "noteFile.reply", requestId: "r", base64: "AQI=" });
  });

  it("answers paper object calls from the port, its rejection as the reply's error", async () => {
    expect(await answerFileRequest(deps, document, { type: "paperObjects.request", requestId: "1", call: { op: "papers", query: "" } }))
      .toEqual({ type: "paperObjects.reply", requestId: "1", value: [{ id: "p1", citeKey: "smith2020", title: "T", authors: "A", year: "2020" }] });
    expect(await answerFileRequest(deps, document, { type: "paperObjects.request", requestId: "2", call: { op: "list", paperId: "p1" } }))
      .toEqual({ type: "paperObjects.reply", requestId: "2", error: "This paper has no PDF." });
  });

  it("refuses both kinds of request on a host without them", async () => {
    expect(await answerFileRequest(base, document, { type: "paperObjects.request", requestId: "3", call: { op: "papers", query: "" } })).toHaveProperty("error");
    expect(await answerFileRequest(base, document, { type: "noteFile.read", requestId: "4", path: "a.csv" })).toHaveProperty("error");
  });
});
