// Tests which PDF a project's preview shows: next to main for LaTeX, in the build folder for Typst, found through the workspace file system.
import * as path from "node:path";
import * as vscode from "vscode";

import { builtPdf } from "../../../src/writing/preview/builtPdf";
import { readyEntry } from "../../support/writingFixtures";

type Project = Parameters<typeof builtPdf>[0];
const dir = path.join(path.sep, "ws", "paper");
const cache = path.join(path.sep, "cache");
let previousCache: string | undefined;
const stat = vscode.workspace.fs.stat as jest.Mock;

/** Makes only the given paths exist; any other stat fails like VS Code's FileNotFound. */
function existing(...paths: string[]): void {
  stat.mockImplementation(async (uri: vscode.Uri) => {
    if (paths.includes(uri.fsPath)) { return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 }; }
    throw Object.assign(new Error("FileNotFound"), { code: "FileNotFound" });
  });
}

const typst = (over = {}) => readyEntry(dir, { main: "doc/main.typ", settings: { id: "paper", format: "typst" }, ...over }) as Project;

beforeEach(() => {
  previousCache = process.env["XDG_CACHE_HOME"];
  process.env["XDG_CACHE_HOME"] = cache;
});

afterEach(() => {
  if (previousCache === undefined) { delete process.env["XDG_CACHE_HOME"]; } else { process.env["XDG_CACHE_HOME"] = previousCache; }
  stat.mockImplementation(async () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }));
});

describe("builtPdf", () => {
  it("returns the Typst preview PDF from the build folder, not the one next to main", async () => {
    const preview = path.join(cache, "labshelf", "builds", "paper", "main.pdf");
    existing(preview, path.join(dir, "doc", "main.pdf"));
    expect(await builtPdf(typst())).toBe(preview);
  });

  it("returns undefined for a Typst project whose preview was not compiled, even with a saved PDF next to main", async () => {
    existing(path.join(dir, "doc", "main.pdf"));
    expect(await builtPdf(typst())).toBeUndefined();
  });

  it("returns the PDF next to the main file of a LaTeX project, or undefined when it is missing", async () => {
    const latex = readyEntry(dir, { main: "doc/main.tex" }) as Project;
    existing();
    expect(await builtPdf(latex)).toBeUndefined();
    const pdf = path.join(dir, "doc", "main.pdf");
    existing(pdf);
    expect(await builtPdf(latex)).toBe(pdf);
    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: pdf }));
  });

  it("returns undefined when the file system fails for another reason", async () => {
    stat.mockRejectedValue(new Error("EACCES"));
    expect(await builtPdf(readyEntry(dir, { main: "doc/main.tex" }) as Project)).toBeUndefined();
  });

  it("returns undefined without a project or a main file", async () => {
    expect(await builtPdf(undefined)).toBeUndefined();
    expect(await builtPdf(typst({ main: undefined }))).toBeUndefined();
  });
});
