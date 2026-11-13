// Tests the VS Code host side of the consult window: the consult envelope guards, the per-panel file sessions (text files as one more client of the
// URI's SourceAuthority, qmd notes through the notes editor's item edits) and the answers to consult requests.
// Deps this test hands createConsultFiles: { post, io, projectId?, projectFolder?, projects, library, authorities, autosave, logger }, with
// authorities = { acquire(document), release(document) } (the shared registry of source editor panels) and autosave = { schedule(document) }.
import * as vscode from "vscode";
import { answerConsult, createSourceAuthority, type ConsultIo } from "@labshelf/core";
import { isConsultInbound, isConsultOutbound, type ConsultOutbound } from "../../../core/src/writing/protocol";
import { createConsultFiles } from "../../src/consult/consultFiles";
import { createDocumentSync } from "../../src/writing/sourceEditor/documentSync";
import { usePickedCodeFiles } from "../../src/writing/codeSource";
import { fakeLogger, fakeProjects, readyEntry } from "../support/writingFixtures";

// The shared vscode mock has no EndOfLine enum, no Uri#with and no workspace.findFiles, which the host code uses.
jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  const proto = actual.Uri.prototype;
  if (!proto.with) {
    proto.with = function with_(this: { scheme: string; authority: string; path: string }, change: { path?: string }) {
      const uri = new actual.Uri(this.scheme, this.authority, change.path ?? this.path, "", "");
      uri.fsPath = change.path ?? this.path;
      return uri;
    };
  }
  if (!actual.workspace.findFiles) { actual.workspace.findFiles = jest.fn(async () => []); }
  return { ...actual, EndOfLine: { LF: 1, CRLF: 2 } };
});

type Posted = { type: string; [key: string]: any };
interface Change { from: number; to: number; insert: string }
interface Update { clientID: string; changes: Change[] }

const workspace = vscode.workspace as unknown as {
  _fireTextDocumentChange: (event: unknown) => void;
  applyEdit: jest.Mock;
  openTextDocument: jest.Mock;
  workspaceFolders: unknown;
};

const applyChange = (text: string, change: Change): string => text.slice(0, change.from) + change.insert + text.slice(change.to);

/** A TextDocument double over LF or CRLF text; edits go through `edit`, which fires the change event as VS Code does. */
function fakeTextDocument(file: string, initial: string, options: { crlf?: boolean; dirty?: boolean } = {}) {
  const state = { text: initial };
  const document = {
    uri: vscode.Uri.file(file), languageId: "latex", fileName: file, version: 1, isDirty: options.dirty ?? false, eol: options.crlf ? 2 : 1,
    save: jest.fn(async () => { document.isDirty = false; return true; }),
    getText: () => state.text,
    get lineCount() { return state.text.split("\n").length; },
    offsetAt: (position: vscode.Position): number =>
      state.text.split("\n").slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character,
    positionAt: (offset: number): vscode.Position => {
      const before = state.text.slice(0, offset).split("\n");
      return new vscode.Position(before.length - 1, before[before.length - 1]!.length);
    },
  };
  const edit = (changes: Change[]): void => {
    const contentChanges = changes.map((c) => ({
      range: new vscode.Range(document.positionAt(c.from), document.positionAt(c.to)), rangeOffset: c.from, rangeLength: c.to - c.from, text: c.insert,
    }));
    state.text = [...changes].sort((a, b) => b.from - a.from).reduce(applyChange, state.text);
    document.version += 1;
    document.isDirty = true;
    workspace._fireTextDocumentChange({ document, contentChanges, reason: undefined });
  };
  return { document: document as unknown as vscode.TextDocument, raw: document, edit };
}

type FakeDoc = ReturnType<typeof fakeTextDocument>;

