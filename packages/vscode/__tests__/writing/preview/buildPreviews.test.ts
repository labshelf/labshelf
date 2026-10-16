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
  const controller = { setBuildStatus: jest.fn(), reloadDocument: jest.fn(), setPreviewRoots: jest.fn(), showLogs: jest.fn() };
  let closed: (() => void) | undefined;
  const panel = { controller, showDocument: jest.fn(), reveal: jest.fn(), dispose: jest.fn(() => closed?.()) };
  create.mockImplementation((_deps, source) => { closed = source.onClosed; return panel; });
  const previews = new BuildPreviews({ host, paths: path, data: fakeProjectData(), listPapers: async () => [], extensionUri: vscode.Uri.file("/ext"), locatePdfjs: () => null, isMac: false, buildRootOf: async (_folder: string, main: string) => main, recompile: async () => {} });
  return { previews, controller, host, panel, close: () => closed?.() };
}

beforeEach(() => jest.clearAllMocks());

describe("BuildPreviews", () => {
  it("reloads an open preview and reports success", () => {
    const { previews, controller } = setup();
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
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
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
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
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    previews.finished(project, "main.tex", failed, "save");
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2);
    expect(controller.reloadDocument).not.toHaveBeenCalled();
  });

  it("shows the last failed or running build in a preview opened afterwards, and nothing after a success", () => {
    const { previews, controller } = setup();
    previews.finished(project, "main.tex", failed, "save");
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2);
    previews.building("/p/paper", "main.tex");
    previews.finished(project, "main.tex", succeeded, "save");
    controller.setBuildStatus.mockClear();
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    expect(controller.setBuildStatus).not.toHaveBeenCalled();
  });

  it("keeps the problems of each root: a root's success does not erase another root's failure", async () => {
    const { previews, controller, host } = setup();
    const chapterFailure: Finished = { status: "failed", problems: [{ severity: "error", message: "in b", file: "/p/paper/b/main.tex", line: 4 }] };
    previews.finished(project, "main.tex", failed, "save");
    previews.finished(project, "b/main.tex", chapterFailure, "save");
    previews.finished(project, "b/main.tex", succeeded, "save");
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2);
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [{ viewColumn: 1 }];
    await create.mock.calls[0][1].preview.openProblem("main.tex", 1);
    expect((vscode.window.showTextDocument as jest.Mock).mock.calls[0][0].fsPath).toBe("/p/paper/main.tex");
    expect(host.session.logger.log).not.toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.anything());
  });

});

describe("BuildPreviews with several roots", () => {
  const chapterPdf = "/p/paper/b/main.pdf";
  const chapterFailure: Finished = { status: "failed", problems: [{ severity: "error", message: "in b", file: "/p/paper/b/main.tex", line: 4 }] };
  const chapterSucceeded: Finished = { status: "succeeded", pdf: chapterPdf, problems: [] };

  it("shows another root's PDF in the open panel instead of opening a second one", () => {
    const { previews, panel, controller } = setup();
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    previews.show(project, "b/main.tex", chapterPdf, { beside: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(panel.showDocument).toHaveBeenCalledWith(expect.objectContaining({ fsPath: chapterPdf }), "main.pdf");
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("succeeded", 0);
  });

  it("switches the open panel to a root whose build was started by focus", () => {
    const { previews, panel } = setup();
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    previews.finished(project, "b/main.tex", chapterSucceeded, "save");
    expect(panel.showDocument).not.toHaveBeenCalled();
    previews.finished(project, "b/main.tex", chapterSucceeded, "focus");
    expect(panel.showDocument).toHaveBeenCalledWith(expect.objectContaining({ fsPath: chapterPdf }), "main.pdf");
  });

  it("replays the shown root's failed build when switching to it", () => {
    const { previews, controller } = setup();
    previews.finished(project, "b/main.tex", chapterFailure, "save");
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    previews.show(project, "b/main.tex", chapterPdf, { beside: false });
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 1);
  });

  it("reloads on a build of the shown root only", () => {
    const { previews, controller } = setup();
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    previews.show(project, "b/main.tex", chapterPdf, { beside: false });
    previews.finished(project, "main.tex", succeeded, "save");
    expect(controller.reloadDocument).not.toHaveBeenCalled();
    previews.finished(project, "b/main.tex", chapterSucceeded, "save");
    expect(controller.reloadDocument).toHaveBeenCalledTimes(1);
  });

  it("opens the panel on a built root after the Build command when none is open", () => {
    const { previews } = setup();
    previews.finished(project, "b/main.tex", chapterSucceeded, "command");
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pdfUri: expect.objectContaining({ fsPath: chapterPdf }) }));
  });

  it("closes a project's panel by folder", () => {
    const { previews, panel } = setup();
    previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
    previews.close("/p/paper");
    expect(panel.dispose).toHaveBeenCalledTimes(1);
    expect(previews.hasPreview("/p/paper")).toBe(false);
    previews.close("/p/paper");
    expect(panel.dispose).toHaveBeenCalledTimes(1);
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
    expect(previews.show).toHaveBeenCalledWith(expect.objectContaining({ folder: dir }), "chapters/main.tex", path.join(dir, "chapters/main.pdf"), { beside: false });
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
