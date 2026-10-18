// Tests the SyncTeX links of a build preview: a double-click opens the source line, and Show in Preview reveals the cursor's output.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import * as vscode from "vscode";

import { createProjectData, rootBuildFolder } from "@labshelf/core";
import { NodeLibraryFileSystem, deviceLocalLayout } from "@labshelf/core/node";
import { ReaderPanel } from "../../../src/pdf-viewer";
import { BuildPreviews, CheckCounts } from "../../../src/writing/preview";
import { registerShowInPreview } from "../../../src/writing/preview/commands/registerShowInPreview";
import { commandHandler, fakeHost, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/pdf-viewer", () => ({ ReaderPanel: { createOrShow: jest.fn() } }));

const create = ReaderPanel.createOrShow as jest.Mock;
type Project = Parameters<BuildPreviews["finished"]>[0];
type Finished = Parameters<BuildPreviews["finished"]>[2];
const succeeded = (dir: string): Finished => ({ status: "succeeded", pdf: path.join(dir, "main.pdf"), problems: [] });

// One page: a heading of main.tex line 3 and a line of chapter.tex (line `chapterLine`), as pdfTeX records them.
function synctex(dir: string, chapterLine = 1): string {
  return [
    "SyncTeX Version:1", `Input:1:${dir}/./main.tex`, `Input:2:${dir}/./chapter.tex`,
    "Output:pdf", "Magnification:1000", "Unit:1", "X Offset:0", "Y Offset:0", "Content:", "!100", "{1",
    "[1,5:4736286,46220574:26673152,41484288,0",
    "(1,5:8799518,8865054:22609920,655359,183500", "g1,3:8799518,8865054", "g1,3:10397871,8865054", ")",
    `(2,${chapterLine}:8799518,15475992:22609920,455111,127431`, `g2,${chapterLine}:8799518,15475992`, `g2,${chapterLine}:12622458,15475992`, ")",
    "]", "}1", "Postamble:", "Count:5", "",
  ].join("\n");
}

let dir: string;
let cache: string;
let previousCache: string | undefined;

function writeSynctex(text: string | null): void {
  const file = path.join(cache, "labshelf", "builds", path.basename(dir), rootBuildFolder("main.tex"), "main.synctex.gz");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (text === null) { fs.rmSync(file, { force: true }); } else { fs.writeFileSync(file, gzipSync(text)); }
}

function setup() {
  const host = fakeHost();
  const controller = { setBuildStatus: jest.fn(), reloadDocument: jest.fn(), revealPoint: jest.fn() };
  create.mockImplementation(() => ({ controller }));
  const previews = new BuildPreviews({ host, paths: path, data: createProjectData({ fs: new NodeLibraryFileSystem(), path, logger: host.session.logger, deviceDirs: deviceLocalLayout(dir) }), listPapers: async () => [], highlightsOf: async () => [], extensionUri: vscode.Uri.file("/ext"), locatePdfjs: () => null, isMac: false, buildRootOf: async (_folder: string, main: string) => main, recompile: async () => {}, projects: fakeProjects(), checkCounts: new CheckCounts(), setEngine: async () => {}, fixes: () => undefined });
  const project = readyEntry(dir) as Project;
  const ports = () => create.mock.calls[0][1].preview;
  return { host, controller, previews, project, ports };
}

const openedAt = () => {
  const [uri, options] = (vscode.window.showTextDocument as jest.Mock).mock.calls.at(-1)!;
  return { file: uri.fsPath, line: options.selection.start.line + 1, column: options.viewColumn };
};

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-sync-"));
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-sync-cache-"));
  previousCache = process.env["XDG_CACHE_HOME"];
  process.env["XDG_CACHE_HOME"] = cache;
  (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [{ viewColumn: 2 }];
});

afterEach(() => {
  if (previousCache === undefined) { delete process.env["XDG_CACHE_HOME"]; } else { process.env["XDG_CACHE_HOME"] = previousCache; }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(cache, { recursive: true, force: true });
});