/** Makes workspace.applyEdit apply the edit to the document and openTextDocument answer with it. */
function stage(...docs: FakeDoc[]): void {
  workspace.applyEdit.mockImplementation(async (edit: vscode.WorkspaceEdit) => {
    const replacements = (edit as unknown as { replacements: Array<{ uri: vscode.Uri; range: vscode.Range; text: string }> }).replacements;
    const target = docs.find((doc) => doc.document.uri.toString() === replacements[0]!.uri.toString())!;
    target.edit(replacements.map(({ range, text }) => ({ from: target.document.offsetAt(range.start), to: target.document.offsetAt(range.end), insert: text })));
    return true;
  });
  workspace.openTextDocument.mockImplementation(async (uri: vscode.Uri) => {
    const found = docs.find((doc) => doc.document.uri.toString() === uri.toString());
    if (!found) { throw new Error(`no such file ${uri.fsPath}`); }
    return found.document;
  });
  (vscode.workspace as unknown as { textDocuments: vscode.TextDocument[] }).textDocuments = docs.map((doc) => doc.document);
}

/** The shared authority registry of the source editor panels: one authority per URI, refcounted. */
function fakeAuthorities() {
  const open = new Map<string, { authority: ReturnType<typeof createSourceAuthority>; count: number }>();
  return {
    acquire: jest.fn((document: vscode.TextDocument) => {
      const key = document.uri.toString();
      const entry = open.get(key) ?? { authority: createSourceAuthority({ text: document.getText(), lineBreak: document.eol === 2 ? "\r\n" : "\n" }), count: 0 };
      entry.count += 1;
      open.set(key, entry);
      return entry.authority;
    }),
    release: jest.fn((document: vscode.TextDocument) => {
      const key = document.uri.toString();
      const entry = open.get(key);
      if (!entry) { return; }
      entry.count -= 1;
      if (entry.count <= 0) { open.delete(key); }
    }),
    authorityOf: (document: vscode.TextDocument) => open.get(document.uri.toString())?.authority,
    count: (document: vscode.TextDocument): number => open.get(document.uri.toString())?.count ?? 0,
  };
}

const emptyIo = (over: Partial<ConsultIo> = {}): ConsultIo => ({
  listPapers: async () => [], paperPdfBase64: async () => "", annotationsOf: async () => [], paperNotesText: async () => null,
  paperIdsWithNotes: async () => [], projects: async () => [], listFiles: async () => [], listCodeFiles: async () => [], ...over,
});

interface Setup { projectId?: string | undefined; projectFolder?: string | undefined; io?: ConsultIo; papers?: unknown[] }

function setup(options: Setup = {}) {
  const posts: Posted[] = [];
  const authorities = fakeAuthorities();
  const autosave = { schedule: jest.fn(), dispose: jest.fn() };
  const projects = fakeProjects([readyEntry("/ws/proj")]);
  const io = options.io ?? emptyIo();
  const deps = {
    post: (message: Posted) => { posts.push(message); },
    io,
    ...("projectId" in options ? { projectId: options.projectId } : { projectId: "proj" }),
    ...("projectFolder" in options ? { projectFolder: options.projectFolder } : { projectFolder: "/ws/proj" }),
    projects, library: { listPapers: async () => options.papers ?? [] }, authorities, autosave, logger: fakeLogger(),
  };
  const files = createConsultFiles(deps as unknown as Parameters<typeof createConsultFiles>[0]);
  const send = (message: unknown) => files.handle(message as ConsultOutbound);
  const replies = () => posts.filter((post) => post.type === "consultFileReply");
  return { files, send, posts, replies, authorities, autosave, io };
}

/** Polls an assertion until it holds, for work the host does after handle() resolves. */
async function eventually(check: () => void): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { check(); return; } catch (error) { last = error; await new Promise((resolve) => setTimeout(resolve, 5)); }
  }
  throw last;
}

const pickedMemento = (files: string[]): vscode.Memento => ({ get: ((key: string) => (key === "labshelf.writing.pickedCodeFiles" ? files : undefined)) as never, update: jest.fn(async () => undefined), keys: () => [] });

const ID_A = "n-01JABCDEFGHJKMNPQRSTVWXYZ0";
const ID_B = "n-01JABCDEFGHJKMNPQRSTVWXYZ1";
const NOTES = `intro\n\n::: {#${ID_A} .labshelf-item}\nAlpha\n:::\n\nkept loose\n\n::: {#${ID_B} .labshelf-item}\nBeta\n:::\n`;
const MANUSCRIPT = { kind: "manuscript" as const, projectId: "proj", path: "main.tex" };
const insertAt = (clientID: string, at: number, text: string): Update => ({ clientID, changes: [{ from: at, to: at, insert: text }] });
const push = (key: string, version: number, ...updates: Update[]) => ({ type: "consultDoc", key, message: { type: "push", version, updates } });

