// Tests the project export actions: the zips, the PDF, the system viewer and the pandoc documents, over a fake workspace file system.
import * as path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import * as vscode from "vscode";

import { exportProject } from "../../src/writing/exportProject";

const pandoc = jest.fn(async (_request: unknown) => {});
import { fakeLogger, fakeProjects, readyEntry } from "../support/writingFixtures";

type Project = Parameters<typeof exportProject>[1];
const dir = path.join(path.sep, "ws", "paper");
const MAIN = "\\documentclass{article}\\begin{document}\\cite{a}\\bibliography{refs,labshelf}\\end{document}";
const REFS = "@article{a, title={A}}\n@article{b, title={B}}\n";
const GENERATED = "@article{g, title={G}}\n";
const workspace = vscode.workspace as unknown as { findFiles: jest.Mock; fs: Record<string, jest.Mock> };
const window = vscode.window as unknown as Record<string, jest.Mock>;
const env = vscode.env as unknown as { openExternal: jest.Mock };

const logger = fakeLogger();
const projects = fakeProjects();
const deps = { logger, projects, convertDocument: pandoc };
let files: Record<string, string>;

const project = (bibliography?: string) => readyEntry(dir, {
  main: "main.tex", settings: { id: "paper", format: "latex", ...(bibliography ? { bibliography } : {}) },
}) as Project;

function fileSystem(contents: Record<string, string>): void {
  files = contents;
  workspace.findFiles.mockImplementation(async () => Object.keys(files).map((name) => vscode.Uri.file(path.join(dir, name))));
  workspace.fs["readFile"]!.mockImplementation(async (uri: vscode.Uri) => {
    const text = files[path.relative(dir, uri.fsPath).split(path.sep).join("/")];
    if (text === undefined) { throw new Error(`missing ${uri.fsPath}`); }
    return new TextEncoder().encode(text);
  });
}

/** The entries of the zip the last write saved, as text. */
function savedZip(): Record<string, string> {
  const bytes = workspace.fs["writeFile"]!.mock.calls[0]![1] as Uint8Array;
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, data]) => [name, strFromU8(data)]));
}

beforeEach(() => {
  workspace.findFiles = jest.fn();
  workspace.fs["writeFile"]!.mockClear();
  window["showSaveDialog"]!.mockReset().mockResolvedValue(vscode.Uri.file("/out/saved.zip"));
  window["showInformationMessage"]!.mockClear();
  window["showErrorMessage"]!.mockClear();
  env.openExternal.mockClear();
  workspace.fs["copy"] = jest.fn(async () => {});
  pandoc.mockReset().mockResolvedValue(undefined);
  logger.error.mockClear();
  fileSystem({
    "main.tex": MAIN, "refs.bib": REFS, "labshelf.bib": GENERATED, "gen.bib": GENERATED,
    "main.pdf": "pdf", "main.aux": "aux", "fig/a.png": "png", ".labshelf/state.json": "{}",
  });
});

