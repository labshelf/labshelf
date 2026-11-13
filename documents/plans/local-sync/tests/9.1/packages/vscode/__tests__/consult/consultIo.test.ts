// Tests the VS Code ConsultIo: the lists the chooser shows, a paper's marks and notes, the project's files and code, Browse... and the no-op open.
// Deps this test hands createVscodeConsultIo: { library, projects, activeSource, highlightsOf, paperNotes, projectFolder? } (the same pieces the
// source editor provider and createReaderCiteIo take; projectFolder is the panel's project folder, absent for a panel with no project).
import * as vscode from "vscode";
import { answerConsult } from "@labshelf/core";
import { createVscodeConsultIo } from "../../src/consult/consultIo";
import { fakeProjects, readyEntry } from "../support/writingFixtures";

// The shared vscode mock has no Uri#with and no workspace.findFiles, which the code listing uses.
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
  return actual;
});

const workspace = vscode.workspace as unknown as { findFiles: jest.Mock; workspaceFolders: unknown; fs: { stat: jest.Mock } };
const window = vscode.window as unknown as { showOpenDialog: jest.Mock };

const PAPERS = [
  { id: "p1", title: "Beta", path: "/lib/papers/p1", citeKey: "beta2020", year: 2020 },
  { id: "p2", title: "Alpha", path: "/lib/papers/p2" },
];

function make(options: { projectFolder?: string | undefined; files?: string[] } = {}) {
  const projects = fakeProjects([readyEntry("/ws/proj"), { kind: "broken", folder: "/ws/broken" } as never]);
  projects.data.listProjectFiles.mockResolvedValue(options.files ?? ["main.tex", "notes.qmd", "sub/a.qmd", "refs.bib"]);
  const highlightsOf = jest.fn(async (paperId: string) => [{ id: `h-${paperId}` }] as never[]);
  const paperNotes = { read: jest.fn(async (paperId: string) => `notes of ${paperId}`) };
  const deps = {
    library: { listPapers: async () => PAPERS }, projects, activeSource: { current: () => undefined, listOpen: () => [] },
    highlightsOf, paperNotes, ...("projectFolder" in options ? { projectFolder: options.projectFolder } : { projectFolder: "/ws/proj" }),
  };
  const io = createVscodeConsultIo(deps as unknown as Parameters<typeof createVscodeConsultIo>[0]);
  return { io, projects, highlightsOf, paperNotes };
}

beforeEach(() => {
  workspace.workspaceFolders = [{ uri: vscode.Uri.file("/ws"), name: "ws", index: 0 }];
  workspace.findFiles.mockResolvedValue([vscode.Uri.file("/ws/proj/a.py"), vscode.Uri.file("/ws/analysis/fit.py"), vscode.Uri.file("/ws/readme.md")]);
});

afterEach(() => {
  workspace.workspaceFolders = undefined;
  window.showOpenDialog.mockReset();
  window.showOpenDialog.mockResolvedValue(undefined);
});

describe("9.1b the VS Code ConsultIo", () => {
  it("9.1b listPapers answers the library's papers", async () => {
    expect(await make().io.listPapers()).toEqual(PAPERS);
  });

  it("9.1b annotationsOf answers highlightsOf and paperNotesText answers the paper notes store's text", async () => {
    const { io, highlightsOf, paperNotes } = make();
    expect(await io.annotationsOf("p1")).toEqual([{ id: "h-p1" }]);
    expect(highlightsOf).toHaveBeenCalledWith("p1");
    expect(await io.paperNotesText("p2")).toBe("notes of p2");
    expect(paperNotes.read).toHaveBeenCalledWith("p2");
  });

  it("9.1b paperIdsWithNotes lists the papers whose notes.qmd exists", async () => {
    workspace.fs.stat.mockImplementation(async (uri: vscode.Uri) => {
      if (uri.fsPath !== "/lib/papers/p2/notes.qmd") { throw new Error("FileNotFound"); }
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 };
    });
    expect(await make().io.paperIdsWithNotes()).toEqual(["p2"]);
  });

  it("9.1b projects are the ready projects and listFiles the project's files", async () => {
    const { io, projects } = make();
    const ready = await io.projects();
    expect(ready.map((project: { folder: string }) => project.folder)).toEqual(["/ws/proj"]);
    expect(await io.listFiles(ready[0]!)).toEqual(["main.tex", "notes.qmd", "sub/a.qmd", "refs.bib"]);
    expect(projects.data.listProjectFiles).toHaveBeenCalledWith("/ws/proj");
  });

  it("9.1b projectNotes are the project's .qmd files", async () => {
    const { io } = make();
    const [project] = await io.projects();
    expect(await io.projectNotes!(project!)).toEqual(["notes.qmd", "sub/a.qmd"]);
  });

  it("9.1b the list of code files is the workspace's, relative to the project folder, when the panel has a project", async () => {
    expect(await make().io.listCodeFiles()).toEqual(["a.py", "../analysis/fit.py"]);
  });

  it("9.1b the list of code files is empty when the panel has no project", async () => {
    expect(await make({ projectFolder: undefined }).io.listCodeFiles()).toEqual([]);
  });

  it("9.1b the code list reply says canBrowse with a project and not without one", async () => {
    const withProject = await answerConsult(make().io, {}, { kind: "list", what: "code" });
    const without = await answerConsult(make({ projectFolder: undefined }).io, {}, { kind: "list", what: "code" });
    expect(withProject).toMatchObject({ ok: true, value: { kind: "entries", canBrowse: true } });
    expect(without).toEqual({ ok: true, value: { kind: "entries", entries: [], canBrowse: false } });
  });

  it("9.1b browse is omitted without a project", () => {
    expect(make({ projectFolder: undefined }).io.browse).toBeUndefined();
  });

  it("9.1b browse answers the picked code file's project-relative path and its name", async () => {
    window.showOpenDialog.mockResolvedValue([vscode.Uri.file("/ws/analysis/fit.py")]);
    expect(await make().io.browse!()).toEqual({ path: "../analysis/fit.py", name: "fit.py" });
  });

  it("9.1b browse answers null when the user cancels", async () => {
    window.showOpenDialog.mockResolvedValue(undefined);
    expect(await make().io.browse!()).toBeNull();
  });

  it("9.1b open does nothing and resolves", async () => {
    await expect(make().io.open!({ kind: "code", path: "a.py" })).resolves.toBeUndefined();
  });
});