beforeEach(() => {
  workspace.workspaceFolders = [{ uri: vscode.Uri.file("/ws"), name: "ws", index: 0 }];
  usePickedCodeFiles(pickedMemento([]));
});

afterEach(() => {
  workspace.applyEdit.mockReset();
  workspace.applyEdit.mockImplementation(async () => true);
  workspace.openTextDocument.mockReset();
  workspace.workspaceFolders = undefined;
});

describe("9.1a the consult envelope guards", () => {
  const request = { kind: "list", what: "paper" };
  const ref = { kind: "paperNotes", paperId: "p1" };

  it("9.1a isConsultOutbound accepts consult, consultFile, consultRelease and each consultDoc message", () => {
    const accepted = [
      { type: "consult", id: 1, request },
      { type: "consultFile", id: 2, key: "w1", ref },
      { type: "consultRelease", key: "w1" },
      { type: "consultDoc", key: "w1", message: { type: "push", version: 3, updates: [] } },
      { type: "consultDoc", key: "w1", message: { type: "save" } },
      { type: "consultDoc", key: "w1", message: { type: "saveItem", itemId: ID_A, body: "x" } },
      { type: "consultDoc", key: "w1", message: { type: "createItem", itemId: ID_B, body: "y" } },
    ];
    expect(accepted.map(isConsultOutbound)).toEqual(accepted.map(() => true));
  });

  it("9.1a isConsultOutbound rejects unknown types, a bad ref or request, a missing key or id and malformed doc messages", () => {
    const rejected = [
      null, "consult", 4, {}, { type: "wat" },
      { type: "consult", request }, { type: "consult", id: 1, request: { kind: "list", what: "everything" } }, { type: "consult", id: "1", request },
      { type: "consultFile", id: 2, ref }, { type: "consultFile", key: "w1", ref }, { type: "consultFile", id: 2, key: "w1", ref: { kind: "code" } },
      { type: "consultFile", id: 2, key: "w1", ref: { kind: "nothing" } }, { type: "consultFile", id: 2, key: 5, ref },
      { type: "consultRelease" }, { type: "consultRelease", key: 1 },
      { type: "consultDoc", message: { type: "save" } }, { type: "consultDoc", key: "w1" }, { type: "consultDoc", key: "w1", message: { type: "wat" } },
      { type: "consultDoc", key: "w1", message: { type: "push", version: 3, updates: "no" } }, { type: "consultDoc", key: "w1", message: { type: "push", updates: [] } },
      { type: "consultDoc", key: "w1", message: { type: "saveItem", itemId: ID_A } },
      { type: "consultReply", id: 1, reply: { ok: false, error: "x" } },
    ];
    expect(rejected.map(isConsultOutbound)).toEqual(rejected.map(() => false));
  });

  it("9.1a isConsultInbound accepts a reply, each file init and error, and each consultDoc message", () => {
    const text = { kind: "text", path: "main.tex", text: "a", lineBreak: "\n", version: 0, dirty: false };
    const accepted = [
      { type: "consultReply", id: 1, reply: { ok: true, value: { kind: "opened" } } },
      { type: "consultReply", id: 1, reply: { ok: false, error: "nope" } },
      { type: "consultFileReply", id: 2, key: "w1", file: text },
      { type: "consultFileReply", id: 2, key: "w1", file: { ...text, lineBreak: "\r\n" } },
      { type: "consultFileReply", id: 2, key: "w1", file: { kind: "qmd", path: "notes.qmd", text: "q" } },
      { type: "consultFileReply", id: 2, key: "w1", file: { error: "outside the workspace" } },
      { type: "consultDoc", key: "w1", message: { type: "updates", version: 1, updates: [] } },
      { type: "consultDoc", key: "w1", message: { type: "resync", text: "t", version: 2 } },
      { type: "consultDoc", key: "w1", message: { type: "dirty", dirty: true } },
      { type: "consultDoc", key: "w1", message: { type: "update", text: "t" } },
    ];
    expect(accepted.map(isConsultInbound)).toEqual(accepted.map(() => true));
  });

  it("9.1a isConsultInbound rejects unknown types, a bad reply or file, a missing key or id and malformed doc messages", () => {
    const text = { kind: "text", path: "main.tex", text: "a", lineBreak: "\n", version: 0, dirty: false };
    const rejected = [
      null, 7, {}, { type: "wat" },
      { type: "consultReply", reply: { ok: false, error: "x" } }, { type: "consultReply", id: 1, reply: { ok: true } }, { type: "consultReply", id: 1 },
      { type: "consultFileReply", key: "w1", file: text }, { type: "consultFileReply", id: 2, file: text },
      { type: "consultFileReply", id: 2, key: "w1", file: { ...text, lineBreak: "\r" } }, { type: "consultFileReply", id: 2, key: "w1", file: { ...text, version: "0" } },
      { type: "consultFileReply", id: 2, key: "w1", file: { kind: "qmd", path: "notes.qmd" } }, { type: "consultFileReply", id: 2, key: "w1", file: { kind: "pdf" } },
      { type: "consultDoc", message: { type: "dirty", dirty: true } }, { type: "consultDoc", key: "w1", message: { type: "update" } },
      { type: "consultDoc", key: "w1", message: { type: "init" } }, { type: "consultDoc", key: "w1", message: { type: "dirty", dirty: "yes" } },
      { type: "consult", id: 1, request },
    ];
    expect(rejected.map(isConsultInbound)).toEqual(rejected.map(() => false));
  });
});