describe("source from a preview double-click", () => {
  it("opens the file and line behind the point in an editor column, centred", async () => {
    writeSynctex(synctex(dir));
    const { previews, project, ports, host } = setup();
    previews.show(project, "main.tex", path.join(dir, "main.pdf"), { beside: false });
    await ports().showSource({ page: 1, x: 140, y: 234 });
    expect(openedAt()).toEqual({ file: path.join(dir, "chapter.tex"), line: 1, column: 2 });
    const editor = await (vscode.window.showTextDocument as jest.Mock).mock.results[0]!.value;
    expect(editor.revealRange).toHaveBeenCalledWith(expect.anything(), vscode.TextEditorRevealType.InCenter);
    await ports().showSource({ page: 1, x: 200, y: 131 });
    expect(openedAt()).toMatchObject({ file: path.join(dir, "main.tex"), line: 3 });
    expect(host.session.logger.log).toHaveBeenCalledWith("INFO", "writing/preview", "Opened source from the preview", expect.objectContaining({ line: 3, page: 1 }));
  });

  it("tells the user to build when there is no SyncTeX file, and logs it", async () => {
    const { previews, project, ports, host } = setup();
    previews.show(project, "main.tex", path.join(dir, "main.pdf"), { beside: false });
    await ports().showSource({ page: 1, x: 140, y: 234 });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Build the project to link the preview to the source.");
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(host.session.logger.log).toHaveBeenCalledWith("WARN", "writing/preview", "No SyncTeX data for the preview", expect.objectContaining({ page: 1, reason: "missing" }));
  });

  it("reports an unreadable SyncTeX file as an error and asks for a build", async () => {
    writeSynctex("not synctex");
    const { previews, project, ports, host } = setup();
    previews.show(project, "main.tex", path.join(dir, "main.pdf"), { beside: false });
    await ports().showSource({ page: 1, x: 1, y: 1 });
    expect(host.session.logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), { projectFolder: dir });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Build the project to link the preview to the source.");
  });

  it("says so when no source lies behind the point", async () => {
    writeSynctex(synctex(dir));
    const { previews, project, ports } = setup();
    previews.show(project, "main.tex", path.join(dir, "main.pdf"), { beside: false });
    await ports().showSource({ page: 9, x: 1, y: 1 });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("No source line found here.");
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it("keeps one read per build and picks up the next build's file, and does not keep a missing file", async () => {
    const { previews, project, ports } = setup();
    previews.show(project, "main.tex", path.join(dir, "main.pdf"), { beside: false });
    await ports().showSource({ page: 1, x: 140, y: 234 });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    writeSynctex(synctex(dir));
    await ports().showSource({ page: 1, x: 140, y: 234 });
    expect(openedAt().line).toBe(1);
    writeSynctex(synctex(dir, 7));
    await ports().showSource({ page: 1, x: 140, y: 234 });
    expect(openedAt().line).toBe(1);
    previews.finished(project, "main.tex", succeeded(dir), "save");
    await ports().showSource({ page: 1, x: 140, y: 234 });
    expect(openedAt().line).toBe(7);
  });

  it("names the file in a message when it cannot be opened", async () => {
    writeSynctex(synctex(dir));
    (vscode.window.showTextDocument as jest.Mock).mockRejectedValueOnce(new Error("gone"));
    const { previews, project, ports, host } = setup();
    previews.show(project, "main.tex", path.join(dir, "main.pdf"), { beside: false });
    await ports().showSource({ page: 1, x: 140, y: 234 });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Could not open chapter.tex.");
    expect(host.session.logger.error).toHaveBeenCalled();
  });
});

describe("Show in Preview command", () => {
  function register(cursorLine: number, file = "main.tex") {
    const ctx = setup();
    registerShowInPreview({ context: { subscriptions: [] } as never, projects: fakeProjects([ctx.project]), previews: ctx.previews });
    openInEditor(path.join(dir, file));
    (vscode.window.activeTextEditor as unknown as { selection: unknown }).selection = { active: { line: cursorLine } };
    return ctx;
  }

  beforeEach(() => fs.writeFileSync(path.join(dir, "main.pdf"), "%PDF"));

  it("opens the preview beside the editor and reveals the point of the cursor's line", async () => {
    writeSynctex(synctex(dir));
    const { controller } = register(2);
    await commandHandler("labshelf.writing.showInPreview")();
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ show: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } }));
    const point = controller.revealPoint.mock.calls[0][0];
    expect(point.page).toBe(1);
    expect(point.x).toBeCloseTo(133.77, 1);
    expect(point.y).toBeCloseTo(134.76, 1);
  });

  it("reveals a line of an \\input file through that file's path", async () => {
    writeSynctex(synctex(dir));
    const { controller } = register(0, "chapter.tex");
    await commandHandler("labshelf.writing.showInPreview")();
    expect(controller.revealPoint.mock.calls[0][0].y).toBeCloseTo(235.26, 1);
  });

  it("asks for a build when the project has none, and says when the file is not in the document", async () => {
    const built = register(2);
    await commandHandler("labshelf.writing.showInPreview")();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Build the project to link the preview to the source.");
    expect(built.controller.revealPoint).not.toHaveBeenCalled();

    writeSynctex(synctex(dir));
    jest.clearAllMocks();
    const other = register(0, "unused.tex");
    await commandHandler("labshelf.writing.showInPreview")();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("This file is not part of the built document.");
    expect(other.controller.revealPoint).not.toHaveBeenCalled();
  });

  it("runs the build command when the project has no built PDF", async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("FileNotFound"), { code: "FileNotFound" }));
    register(2);
    await commandHandler("labshelf.writing.showInPreview")();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("labshelf.writing.build");
    expect(create).not.toHaveBeenCalled();
  });
});
