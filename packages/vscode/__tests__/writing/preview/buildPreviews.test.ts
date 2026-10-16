// Tests the preview registry: reload or open after a build, failure counts, the banner jump to the first error and Show Preview. SyncTeX links are in synctexLinks.test.ts.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { ReaderPanel } from "../../../src/pdf-viewer";
import { BuildPreviews } from "../../../src/writing/preview";
import { registerShowPreview } from "../../../src/writing/preview/registerShowPreview";
import { commandHandler, fakeHost, fakeProjectData, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/pdf-viewer", () => ({ ReaderPanel: { createOrShow: jest.fn() } }));

const create = ReaderPanel.createOrShow as jest.Mock;
const project = readyEntry("/p/paper") as Parameters<BuildPreviews["finished"]>[0];
type Finished = Parameters<BuildPreviews["finished"]>[2];
const failed: Extract<Finished, { status: "failed" }> = { status: "failed", problems: [
  { severity: "warning", message: "w", file: "/p/paper/w.tex", line: 1 },
  { severity: "error", message: "e1", file: "/p/paper/main.tex", line: 7 },
  { severity: "error", message: "e2", file: "/p/paper/other.tex" },
] };
const succeeded: Finished = { status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] };

function setup() {
  const host = fakeHost();
  const controller = { setBuildStatus: jest.fn(), reloadDocument: jest.fn() };
  let closed: (() => void) | undefined;
  create.mockImplementation((_deps, source) => { closed = source.onClosed; return { controller }; });
  const previews = new BuildPreviews({ host, paths: path, data: fakeProjectData(), listPapers: async () => [], extensionUri: vscode.Uri.file("/ext"), locatePdfjs: () => null, isMac: false });
  return { previews, controller, host, close: () => closed?.() };
}

beforeEach(() => jest.clearAllMocks());

describe("BuildPreviews", () => {
  it("reloads an open preview and reports success", () => {
    const { previews, controller } = setup();
    previews.show(project, "/p/paper/main.pdf", { beside: false });
    previews.building("/p/paper", "main.tex");
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("building");
    previews.finished(project, "main.tex", succeeded, "save");
    expect(controller.reloadDocument).toHaveBeenCalledTimes(1);
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("succeeded");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("opens no preview after a save and none after the panel closed", () => {
    const { previews, close } = setup();
    previews.finished(project, "main.tex", succeeded, "save");
    expect(create).not.toHaveBeenCalled();
    previews.show(project, "/p/paper/main.pdf", { beside: false });
    close();
    previews.finished(project, "main.tex", succeeded, "save");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("opens a preview beside the editor without taking focus after the Build command", () => {
    const { previews } = setup();
    previews.finished(project, "main.tex", succeeded, "command");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ logger: expect.anything() }), expect.objectContaining({
      key: "preview:/p/paper",
      show: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      pdfUri: expect.objectContaining({ fsPath: "/p/paper/main.pdf" }),
      paper: expect.objectContaining({ id: "preview:paper", title: "main.pdf", path: "/p/paper" }),
    }));
  });

  it("reports a failed build with its error count and keeps the document", () => {
    const { previews, controller } = setup();
    previews.show(project, "/p/paper/main.pdf", { beside: false });
    previews.finished(project, "main.tex", failed, "save");
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2);
    expect(controller.reloadDocument).not.toHaveBeenCalled();
  });

  it("shows the last failed or running build in a preview opened afterwards, and nothing after a success", () => {
    const { previews, controller } = setup();
    previews.finished(project, "main.tex", failed, "save");
    previews.show(project, "/p/paper/main.pdf", { beside: false });
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2);
    previews.building("/p/paper", "main.tex");
    previews.finished(project, "main.tex", succeeded, "save");
    controller.setBuildStatus.mockClear();
    previews.show(project, "/p/paper/main.pdf", { beside: false });
    expect(controller.setBuildStatus).not.toHaveBeenCalled();
  });

  it("opens the first error's file at its 0-based line in an editor column, and line 1 without a line", async () => {
    const { previews, host } = setup();
    previews.finished(project, "main.tex", failed, "save");
    previews.show(project, "/p/paper/main.pdf", { beside: false });
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [{ viewColumn: 1 }];
    const ports = create.mock.calls[0][1].preview;
    await ports.showBuildProblem();
    const [uri, options] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
    expect(uri.fsPath).toBe("/p/paper/main.tex");
    expect(options.selection.start.line).toBe(6);
    expect(options.viewColumn).toBe(1);

    previews.finished(project, "main.tex", { status: "failed", problems: [failed.problems[2]!] }, "save");
    await ports.showBuildProblem();
    expect((vscode.window.showTextDocument as jest.Mock).mock.calls[1][1].selection.start.line).toBe(0);
    expect(host.session.logger.log).toHaveBeenCalledWith("INFO", "writing/preview", "Opened build problem", expect.anything());
  });

  it("keeps the problems of each root: a root's success does not erase another root's failure", async () => {
    const { previews, controller, host } = setup();
    const chapterFailure: Finished = { status: "failed", problems: [{ severity: "error", message: "in b", file: "/p/paper/b/main.tex", line: 4 }] };
    previews.finished(project, "main.tex", failed, "save");
    previews.finished(project, "b/main.tex", chapterFailure, "save");
    previews.finished(project, "b/main.tex", succeeded, "save");
    previews.show(project, "/p/paper/main.pdf", { beside: false });
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2);
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [{ viewColumn: 1 }];
    await create.mock.calls[0][1].preview.showBuildProblem();
    expect((vscode.window.showTextDocument as jest.Mock).mock.calls[0][0].fsPath).toBe("/p/paper/main.tex");
    expect(host.session.logger.log).not.toHaveBeenCalledWith("WARN", "writing/preview", "Build banner clicked without a stored problem", expect.anything());
  });

  it("logs a warning when the banner is clicked with no stored problem", async () => {
    const { previews, host } = setup();
    previews.show(project, "/p/paper/main.pdf", { beside: false });
    await create.mock.calls[0][1].preview.showBuildProblem();
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(host.session.logger.log).toHaveBeenCalledWith("WARN", "writing/preview", "Build banner clicked without a stored problem", expect.anything());
  });
});

describe("Show Preview command", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-preview-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function register(entries = [readyEntry(dir, { main: "chapters/main.tex" })]) {
    const previews = { show: jest.fn() };
    registerShowPreview({ context: { subscriptions: [] } as never, projects: fakeProjects(entries), previews });
    openInEditor(path.join(dir, "chapters/intro.tex"));
    return previews;
  }

  it("opens the built PDF next to the main file", async () => {
    fs.mkdirSync(path.join(dir, "chapters"));
    fs.writeFileSync(path.join(dir, "chapters/main.pdf"), "%PDF");
    const previews = register();
    await commandHandler("labshelf.writing.showPreview")();
    expect(previews.show).toHaveBeenCalledWith(expect.objectContaining({ folder: dir }), path.join(dir, "chapters/main.pdf"), { beside: false });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it("runs the build command when the PDF does not exist", async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("FileNotFound"), { code: "FileNotFound" }));
    const previews = register();
    await commandHandler("labshelf.writing.showPreview")();
    expect(previews.show).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("labshelf.writing.build");
  });
});