describe("9.1b consult requests", () => {
  it("9.1b a consult request is answered with consultReply carrying the same id and answerConsult's reply", async () => {
    const io = emptyIo({ listPapers: async () => [{ id: "p1", title: "Alpha", path: "/lib/p1" } as never] });
    const { send, posts } = setup({ io });
    const request = { kind: "list", what: "paper" } as const;
    await send({ type: "consult", id: 41, request });
    const expected = await answerConsult(io, { projectId: "proj" }, request);
    expect(posts).toEqual([{ type: "consultReply", id: 41, reply: expected }]);
    expect(expected.ok).toBe(true);
  });

  it("9.1b the request is answered with the panel's project id as context", async () => {
    const io = emptyIo({
      projects: async () => [readyEntry("/ws/proj") as never], projectNotes: async () => ["notes.qmd"],
    });
    const { send, posts } = setup({ io, projectId: "proj" });
    await send({ type: "consult", id: 1, request: { kind: "list", what: "notes" } });
    const entries = (posts[0]!["reply"] as { value: { entries: Array<{ ref: { kind: string } }> } }).value.entries;
    expect(entries.map((entry) => entry.ref.kind)).toEqual(["projectNote"]);
  });

  it("9.1b a panel with no project answers with no project id in the context", async () => {
    const io = emptyIo({ projects: async () => [readyEntry("/ws/proj") as never], projectNotes: async () => ["notes.qmd"] });
    const { send, posts } = setup({ io, projectId: undefined, projectFolder: undefined });
    await send({ type: "consult", id: 2, request: { kind: "list", what: "notes" } });
    const entries = (posts[0]!["reply"] as { value: { entries: unknown[] } }).value.entries;
    expect(entries).toEqual([]);
  });

  it("9.1b a request the io fails on is still answered, with an error reply", async () => {
    const io = emptyIo({ listPapers: async () => { throw new Error("library offline"); } });
    const { send, posts } = setup({ io });
    await send({ type: "consult", id: 3, request: { kind: "list", what: "paper" } });
    expect(posts).toEqual([{ type: "consultReply", id: 3, reply: { ok: false, error: expect.stringContaining("library offline") } }]);
  });
});

