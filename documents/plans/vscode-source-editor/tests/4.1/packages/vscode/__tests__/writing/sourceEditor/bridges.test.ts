// Tests the host bridges of the LabShelf source editor: the file's diagnostics, paper notes, note insertables and project-bounded file requests.
import * as vscode from "vscode";

import { createSourceBridges } from "../../../src/writing/sourceEditor/bridges";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };

type Collected = { range: { start: { line: number } }; message: string; severity: number };
const diagnostic = (line: number, message: string, severity: number): Collected => ({ range: { start: { line } }, message, severity });

const languages = vscode.languages as unknown as { getDiagnostics: jest.Mock };
let diagnostics: Collected[];

const notes = {
  read: jest.fn(async (paperId: string) => ({ paperId, items: [] })),
  listProjectNotes: jest.fn(async () => [{ path: "notes/a.qmd", title: "A" }]),
  readProjectNote: jest.fn(async (path: string) => (path === "notes/a.qmd" ? "# A" : undefined)),
  listCitedPaperIds: jest.fn(async () => ["p1", "p2"]),
  readPaperNote: jest.fn(async (paperId: string) => (paperId === "p1" ? "# p1" : undefined)),
};
const openNotes = jest.fn();

function create(projectRoot: vscode.Uri | undefined = vscode.Uri.file("/proj")) {
  return createSourceBridges({
    uri: vscode.Uri.file("/proj/main.tex"), projectRoot,
    library: {} as never, notes: notes as never, openNotes, logger: logger as never,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  diagnostics = [];
  languages.getDiagnostics = jest.fn(() => diagnostics);
});

describe("problems", () => {
  it("4.1a lists the file's diagnostics with one-based lines", () => {
    diagnostics = [diagnostic(0, "Undefined control sequence", 0), diagnostic(11, "Overfull hbox", 1)];
    const message = create().problems();
    expect(message).toEqual({
      type: "problems",
      problems: [
        { line: 1, severity: "error", message: "Undefined control sequence" },
        { line: 12, severity: "warning", message: "Overfull hbox" },
      ],
    });
  });

  it("4.1a asks VS Code for the diagnostics of the bridge's own uri, which merges every collection", () => {
    const uri = vscode.Uri.file("/proj/main.tex");
    create().problems();
    expect(languages.getDiagnostics).toHaveBeenCalledTimes(1);
    expect((languages.getDiagnostics.mock.calls[0] as [vscode.Uri])[0].fsPath).toBe(uri.fsPath);
  });

  it("4.1a maps information and hint severities to info", () => {
    diagnostics = [diagnostic(2, "Label unused", 2), diagnostic(3, "Consider rewording", 3)];
    expect(create().problems().problems.map((problem) => problem.severity)).toEqual(["info", "info"]);
  });

  it("4.1a reads the diagnostics afresh on each call, so a change shows in the next message", () => {
    const bridges = create();
    diagnostics = [diagnostic(4, "Missing $ inserted", 0)];
    expect(bridges.problems().problems).toHaveLength(1);
    diagnostics = [diagnostic(4, "Missing $ inserted", 0), diagnostic(8, "Citation `x` undefined", 1)];
    expect(bridges.problems().problems.map((problem) => problem.line)).toEqual([5, 9]);
    diagnostics = [];
    expect(bridges.problems()).toEqual({ type: "problems", problems: [] });
  });
});

describe("paper notes and note insertables", () => {
  it("4.1b readNote answers from the paper notes store", async () => {
    const value = await create().handle("readNote", { paperId: "p1" });
    expect(notes.read).toHaveBeenCalledWith("p1");
    expect(value).toEqual({ paperId: "p1", items: [] });
  });

  it("4.1b listProjectNotes answers from the note insert source", async () => {
    expect(await create().handle("listProjectNotes", {})).toEqual([{ path: "notes/a.qmd", title: "A" }]);
  });

  it("4.1b readProjectNote reads the note at the given path, and answers undefined for a missing one", async () => {
    const bridges = create();
    expect(await bridges.handle("readProjectNote", { path: "notes/a.qmd" })).toBe("# A");
    expect(notes.readProjectNote).toHaveBeenCalledWith("notes/a.qmd");
    expect(await bridges.handle("readProjectNote", { path: "notes/none.qmd" })).toBeUndefined();
  });

  it("4.1b listCitedPaperIds and readPaperNote answer from the note insert source", async () => {
    const bridges = create();
    expect(await bridges.handle("listCitedPaperIds", {})).toEqual(["p1", "p2"]);
    expect(await bridges.handle("readPaperNote", { paperId: "p1" })).toBe("# p1");
    expect(notes.readPaperNote).toHaveBeenCalledWith("p1");
  });

  it("4.1b openNotes asks the host to show the paper's notes", async () => {
    await create().handle("openNotes", { paperId: "p2" });
    expect(openNotes).toHaveBeenCalledTimes(1);
    expect(openNotes).toHaveBeenCalledWith("p2");
  });

  it("4.1b rejects an unknown method", async () => {
    await expect(create().handle("deleteEverything", {})).rejects.toBeDefined();
  });
});

describe("paths are project-relative and checked inside the project root", () => {
  const workspaceFs = vscode.workspace.fs as unknown as { readFile: jest.Mock; readDirectory: jest.Mock };

  it.each([["../outside.txt"], ["sub/../../outside.txt"], ["/etc/passwd"]])("4.1b readFile refuses %s", async (path) => {
    await expect(create().handle("readFile", { path })).rejects.toBeDefined();
    expect(workspaceFs.readFile).not.toHaveBeenCalled();
  });

  it("4.1b listFiles refuses a folder outside the project", async () => {
    await expect(create().handle("listFiles", { path: ".." })).rejects.toBeDefined();
    expect(workspaceFs.readDirectory).not.toHaveBeenCalled();
  });

  it("4.1b readFile refuses every path when the file is in no project", async () => {
    await expect(create(undefined).handle("readFile", { path: "main.tex" })).rejects.toBeDefined();
    expect(workspaceFs.readFile).not.toHaveBeenCalled();
  });
});