describe("exportProject", () => {
  it("saves the project's files, without build output and the generated bibliography, as <id>.zip", async () => {
    await exportProject(deps, project("gen.bib"), "main.tex", "projectZip");
    expect(window["showSaveDialog"]!.mock.calls[0]![0].defaultUri.fsPath).toMatch(/paper\.zip$/);
    expect(workspace.fs["writeFile"]!.mock.calls[0]![0].fsPath).toBe(path.resolve("/out/saved.zip"));
    const zip = savedZip();
    expect(Object.keys(zip).sort()).toEqual(["fig/a.png", "main.tex", "refs.bib"]);
    expect(zip["refs.bib"]).toBe(REFS);
  });

  it("saves an arXiv zip with only the cited entries of each .bib and no generated bibliography", async () => {
    await exportProject(deps, project("gen.bib"), "main.tex", "arxivZip");
    expect(window["showSaveDialog"]!.mock.calls[0]![0].defaultUri.fsPath).toMatch(/paper-arxiv\.zip$/);
    const zip = savedZip();
    expect(Object.keys(zip).sort()).toEqual(["fig/a.png", "main.tex", "refs.bib"]);
    expect(zip["refs.bib"]).toContain("@article{a");
    expect(zip["refs.bib"]).not.toContain("@article{b");
  });

  it("leaves labshelf.bib out of the arXiv zip when the project uses the default bibliography", async () => {
    await exportProject(deps, project(), "main.tex", "arxivZip");
    expect(Object.keys(savedZip())).not.toContain("labshelf.bib");
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    window["showSaveDialog"]!.mockResolvedValue(undefined);
    await exportProject(deps, project(), "main.tex", "projectZip");
    expect(workspace.fs["writeFile"]).not.toHaveBeenCalled();
    expect(window["showErrorMessage"]).not.toHaveBeenCalled();
  });

  it("opens the built PDF in the system viewer", async () => {
    await exportProject(deps, project(), "main.tex", "systemViewer");
    expect(env.openExternal.mock.calls[0]![0].fsPath).toBe(path.join(dir, "main.pdf"));
  });

  it("tells the user when the root has no built PDF", async () => {
    workspace.fs["stat"]!.mockRejectedValueOnce(new Error("FileNotFound"));
    await exportProject(deps, project(), "main.tex", "systemViewer");
    expect(env.openExternal).not.toHaveBeenCalled();
    expect(window["showInformationMessage"]).toHaveBeenCalledTimes(1);
  });

  it("logs the project, root and target and shows an error when the write fails", async () => {
    const failure = new Error("disk full");
    workspace.fs["writeFile"]!.mockRejectedValueOnce(failure);
    await exportProject(deps, project(), "main.tex", "projectZip");
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), failure, { project: "paper", root: "main.tex", target: "projectZip" });
    expect(window["showErrorMessage"]).toHaveBeenCalledTimes(1);
  });

  it("saves the built PDF where the user picks, offering <id>.pdf", async () => {
    window["showSaveDialog"]!.mockResolvedValue(vscode.Uri.file("/out/paper.pdf"));
    await exportProject(deps, project(), "main.tex", "pdf");
    expect(window["showSaveDialog"]!.mock.calls[0]![0].defaultUri.fsPath).toMatch(/paper\.pdf$/);
    expect(workspace.fs["copy"]!.mock.calls[0]![0].fsPath).toBe(path.join(dir, "main.pdf"));
    expect(workspace.fs["copy"]!.mock.calls[0]![1].fsPath).toBe(path.resolve("/out/paper.pdf"));
  });

  it("asks for a build before saving a PDF that does not exist", async () => {
    workspace.fs["stat"]!.mockRejectedValueOnce(new Error("FileNotFound"));
    await exportProject(deps, project(), "main.tex", "pdf");
    expect(window["showSaveDialog"]).not.toHaveBeenCalled();
    expect(window["showInformationMessage"]).toHaveBeenCalledTimes(1);
  });

  it("converts the root with pandoc to the picked Word file", async () => {
    window["showSaveDialog"]!.mockResolvedValue(vscode.Uri.file("/out/paper.docx"));
    await exportProject(deps, project(), "main.tex", "docx");
    expect(window["showSaveDialog"]!.mock.calls[0]![0].defaultUri.fsPath).toMatch(/paper\.docx$/);
    expect(pandoc).toHaveBeenCalledWith({ format: "latex", folder: dir, main: "main.tex", target: "docx", output: path.resolve("/out/paper.docx") });
  });

  it("shows pandoc's failure, such as pandoc missing, as an export error", async () => {
    pandoc.mockRejectedValueOnce(new Error("Exporting to Word, Markdown or HTML needs pandoc."));
    await exportProject(deps, project(), "main.tex", "markdown");
    expect(window["showErrorMessage"]!.mock.calls[0]![0]).toContain("needs pandoc");
  });

  it("reports a document export as unavailable where no converter exists", async () => {
    await exportProject({ logger, projects }, project(), "main.tex", "html");
    expect(window["showSaveDialog"]).not.toHaveBeenCalled();
    expect(window["showErrorMessage"]!.mock.calls[0]![0]).toContain("not available");
  });
});