describe("9.1c text files of the project", () => {
  it("9.1c consultFile for a manuscript opens the document and replies a text init with LF text, the authority's version and the dirty state", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "alpha\r\nbeta", { crlf: true, dirty: true });
    stage(doc);
    const { send, replies, authorities } = setup();
    await send({ type: "consultFile", id: 7, key: "w1", ref: MANUSCRIPT });
    expect(workspace.openTextDocument).toHaveBeenCalledTimes(1);
    expect((workspace.openTextDocument.mock.calls[0]![0] as vscode.Uri).fsPath).toBe("/ws/proj/main.tex");
    expect(replies()).toEqual([{
      type: "consultFileReply", id: 7, key: "w1",
      file: { kind: "text", path: "main.tex", text: "alpha\nbeta", lineBreak: "\r\n", version: authorities.authorityOf(doc.document)!.version, dirty: true },
    }]);
  });

  it("9.1c the init of a clean LF document says so", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "plain");
    stage(doc);
    const { send, replies } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    expect(replies()[0]!["file"]).toMatchObject({ kind: "text", text: "plain", lineBreak: "\n", dirty: false });
  });

  it("9.1c a push under the window's key edits the TextDocument through one WorkspaceEdit", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "hello\nworld");
    stage(doc);
    const { send, replies } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    const { version } = replies()[0]!["file"] as { version: number };
    await send(push("w1", version, insertAt("c1", 8, "X")));
    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(doc.document.getText()).toBe("hello\nwoXrld");
  });

  it("9.1c a push reaches the document through the same SourceAuthority a source editor panel of that file holds, and that panel receives the updates", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "hello\nworld");
    stage(doc);
    const { send, replies, authorities } = setup();
    const panelPosts: Posted[] = [];
    const panelAuthority = authorities.acquire(doc.document);
    const panel = createDocumentSync({ document: doc.document, authority: panelAuthority, applyEdit: (edit: vscode.WorkspaceEdit) => workspace.applyEdit(edit), post: (m: Posted) => panelPosts.push(m), logger: fakeLogger() } as never);
    await send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    const { version } = replies()[0]!["file"] as { version: number };
    await send(push("w1", version, insertAt("c1", 0, "X")));
    expect(authorities.count(doc.document)).toBe(2);
    expect(panelAuthority.version).toBe(version + 1);
    const updates = panelPosts.filter((post) => post.type === "updates").flatMap((post) => post["updates"] as Update[]);
    expect(updates).toEqual([expect.objectContaining({ clientID: "c1", changes: [{ from: 0, to: 0, insert: "X" }] })]);
    panel.dispose();
  });

  it("9.1c a save under the key saves the document", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "hello", { dirty: true });
    stage(doc);
    const { send } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    await send({ type: "consultDoc", key: "w1", message: { type: "save" } });
    expect(doc.raw.save).toHaveBeenCalledTimes(1);
  });

  it("9.1c a change made to the document elsewhere reaches the consult window as a consultDoc message under its key", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "hello");
    stage(doc);
    const { send, posts } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    doc.edit([{ from: 5, to: 5, insert: "!" }]);
    const doced = posts.filter((post) => post.type === "consultDoc");
    expect(doced.length).toBeGreaterThan(0);
    expect(doced.every((post) => post["key"] === "w1")).toBe(true);
    expect(doced.some((post) => (post["message"] as Posted).type === "updates")).toBe(true);
  });

  it("9.1c a manuscript path that is absolute or climbs out of the project replies an error and opens nothing", async () => {
    stage(fakeTextDocument("/ws/proj/main.tex", "x"));
    const { send, replies } = setup();
    await send({ type: "consultFile", id: 1, key: "a", ref: { ...MANUSCRIPT, path: "/etc/passwd" } });
    await send({ type: "consultFile", id: 2, key: "b", ref: { ...MANUSCRIPT, path: "../other/main.tex" } });
    expect(replies().map((reply) => reply["file"])).toEqual([{ error: expect.any(String) }, { error: expect.any(String) }]);
    expect(workspace.openTextDocument).not.toHaveBeenCalled();
  });

  it("9.1c a file that cannot be opened replies an error sentence and acquires no authority", async () => {
    stage();
    const { send, replies, authorities } = setup();
    await send({ type: "consultFile", id: 5, key: "w1", ref: MANUSCRIPT });
    expect(replies()).toEqual([{ type: "consultFileReply", id: 5, key: "w1", file: { error: expect.stringMatching(/\S/) } }]);
    expect(authorities.acquire).not.toHaveBeenCalled();
  });

  it("9.1c a .qmd manuscript and a project note open as qmd, any other file as text", async () => {
    stage(fakeTextDocument("/ws/proj/paper.qmd", "q1"), fakeTextDocument("/ws/proj/notes.qmd", "q2"), fakeTextDocument("/ws/proj/main.typ", "t"));
    const { send, replies } = setup();
    await send({ type: "consultFile", id: 1, key: "a", ref: { ...MANUSCRIPT, path: "paper.qmd" } });
    await send({ type: "consultFile", id: 2, key: "b", ref: { kind: "projectNote", projectId: "proj", path: "notes.qmd" } });
    await send({ type: "consultFile", id: 3, key: "c", ref: { ...MANUSCRIPT, path: "main.typ" } });
    expect(replies().map((reply) => (reply["file"] as { kind: string }).kind)).toEqual(["qmd", "qmd", "text"]);
  });

  it("9.1c a paper ref and a picked-file ref reply an error, since they are not opened as files", async () => {
    stage();
    const { send, replies } = setup();
    await send({ type: "consultFile", id: 1, key: "a", ref: { kind: "paper", paperId: "p1" } });
    await send({ type: "consultFile", id: 2, key: "b", ref: { kind: "pickedFile", id: "f", name: "f.py" } });
    expect(replies().map((reply) => reply["file"])).toEqual([{ error: expect.any(String) }, { error: expect.any(String) }]);
  });
});

