// Tests the preview panel: the registry (reload or open after a build, failure counts, banner jump, Show Preview), the focus follower and which PDF a project shows. SyncTeX links are in synctex.test.ts.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { CheckCounts, deriveBuildRootFolder } from "@labshelf/core";
import { ReaderPanel } from "../../../src/reader";
import { BuildPreviews } from "../../../src/writing/preview";
import { FocusFollower, readBuiltPdf, registerShowPreview } from "../../../src/writing/preview/panel";
import { commandHandler, fakeHost, fakeProjectData, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

import type { ReadyProject } from "../../../src/writing/projects/index";

jest.mock("../../../src/reader", () => ({ ReaderPanel: { createOrShow: jest.fn() } }));

describe("preview registry", () => {
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
    const counts = new CheckCounts();
    const previews = new BuildPreviews({ projects: fakeProjects([project]), checkCounts: counts, host, paths: path, uriOf: (target: string) => vscode.Uri.file(target), data: fakeProjectData(), listPapers: async () => [], highlightsOf: async () => [], extensionUri: vscode.Uri.file("/ext"), locatePdfjs: () => null, isMac: false, buildRootOf: async (_folder: string, main: string) => main, recompile: async () => {}, setEngine: async () => {}, fixes: () => undefined });
    return { previews, controller, host, panel, counts, close: () => closed?.() };
  }

  beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, "now").mockReturnValue(5000); });
  afterEach(() => jest.restoreAllMocks());

  describe("BuildPreviews", () => {
    it("reloads an open preview and reports success", () => {
      const { previews, controller } = setup();
      previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
      previews.building("/p/paper", "main.tex");
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("building", 0, {});
      previews.finished(project, "main.tex", succeeded, "save");
      expect(controller.reloadDocument).toHaveBeenCalledTimes(1);
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("succeeded", 0, { stale: false, builtAt: 5000 });
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
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2, {});
      expect(controller.reloadDocument).not.toHaveBeenCalled();
    });

    it("shows the last failed or running build in a preview opened afterwards, and nothing after a success", () => {
      const { previews, controller } = setup();
      previews.finished(project, "main.tex", failed, "save");
      previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2, {});
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
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2, {});
      (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [{ viewColumn: 1 }];
      await create.mock.calls[0][1].preview.openProblem("main.tex", 1);
      expect((vscode.window.showTextDocument as jest.Mock).mock.calls[0][0].fsPath).toBe("/p/paper/main.tex");
      expect(host.session.logger.log).not.toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.anything());
    });

  });

  describe("BuildPreviews roots", () => {
    it("sends the roots again with the finding count when a check records one", async () => {
      const { previews, controller, counts } = setup();
      previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
      await new Promise((resolve) => setImmediate(resolve));
      const before = controller.setPreviewRoots.mock.calls.length;
      counts.record("/p/paper", 3);
      await new Promise((resolve) => setImmediate(resolve));
      expect(controller.setPreviewRoots).toHaveBeenCalledTimes(before + 1);
      expect(controller.setPreviewRoots.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ checks: 3 }));
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
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("succeeded", 0, {});
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
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 1, {});
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

  describe("BuildPreviews staleness", () => {
    const edit = (file: string) => (vscode.workspace as unknown as { _fireTextDocumentChange(event: unknown): void })
      ._fireTextDocumentChange({ document: { uri: { scheme: "file", fsPath: file } }, contentChanges: [{}] });

    it("sends when the shown root was built and that it is stale after a source edit", () => {
      const { previews, controller } = setup();
      previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
      previews.building("/p/paper", "main.tex");
      previews.finished(project, "main.tex", succeeded, "save");
      controller.setBuildStatus.mockClear();
      edit("/p/paper/main.tex");
      edit("/p/paper/main.tex");
      expect(controller.setBuildStatus).toHaveBeenCalledTimes(1);
      expect(controller.setBuildStatus).toHaveBeenCalledWith("succeeded", 0, { stale: true, builtAt: 5000 });
      previews.dispose();
    });

    it("does not resend for a root the preview does not show or for an edit without content changes", () => {
      const { previews, controller } = setup();
      previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
      previews.building("/p/paper", "b/main.tex");
      previews.finished(project, "b/main.tex", succeeded, "save");
      controller.setBuildStatus.mockClear();
      edit("/p/paper/b/main.tex");
      expect(controller.setBuildStatus).not.toHaveBeenCalled();
      (vscode.workspace as unknown as { _fireTextDocumentChange(event: unknown): void })
        ._fireTextDocumentChange({ document: { uri: { scheme: "file", fsPath: "/p/paper/main.tex" } }, contentChanges: [] });
      expect(controller.setBuildStatus).not.toHaveBeenCalled();
      previews.dispose();
    });

    it("keeps the stale mark on the status shown while a rebuild runs and replays it when the preview reopens", () => {
      const { previews, controller, close } = setup();
      previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
      previews.building("/p/paper", "main.tex");
      previews.finished(project, "main.tex", succeeded, "save");
      edit("/p/paper/main.tex");
      previews.building("/p/paper", "main.tex");
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("building", 0, { stale: true, builtAt: 5000 });
      previews.finished(project, "main.tex", failed, "save");
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2, { stale: true, builtAt: 5000 });
      close();
      previews.show(project, "main.tex", "/p/paper/main.pdf", { beside: false });
      expect(controller.setBuildStatus).toHaveBeenLastCalledWith("failed", 2, { stale: true, builtAt: 5000 });
      previews.dispose();
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
});

describe("focus follower", () => {
  const paper = readyEntry("/p/paper") as ReadyProject;
  const other = readyEntry("/p/other") as ReadyProject;

  function setup(opts: { open: ReadyProject | undefined; pdfs: string[]; roots: Record<string, string> }) {
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: { fsPath: string }) => {
      if (!opts.pdfs.includes(uri.fsPath)) { throw Object.assign(new Error("FileNotFound"), { code: "FileNotFound" }); }
      return {};
    });
    const request = jest.fn(async () => {});
    const show = jest.fn();
    const buildRootOf = jest.fn(async (_folder: string, _main: string, file: string) => opts.roots[file] ?? "main.tex");
    const follower = new FocusFollower({
      session: { project: opts.open },
      projects: fakeProjects([paper, other]),
      buildRootOf,
      builders: { latex: { request }, typst: { request: jest.fn() } },
      previews: { show },
      host: fakeHost(),
    });
    return { follower, request, show };
  }

  beforeEach(() => jest.clearAllMocks());

  describe("FocusFollower", () => {
    it("shows the PDF of a focused file that is its own root, without building", async () => {
      const { follower, show, request } = setup({ open: paper, pdfs: ["/p/paper/b/main.pdf"], roots: { "/p/paper/b/main.tex": "b/main.tex" } });
      await follower.follow("/p/paper/b/main.tex");
      expect(show).toHaveBeenCalledWith(paper, "b/main.tex", "/p/paper/b/main.pdf", { beside: true });
      expect(request).not.toHaveBeenCalled();
    });

    it("shows the main PDF for an included chapter", async () => {
      const { follower, show, request } = setup({ open: paper, pdfs: ["/p/paper/main.pdf"], roots: {} });
      await follower.follow("/p/paper/chapters/intro.tex");
      expect(show).toHaveBeenCalledWith(paper, "main.tex", "/p/paper/main.pdf", { beside: true });
      expect(request).not.toHaveBeenCalled();
    });

    it("ignores files of no project, of another project, and any file when no project is open", async () => {
      const a = setup({ open: paper, pdfs: ["/p/paper/main.pdf", "/p/other/main.pdf"], roots: {} });
      await a.follower.follow("/elsewhere/x.tex");
      await a.follower.follow("/p/other/main.tex");
      const b = setup({ open: undefined, pdfs: ["/p/paper/main.pdf"], roots: {} });
      await b.follower.follow("/p/paper/main.tex");
      for (const { show, request } of [a, b]) {
        expect(show).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
      }
    });

    it("shows the main PDF and requests a focus build when the focused root is not built", async () => {
      const { follower, show, request } = setup({ open: paper, pdfs: ["/p/paper/main.pdf"], roots: { "/p/paper/b/main.tex": "b/main.tex" } });
      await follower.follow("/p/paper/b/main.tex");
      expect(show).toHaveBeenCalledWith(paper, "main.tex", "/p/paper/main.pdf", { beside: true });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith("/p/paper", "b/main.tex", "focus");
    });

    it("builds without showing when neither the root nor main has a PDF", async () => {
      const { follower, show, request } = setup({ open: paper, pdfs: [], roots: { "/p/paper/b/main.tex": "b/main.tex" } });
      await follower.follow("/p/paper/b/main.tex");
      expect(show).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledWith("/p/paper", "b/main.tex", "focus");
    });

    it("does not build when focus switches between roots that both have a PDF", async () => {
      const { follower, show, request } = setup({
        open: paper, pdfs: ["/p/paper/main.pdf", "/p/paper/b/main.pdf"], roots: { "/p/paper/b/main.tex": "b/main.tex" },
      });
      await follower.follow("/p/paper/main.tex");
      await follower.follow("/p/paper/b/main.tex");
      expect(show).toHaveBeenCalledTimes(2);
      expect(show).toHaveBeenLastCalledWith(paper, "b/main.tex", "/p/paper/b/main.pdf", { beside: true });
      expect(request).not.toHaveBeenCalled();
    });

    it("follows the active editor and ignores an editor that is not a file", async () => {
      const { show } = setup({ open: paper, pdfs: ["/p/paper/main.pdf"], roots: {} });
      const w = vscode.window as unknown as { activeTextEditor: unknown; _fireActiveEditorChange(): void };
      w.activeTextEditor = undefined;
      w._fireActiveEditorChange();
      await new Promise((r) => setImmediate(r));
      expect(show).not.toHaveBeenCalled();
      w.activeTextEditor = { document: { uri: vscode.Uri.file("/p/paper/main.tex") } };
      w._fireActiveEditorChange();
      await new Promise((r) => setImmediate(r));
      expect(show).toHaveBeenCalledTimes(1);
      w.activeTextEditor = undefined;
    });
  });
});

