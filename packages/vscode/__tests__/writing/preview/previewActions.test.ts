// Tests the writing actions a preview reader asks of VS Code: recompile, show the cursor, open a problem, open the raw log.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import * as vscode from "vscode";

import { CheckCounts, createProjectContent, deriveBuildRootFolder } from "@labshelf/core";
import { NodeLibraryFileSystem, createDeviceLocalLayout } from "@labshelf/core/node";
import { ReaderPanel } from "../../../src/reader";
import { BuildPreviews } from "../../../src/writing/preview";
import { fakeHost, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/reader", () => ({ ReaderPanel: { createOrShow: jest.fn() } }));

const create = ReaderPanel.createOrShow as jest.Mock;
type Project = Parameters<BuildPreviews["finished"]>[0];
type Finished = Parameters<BuildPreviews["finished"]>[2];

let dir: string;
let cache: string;
let previousCache: string | undefined;
const failedWith = (...problems: Array<{ file?: string; line?: number }>): Finished => ({
  status: "failed",
  problems: problems.map((problem) => ({ severity: "error" as const, message: "boom", ...problem, file: problem.file ? path.join(dir, problem.file) : undefined })),
} as never);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const opened = () => (vscode.window.showTextDocument as jest.Mock).mock.calls.map(([uri, options]) => ({ file: uri.fsPath, line: options.selection.start.line + 1 }));

function setup(type: "latex" | "typst" = "latex") {
  const host = fakeHost();
  const controller = { setBuildStatus: jest.fn(), reloadDocument: jest.fn(), setPreviewRoots: jest.fn(), showLogs: jest.fn(), revealPoint: jest.fn() };
  create.mockImplementation(() => ({ controller, showDocument: jest.fn(), reveal: jest.fn(), dispose: jest.fn() }));
  const recompile = jest.fn(async () => {});
  const project = (type === "latex" ? readyEntry(dir) : readyEntry(dir, { main: "main.typ", settings: { id: path.basename(dir), format: "typst" } })) as Project;
  const previews = new BuildPreviews({
    host, paths: path, uriOf: (target: string) => vscode.Uri.file(target), data: createProjectContent({ fs: new NodeLibraryFileSystem(), path, logger: host.session.logger, deviceDirs: createDeviceLocalLayout(dir) }), listPapers: async () => [], extensionUri: vscode.Uri.file("/ext"), locatePdfjs: () => null, isMac: false,
    buildRootOf: async (_folder: string, main: string) => main, recompile,
    projects: fakeProjects(), checkCounts: new CheckCounts(),
  } as never);
  const main = project.main!;
  previews.show(project, main, path.join(dir, main.replace(/\.\w+$/, ".pdf")), { beside: false });
  return { host, controller, recompile, previews, project, ports: () => create.mock.calls[0][1].preview };
}

function writeLog(root: string): string {
  const file = path.join(cache, "labshelf", "builds", path.basename(dir), deriveBuildRootFolder(root), `${path.basename(root).replace(/\.\w+$/, "")}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "log");
  return file;
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-actions-"));
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-actions-cache-"));
  previousCache = process.env["XDG_CACHE_HOME"];
  process.env["XDG_CACHE_HOME"] = cache;
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
    if (!fs.existsSync(uri.fsPath) && /\.log$/.test(uri.fsPath)) { throw Object.assign(new Error("FileNotFound"), { code: "FileNotFound" }); }
    return { type: 1, ctime: 0, mtime: 0, size: 0 };
  });
  (vscode.window as unknown as { activeTextEditor: unknown; visibleTextEditors: unknown[] }).activeTextEditor = undefined;
  (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [{ viewColumn: 1 }];
});

afterEach(() => {
  if (previousCache === undefined) { delete process.env["XDG_CACHE_HOME"]; } else { process.env["XDG_CACHE_HOME"] = previousCache; }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(cache, { recursive: true, force: true });
});

describe("recompile", () => {
  it("builds the shown root of the project once", async () => {
    const { previews, project, ports, recompile } = setup();
    previews.show(project, "b/main.tex", path.join(dir, "b/main.pdf"), { beside: false });
    await ports().recompile();
    expect(recompile).toHaveBeenCalledTimes(1);
    expect(recompile).toHaveBeenCalledWith(dir, "b/main.tex");
  });
});

describe("revealCursor", () => {
  function writeSynctex(): void {
    const text = [
      "SyncTeX Version:1", `Input:1:${dir}/./main.tex`, "Output:pdf", "Magnification:1000", "Unit:1", "X Offset:0", "Y Offset:0", "Content:", "!100", "{1",
      "[1,5:4736286,46220574:26673152,41484288,0", "(1,5:8799518,8865054:22609920,655359,183500", "g1,3:8799518,8865054", "g1,3:10397871,8865054", ")",
      "]", "}1", "Postamble:", "Count:5", "",
    ].join("\n");
    const file = path.join(cache, "labshelf", "builds", path.basename(dir), deriveBuildRootFolder("main.tex"), "main.synctex.gz");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, gzipSync(text));
  }

  it("reveals the point of the active project editor's cursor line in the preview", async () => {
    writeSynctex();
    const { ports, controller } = setup();
    openInEditor(path.join(dir, "main.tex"));
    (vscode.window.activeTextEditor as unknown as { selection: unknown }).selection = { active: { line: 2 } };
    await ports().revealCursor();
    const point = controller.revealPoint.mock.calls[0][0];
    expect(point.page).toBe(1);
    expect(point.y).toBeCloseTo(134.76, 1);
  });

  it("says so when no project editor is active, without throwing", async () => {
    const { ports, controller } = setup();
    await expect(ports().revealCursor()).resolves.toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(controller.revealPoint).not.toHaveBeenCalled();
    openInEditor("/elsewhere/other.tex");
    await expect(ports().revealCursor()).resolves.toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
    expect(controller.revealPoint).not.toHaveBeenCalled();
  });
});

describe("openProblem", () => {
  it("opens the problem's file at its line", async () => {
    const { previews, project, ports } = setup();
    previews.finished(project, "main.tex", failedWith({ file: "a.tex", line: 3 }, { file: "chapters/b.tex", line: 9 }), "save");
    await flush();
    await ports().openProblem("main.tex", 1);
    expect(opened()).toEqual([{ file: path.join(dir, "chapters/b.tex"), line: 9 }]);
  });

  it.each([
    ["an unknown root", "other.tex", 0],
    ["an index past the problems", "main.tex", 5],
    ["a negative index", "main.tex", -1],
    ["a problem without a file", "main.tex", 1],
  ])("logs a warning and opens nothing for %s", async (_name, root, index) => {
    const { previews, project, ports, host } = setup();
    previews.finished(project, "main.tex", failedWith({ file: "a.tex", line: 3 }, {}), "save");
    await flush();
    await ports().openProblem(root, index);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(host.session.logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.anything());
  });
});

describe("openRawLog", () => {
  it("opens the root's .log from its build folder in an editor", async () => {
    const log = writeLog("b/main.tex");
    const { previews, project, ports } = setup();
    previews.finished(project, "b/main.tex", failedWith({ file: "b/main.tex", line: 1 }), "save");
    await flush();
    await ports().openRawLog("b/main.tex");
    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
    expect((vscode.window.showTextDocument as jest.Mock).mock.calls[0][0].fsPath).toBe(log);
  });

  it("shows a message when the log file is missing", async () => {
    const { previews, project, ports } = setup();
    previews.finished(project, "main.tex", failedWith({ file: "main.tex", line: 1 }), "save");
    await flush();
    await ports().openRawLog("main.tex");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it("shows a message for a Typst root", async () => {
    writeLog("main.typ");
    const { previews, project, ports } = setup("typst");
    previews.finished(project, "main.typ", { status: "failed", problems: [] } as Finished, "save");
    await flush();
    await ports().openRawLog("main.typ");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it("logs a warning for a root it never reported", async () => {
    const { ports, host } = setup();
    await ports().openRawLog("nowhere/main.tex");
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(host.session.logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.anything());
  });
});

describe("a file that fails to open", () => {
  it("logs the problem's root and index and shows an error, without rejecting", async () => {
    const { previews, project, ports, host } = setup();
    previews.finished(project, "main.tex", failedWith({ file: "a.tex", line: 3 }), "save");
    await flush();
    (vscode.window.showTextDocument as jest.Mock).mockRejectedValueOnce(new Error("cannot open"));
    await expect(ports().openProblem("main.tex", 0)).resolves.toBeUndefined();
    expect(host.session.logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ root: "main.tex", index: 0, file: path.join(dir, "a.tex") }));
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Could not open a.tex.");
  });

  it("logs the raw log's root and path and shows an error, without rejecting", async () => {
    const log = writeLog("main.tex");
    const { previews, project, ports, host } = setup();
    previews.finished(project, "main.tex", failedWith({ file: "main.tex", line: 1 }), "save");
    await flush();
    (vscode.window.showTextDocument as jest.Mock).mockRejectedValueOnce(new Error("cannot open"));
    await expect(ports().openRawLog("main.tex")).resolves.toBeUndefined();
    expect(host.session.logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ root: "main.tex", file: log }));
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Could not open main.log.");
  });
});