describe("9.1d code files", () => {
  it("9.1d a code path outside the workspace and not picked replies an error and opens nothing", async () => {
    stage(fakeTextDocument("/elsewhere/x.py", "print(1)"));
    const { send, replies } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: { kind: "code", path: "../../elsewhere/x.py" } });
    expect(replies()).toEqual([{ type: "consultFileReply", id: 1, key: "w1", file: { error: expect.stringMatching(/\S/) } }]);
    expect(workspace.openTextDocument).not.toHaveBeenCalled();
  });

  it("9.1d the same path opens once the user has picked the file", async () => {
    stage(fakeTextDocument("/elsewhere/x.py", "print(1)"));
    usePickedCodeFiles(pickedMemento(["/elsewhere/x.py"]));
    const { send, replies } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: { kind: "code", path: "../../elsewhere/x.py" } });
    expect(replies()[0]!["file"]).toMatchObject({ kind: "text", text: "print(1)" });
  });

  it("9.1d a code file inside a workspace folder opens", async () => {
    stage(fakeTextDocument("/ws/analysis/fit.py", "fit()"));
    const { send, replies } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: { kind: "code", path: "../analysis/fit.py" } });
    expect(replies()[0]!["file"]).toMatchObject({ kind: "text", text: "fit()" });
  });

  it("9.1d a panel with no project has no code to open", async () => {
    stage(fakeTextDocument("/ws/analysis/fit.py", "fit()"));
    const { send, replies } = setup({ projectId: undefined, projectFolder: undefined });
    await send({ type: "consultFile", id: 1, key: "w1", ref: { kind: "code", path: "../analysis/fit.py" } });
    expect(replies()[0]!["file"]).toEqual({ error: expect.any(String) });
  });
});

