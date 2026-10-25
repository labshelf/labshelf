// Tests which PDF a project's preview shows: next to main for LaTeX, in the build folder for Typst, found through the workspace file system.
import * as path from "node:path";
import * as vscode from "vscode";

import { deriveBuildRootFolder } from "@labshelf/core";
import { builtPdf } from "../../../src/writing/preview/builtPdf";
import { fakeProjects, readyEntry } from "../../support/writingFixtures";

type Project = Parameters<typeof builtPdf>[1];
const dir = path.join(path.sep, "ws", "paper");
const cache = path.join(path.sep, "cache");
const projects = fakeProjects();
projects.data.projectBuildDir.mockImplementation((id: string) => path.join(cache, id));
const stat = vscode.workspace.fs.stat as jest.Mock;

/** Makes only the given paths exist; any other stat fails like VS Code's FileNotFound. */
function existing(...paths: string[]): void {
  stat.mockImplementation(async (uri: vscode.Uri) => {
    if (paths.includes(uri.fsPath)) { return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 }; }
    throw Object.assign(new Error("FileNotFound"), { code: "FileNotFound" });
  });
}

const typst = (over = {}) => readyEntry(dir, { main: "doc/main.typ", settings: { id: "paper", format: "typst" }, ...over }) as Project;

afterEach(() => {
  stat.mockImplementation(async () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }));
});

describe("builtPdf", () => {
  it("returns the Typst preview PDF from the build folder, not the one next to main", async () => {
    const preview = path.join(cache, "paper", deriveBuildRootFolder("doc/main.typ"), "main.pdf");
    existing(preview, path.join(dir, "doc", "main.pdf"));
    expect(await builtPdf(projects, typst(), "doc/main.typ")).toBe(preview);
  });

  it("returns undefined for a Typst project whose preview was not compiled, even with a saved PDF next to main", async () => {
    existing(path.join(dir, "doc", "main.pdf"));
    expect(await builtPdf(projects, typst(), "doc/main.typ")).toBeUndefined();
  });

  it("returns the PDF next to the main file of a LaTeX project, or undefined when it is missing", async () => {
    const latex = readyEntry(dir, { main: "doc/main.tex" }) as Project;
    existing();
    expect(await builtPdf(projects, latex, "doc/main.tex")).toBeUndefined();
    const pdf = path.join(dir, "doc", "main.pdf");
    existing(pdf);
    expect(await builtPdf(projects, latex, "doc/main.tex")).toBe(pdf);
    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: pdf }));
  });

  it("returns undefined when the file system fails for another reason", async () => {
    stat.mockRejectedValue(new Error("EACCES"));
    expect(await builtPdf(projects, readyEntry(dir, { main: "doc/main.tex" }) as Project, undefined)).toBeUndefined();
  });

  it("returns undefined without a project or a main file", async () => {
    expect(await builtPdf(projects, undefined, "doc/main.typ")).toBeUndefined();
    expect(await builtPdf(projects, typst({ main: undefined }), undefined)).toBeUndefined();
  });
});