describe("built PDF", () => {
  type Project = Parameters<typeof readBuiltPdf>[1];
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

  describe("readBuiltPdf", () => {
    it("returns the Typst preview PDF from the build folder, not the one next to main", async () => {
      const preview = path.join(cache, "paper", deriveBuildRootFolder("doc/main.typ"), "main.pdf");
      existing(preview, path.join(dir, "doc", "main.pdf"));
      expect(await readBuiltPdf(projects, typst(), "doc/main.typ")).toBe(preview);
    });

    it("returns undefined for a Typst project whose preview was not compiled, even with a saved PDF next to main", async () => {
      existing(path.join(dir, "doc", "main.pdf"));
      expect(await readBuiltPdf(projects, typst(), "doc/main.typ")).toBeUndefined();
    });

    it("returns the PDF next to the main file of a LaTeX project, or undefined when it is missing", async () => {
      const latex = readyEntry(dir, { main: "doc/main.tex" }) as Project;
      existing();
      expect(await readBuiltPdf(projects, latex, "doc/main.tex")).toBeUndefined();
      const pdf = path.join(dir, "doc", "main.pdf");
      existing(pdf);
      expect(await readBuiltPdf(projects, latex, "doc/main.tex")).toBe(pdf);
      expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: pdf }));
    });

    it("returns undefined when the file system fails for another reason", async () => {
      stat.mockRejectedValue(new Error("EACCES"));
      expect(await readBuiltPdf(projects, readyEntry(dir, { main: "doc/main.tex" }) as Project, undefined)).toBeUndefined();
    });

    it("returns undefined without a project or a main file", async () => {
      expect(await readBuiltPdf(projects, undefined, "doc/main.typ")).toBeUndefined();
      expect(await readBuiltPdf(projects, typst({ main: undefined }), undefined)).toBeUndefined();
    });
  });
});