describe("9.1e paper notes and project notes as qmd", () => {
  const paper = { id: "p1", title: "Alpha", path: "/lib/papers/p1" };

  function notesSetup() {
    const doc = fakeTextDocument("/lib/papers/p1/notes.qmd", NOTES);
    stage(doc);
    const made = setup({ papers: [paper] });
    return { doc, ...made };
  }

  it("9.1e a paperNotes ref opens the paper's notes.qmd as qmd with the document's text", async () => {
    const { doc, send, replies } = notesSetup();
    await send({ type: "consultFile", id: 4, key: "n1", ref: { kind: "paperNotes", paperId: "p1" } });
    expect((workspace.openTextDocument.mock.calls[0]![0] as vscode.Uri).fsPath).toBe("/lib/papers/p1/notes.qmd");
    expect(replies()).toEqual([{ type: "consultFileReply", id: 4, key: "n1", file: { kind: "qmd", path: expect.any(String), text: doc.document.getText() } }]);
  });

  it("9.1e a paperNotes ref for a paper not in the library replies an error", async () => {
    const { send, replies } = notesSetup();
    await send({ type: "consultFile", id: 4, key: "n1", ref: { kind: "paperNotes", paperId: "missing" } });
    expect(replies()[0]!["file"]).toEqual({ error: expect.any(String) });
  });

  it("9.1e saveItem replaces only that item's body in the document and schedules the autosave", async () => {
    const { doc, send, autosave } = notesSetup();
    await send({ type: "consultFile", id: 4, key: "n1", ref: { kind: "paperNotes", paperId: "p1" } });
    await send({ type: "consultDoc", key: "n1", message: { type: "saveItem", itemId: ID_B, body: "Beta, edited" } });
    await eventually(() => expect(doc.document.getText()).toBe(NOTES.replace("Beta\n", "Beta, edited\n")));
    await eventually(() => expect(autosave.schedule).toHaveBeenCalledWith(doc.document));
  });

  it("9.1e createItem appends a new item to the document", async () => {
    const { doc, send } = notesSetup();
    await send({ type: "consultFile", id: 4, key: "n1", ref: { kind: "paperNotes", paperId: "p1" } });
    await send({ type: "consultDoc", key: "n1", message: { type: "createItem", itemId: "n-01JABCDEFGHJKMNPQRSTVWXYZ2", body: "Gamma" } });
    await eventually(() => expect(doc.document.getText()).toContain("Gamma\n:::"));
    expect(doc.document.getText().startsWith(NOTES)).toBe(true);
  });

  it("9.1e a change of the document posts consultDoc update with its text under the key", async () => {
    const { doc, send, posts } = notesSetup();
    await send({ type: "consultFile", id: 4, key: "n1", ref: { kind: "paperNotes", paperId: "p1" } });
    doc.edit([{ from: 0, to: 5, insert: "INTRO" }]);
    expect(posts.filter((post) => post.type === "consultDoc")).toEqual([{ type: "consultDoc", key: "n1", message: { type: "update", text: doc.document.getText() } }]);
  });

  it("9.1e a change of another document posts nothing", async () => {
    const { send, posts } = notesSetup();
    const other = fakeTextDocument("/ws/proj/other.tex", "x");
    await send({ type: "consultFile", id: 4, key: "n1", ref: { kind: "paperNotes", paperId: "p1" } });
    other.edit([{ from: 0, to: 0, insert: "y" }]);
    expect(posts.filter((post) => post.type === "consultDoc")).toEqual([]);
  });
});

describe("9.1f release and dispose", () => {
  async function openText() {
    const doc = fakeTextDocument("/ws/proj/main.tex", "hello\nworld");
    stage(doc);
    const made = setup();
    await made.send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    return { doc, ...made };
  }

  it("9.1f consultRelease releases the authority once and a second release is a no-op", async () => {
    const { doc, send, authorities } = await openText();
    await send({ type: "consultRelease", key: "w1" });
    await send({ type: "consultRelease", key: "w1" });
    expect(authorities.release).toHaveBeenCalledTimes(1);
    expect(authorities.release).toHaveBeenCalledWith(doc.document);
    expect(authorities.count(doc.document)).toBe(0);
  });

  it("9.1f after a release the window gets nothing more and its pushes edit nothing", async () => {
    const { doc, send, posts } = await openText();
    await send({ type: "consultRelease", key: "w1" });
    const before = posts.length;
    doc.edit([{ from: 0, to: 0, insert: "!" }]);
    await send(push("w1", 0, insertAt("c1", 0, "Z")));
    expect(posts.length).toBe(before);
    expect(doc.document.getText()).toBe("!hello\nworld");
  });

  it("9.1f releasing a key that was never opened does nothing", async () => {
    const { send, authorities } = await openText();
    await send({ type: "consultRelease", key: "unknown" });
    expect(authorities.release).not.toHaveBeenCalled();
  });

  it("9.1f dispose releases every open file once and a second dispose is a no-op", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "hello");
    const other = fakeTextDocument("/ws/proj/other.tex", "other");
    stage(doc, other);
    const { send, files, authorities } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    await send({ type: "consultFile", id: 2, key: "w2", ref: { ...MANUSCRIPT, path: "other.tex" } });
    files.dispose();
    files.dispose();
    expect(authorities.release).toHaveBeenCalledTimes(2);
    expect(authorities.count(doc.document)).toBe(0);
    expect(authorities.count(other.document)).toBe(0);
  });

  it("9.1f a release after dispose does not release again", async () => {
    const { send, files, authorities } = await openText();
    files.dispose();
    await send({ type: "consultRelease", key: "w1" });
    expect(authorities.release).toHaveBeenCalledTimes(1);
  });

  it("9.1f releasing a qmd window drops its document listener, once", async () => {
    const doc = fakeTextDocument("/lib/papers/p1/notes.qmd", NOTES);
    stage(doc);
    const { send, posts } = setup({ papers: [{ id: "p1", title: "Alpha", path: "/lib/papers/p1" }] });
    await send({ type: "consultFile", id: 1, key: "n1", ref: { kind: "paperNotes", paperId: "p1" } });
    await send({ type: "consultRelease", key: "n1" });
    await send({ type: "consultRelease", key: "n1" });
    doc.edit([{ from: 0, to: 0, insert: "!" }]);
    expect(posts.filter((post) => post.type === "consultDoc")).toEqual([]);
  });

  it("9.1f dispose drops the listener of a qmd window", async () => {
    const doc = fakeTextDocument("/lib/papers/p1/notes.qmd", NOTES);
    stage(doc);
    const { send, files, posts } = setup({ papers: [{ id: "p1", title: "Alpha", path: "/lib/papers/p1" }] });
    await send({ type: "consultFile", id: 1, key: "n1", ref: { kind: "paperNotes", paperId: "p1" } });
    files.dispose();
    doc.edit([{ from: 0, to: 0, insert: "!" }]);
    expect(posts.filter((post) => post.type === "consultDoc")).toEqual([]);
  });
});

describe("A10 a consult window and the source editor tab of one file", () => {
  it("A10 two clients of one authority: a tab's edit reaches the window and the window's edit reaches the tab", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "hello\nworld");
    stage(doc);
    const { send, replies, posts, authorities } = setup();
    const tabPosts: Posted[] = [];
    const tabAuthority = authorities.acquire(doc.document);
    const tab = createDocumentSync({ document: doc.document, authority: tabAuthority, applyEdit: (edit: vscode.WorkspaceEdit) => workspace.applyEdit(edit), post: (m: Posted) => tabPosts.push(m), logger: fakeLogger() } as never);
    await send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    const { version } = replies()[0]!["file"] as { version: number };
    expect(authorities.authorityOf(doc.document)).toBe(tabAuthority);

    await tab.receive({ type: "push", version: tabAuthority.version, updates: [insertAt("tab", 0, "T")] } as never);
    const toWindow = posts.filter((post) => post.type === "consultDoc" && (post["message"] as Posted).type === "updates");
    expect(toWindow.length).toBeGreaterThan(0);
    expect(toWindow[0]).toMatchObject({ key: "w1" });

    await send(push("w1", tabAuthority.version, insertAt("w1", 0, "W")));
    expect(tabAuthority.version).toBe(version + 2);
    expect(tabPosts.some((post) => post.type === "updates" && (post["updates"] as Update[]).some((update) => update.clientID === "w1"))).toBe(true);
    expect(doc.document.getText()).toContain("T");
    expect(doc.document.getText()).toContain("W");
    tab.dispose();
  });

  it("A10 two windows on one file are two clients of the one authority, and the file's authority outlives the first release", async () => {
    const doc = fakeTextDocument("/ws/proj/main.tex", "hello");
    stage(doc);
    const { send, authorities, posts } = setup();
    await send({ type: "consultFile", id: 1, key: "w1", ref: MANUSCRIPT });
    await send({ type: "consultFile", id: 2, key: "w2", ref: MANUSCRIPT });
    expect(authorities.count(doc.document)).toBe(2);
    await send(push("w1", 0, insertAt("w1", 5, "!")));
    expect(posts.some((post) => post.type === "consultDoc" && post["key"] === "w2" && (post["message"] as Posted).type === "updates")).toBe(true);
    await send({ type: "consultRelease", key: "w1" });
    expect(authorities.count(doc.document)).toBe(1);
  });
});
