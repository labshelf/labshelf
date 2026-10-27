// Tests what starts a build by itself: opening a project, typing, saving and the LaTeX Workshop notice.
import * as path from "node:path";
import * as vscode from "vscode";

import { buildRootOf, type ProjectEntry } from "@labshelf/core";
import { registerLatexOpenBuild, registerLatexTypingWrites, registerLatexWorkshopNotice, registerLatexWriteBuilds } from "../../../src/writing/build/autoBuild";
import { fakeHost, fakeLogger, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), buildRootOf: jest.fn() }));

// Tests the build on open: the LaTeX project open as a workspace folder builds its main file once, while auto compile is on.
describe("registerLatexOpenBuild", () => {
  const workspace = vscode.workspace as unknown as {
    workspaceFolders: { uri: vscode.Uri }[] | undefined;
    _config: Record<string, Record<string, unknown>>;
  };

  let context: { subscriptions: { dispose(): void }[] };

  function setup(entries: ProjectEntry[]) {
    let list = entries;
    const listeners: (() => void)[] = [];
    const projects = {
      list: () => list,
      onDidChange: (listener: () => void) => { listeners.push(listener); return { dispose: () => undefined }; },
    };
    const request = jest.fn(async () => undefined);
    context = { subscriptions: [] };
    const host = fakeHost();
    return {
      request, host,
      register: () => registerLatexOpenBuild({ context, host, projects, request }),
      load: (next: ProjectEntry[]) => { list = next; listeners.forEach((listener) => listener()); },
    };
  }

  beforeEach(() => {
    delete workspace._config["labshelf.writing"];
    workspace.workspaceFolders = [{ uri: vscode.Uri.file("/library/projects/paper") }];
  });

  afterEach(() => {
    context.subscriptions.forEach((subscription) => subscription.dispose());
    workspace.workspaceFolders = undefined;
  });

  describe("registerLatexOpenBuild", () => {
    it("builds the open project's main file once the projects load, and only once", async () => {
      const { request, register, load } = setup([]);
      register();
      expect(request).not.toHaveBeenCalled();
      load([readyEntry("/library/projects/paper"), readyEntry("/library/projects/other")]);
      load([readyEntry("/library/projects/paper")]);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith("/library/projects/paper", "main.tex");
    });

    it("builds at once when the projects are already loaded", () => {
      const { request, register } = setup([readyEntry("/library/projects/paper")]);
      register();
      expect(request).toHaveBeenCalledWith("/library/projects/paper", "main.tex");
    });

    it("does not build Typst projects, projects without a main file or projects that are not open", () => {
      const { request, register, load } = setup([]);
      register();
      load([readyEntry("/library/projects/paper", { main: "main.typ", settings: { id: "paper", format: "typst" } })]);
      load([readyEntry("/library/projects/paper", { main: undefined })]);
      load([readyEntry("/library/projects/other")]);
      expect(request).not.toHaveBeenCalled();
    });

    it("does not build while auto compile is off, and logs why", () => {
      workspace._config["labshelf.writing"] = { autoCompile: "off" };
      const { request, register, host } = setup([readyEntry("/library/projects/paper")]);
      register();
      expect(request).not.toHaveBeenCalled();
      expect(host.session.logger.log).toHaveBeenCalledTimes(1);
    });
  });
});

// Tests that typing in a LaTeX source saves it after a pause, only in typing mode.
describe("registerLatexTypingWrites", () => {
  const workspace = vscode.workspace as unknown as {
    _fireTextDocumentChange: (event: unknown) => void;
    _config: Record<string, Record<string, unknown>>;
  };
  let context: { subscriptions: { dispose(): void }[] };

  function doc(fsPath: string, save = jest.fn(async () => true), isDirty = true) {
    return { uri: Object.assign(vscode.Uri.file(fsPath), { scheme: "file" }), isDirty, save };
  }
  const type = (document: unknown, contentChanges: unknown[] = [{}]) => workspace._fireTextDocumentChange({ document, contentChanges });

  function setup(host = fakeHost()) {
    const projects = fakeProjects([readyEntry("/p/tex", { main: "main.tex" }), readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } })]);
    context = { subscriptions: [] };
    registerLatexTypingWrites({ context, host, projects: projects as never });
  }

  beforeEach(() => {
    delete workspace._config["labshelf.writing"];
    jest.useFakeTimers();
  });

  afterEach(() => {
    context.subscriptions.forEach((subscription) => subscription.dispose());
    jest.useRealTimers();
  });

  describe("registerLatexTypingWrites", () => {
    it("saves once, 300 ms after the last keystroke of a burst", async () => {
      setup();
      const document = doc("/p/tex/main.tex");
      type(document);
      await jest.advanceTimersByTimeAsync(200);
      type(document);
      await jest.advanceTimersByTimeAsync(299);
      expect(document.save).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(document.save).toHaveBeenCalledTimes(1);
    });

    it.each(["save", "off"])("never saves in %s mode", async (mode) => {
      workspace._config["labshelf.writing"] = { autoCompile: mode };
      setup();
      const document = doc("/p/tex/main.tex");
      type(document);
      await jest.advanceTimersByTimeAsync(1000);
      expect(document.save).not.toHaveBeenCalled();
    });

    it("ignores Typst, outside files and changes without content", async () => {
      setup();
      const typst = doc("/p/typ/main.typ");
      const outside = doc("/elsewhere/a.tex");
      const empty = doc("/p/tex/main.tex");
      type(typst);
      type(outside);
      type(empty, []);
      await jest.advanceTimersByTimeAsync(1000);
      expect([typst, outside, empty].map((d) => d.save.mock.calls.length)).toEqual([0, 0, 0]);
    });

    it("skips a document that is no longer dirty and logs a failed save", async () => {
      const host = fakeHost();
      setup(host);
      const clean = doc("/p/tex/a.tex", jest.fn(async () => true), false);
      const failing = doc("/p/tex/b.tex", jest.fn(async () => { throw new Error("disk"); }));
      type(clean);
      type(failing);
      await jest.advanceTimersByTimeAsync(300);
      expect(clean.save).not.toHaveBeenCalled();
      expect(host.session.logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ file: "/p/tex/b.tex" }));
    });
  });
});

// Tests when saved LaTeX files trigger a build: the root of the saved file is built, debounced per root, while auto compile is on.
describe("registerLatexWriteBuilds", () => {
  const request = jest.fn<Promise<unknown>, [string, string, string | undefined]>(async () => undefined);

  const rootOf = buildRootOf as jest.Mock;
  const workspace = vscode.workspace as unknown as {
    _fireDocumentEvent: (kind: string, document: unknown) => void;
    _fireConfigChange: (section: string) => void;
    _config: Record<string, Record<string, unknown>>;
  };
  const doc = (fsPath: string) => ({ uri: Object.assign(vscode.Uri.file(fsPath), { scheme: "file" }) });
  const save = (fsPath: string) => workspace._fireDocumentEvent("save", doc(fsPath));

  let context: { subscriptions: { dispose(): void }[] };

  function setup(host = fakeHost(), includeOnlyTarget?: jest.Mock) {
    const projects = fakeProjects([readyEntry("/p/tex", { main: "main.tex" }), readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } })]);
    context = { subscriptions: [] };
    registerLatexWriteBuilds({
      context, host, projects: projects as never, request,
      ...(includeOnlyTarget ? { includeOnlyTarget } : {}),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete workspace._config["labshelf.writing"];
    jest.useFakeTimers();
    rootOf.mockImplementation(async (_reads: unknown, _folder: string, main: string) => main);
  });

  afterEach(() => {
    context.subscriptions.forEach((subscription) => subscription.dispose());
    jest.useRealTimers();
  });

  describe("registerLatexSaveBuilds saves", () => {
    it("builds the main file 300 ms after a save of a chapter that is not a root", async () => {
      setup();
      save("/p/tex/chapters/one.tex");
      await jest.advanceTimersByTimeAsync(299);
      expect(request).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(rootOf).toHaveBeenCalledWith(expect.anything(), "/p/tex", "main.tex", "/p/tex/chapters/one.tex");
      expect(request).toHaveBeenCalledWith("/p/tex", "main.tex", undefined);
    });

    it("passes the include-only target of the root to the build", async () => {
      const target = jest.fn(async () => "chapters/one");
      setup(fakeHost(), target);
      save("/p/tex/chapters/one.tex");
      await jest.advanceTimersByTimeAsync(300);
      expect(target).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/tex" }), "main.tex");
      expect(request).toHaveBeenCalledWith("/p/tex", "main.tex", "chapters/one");
    });

    it("builds a second root itself, one build per root for a burst", async () => {
      rootOf.mockImplementation(async (_reads: unknown, _folder: string, main: string, file: string) => (file.endsWith("slides.tex") ? "slides.tex" : main));
      setup();
      save("/p/tex/slides.tex");
      save("/p/tex/slides.tex");
      save("/p/tex/chapters/one.tex");
      await jest.advanceTimersByTimeAsync(300);
      expect(request.mock.calls.map(([, root]) => root).sort()).toEqual(["main.tex", "slides.tex"]);
    });

    it("ignores Typst projects and files that are not LaTeX sources", async () => {
      setup();
      save("/p/typ/main.typ");
      save("/p/tex/figure.png");
      await jest.advanceTimersByTimeAsync(1000);
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe("registerLatexSaveBuilds auto compile", () => {
    const setAutoCompile = (mode: string) => {
      workspace._config["labshelf.writing"] = { autoCompile: mode };
      workspace._fireConfigChange("labshelf.writing.autoCompile");
    };

    it("requests no build on save while auto compile is off", async () => {
      workspace._config["labshelf.writing"] = { autoCompile: "off" };
      setup();
      save("/p/tex/main.tex");
      await jest.advanceTimersByTimeAsync(1000);
      expect(request).not.toHaveBeenCalled();
    });

    it("builds on save in save mode", async () => {
      workspace._config["labshelf.writing"] = { autoCompile: "save" };
      setup();
      save("/p/tex/main.tex");
      await jest.advanceTimersByTimeAsync(300);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("applies a change of the setting without registering again", async () => {
      setup();
      setAutoCompile("off");
      save("/p/tex/main.tex");
      await jest.advanceTimersByTimeAsync(1000);
      expect(request).not.toHaveBeenCalled();
      setAutoCompile("typing");
      save("/p/tex/main.tex");
      await jest.advanceTimersByTimeAsync(300);
      expect(request).toHaveBeenCalledWith("/p/tex", "main.tex", undefined);
    });

    it("logs the skip once per setting value, not once per save", async () => {
      const host = fakeHost();
      workspace._config["labshelf.writing"] = { autoCompile: "off" };
      setup(host);
      save("/p/tex/main.tex");
      save("/p/tex/main.tex");
      save("/p/tex/figure.png");
      await jest.advanceTimersByTimeAsync(1000);
      expect(host.session.logger.log).toHaveBeenCalledTimes(1);
      setAutoCompile("typing");
      setAutoCompile("off");
      save("/p/tex/main.tex");
      await jest.advanceTimersByTimeAsync(1000);
      expect(host.session.logger.log).toHaveBeenCalledTimes(2);
    });
  });
});

// Tests the LaTeX Workshop notice: once per workspace, only with the extension and a LaTeX project, and the button's setting.
describe("registerLatexWorkshopNotice", () => {
  const info = vscode.window.showInformationMessage as jest.Mock;
  const getExtension = vscode.extensions.getExtension as jest.Mock;
  const configUpdate = (vscode.workspace as unknown as { _configUpdate: jest.Mock })._configUpdate;
  const BUTTON = "Turn off its auto build";

  function setup(format: "latex" | "typst" = "latex", seenBefore = false) {
    const state = new Map<string, unknown>(seenBefore ? [["labshelf.writing.latexWorkshopNoticeShown", true]] : []);
    const context = {
      subscriptions: [] as { dispose: () => void }[],
      workspaceState: { get: (key: string) => state.get(key), update: jest.fn(async (key: string, value: unknown) => { state.set(key, value); }) },
    };
    const logger = fakeLogger();
    const projects = { list: () => [readyEntry("/code/repo", { settings: { id: "repo", format } })], paths: path };
    registerLatexWorkshopNotice({ context: context as never, host: fakeHost(logger), projects });
    registered.push(context);
    return { context, logger };
  }

  const registered: { subscriptions: { dispose: () => void }[] }[] = [];
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  afterEach(() => {
    registered.splice(0).forEach((context) => context.subscriptions.forEach((subscription) => subscription.dispose()));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getExtension.mockReturnValue({ id: "James-Yu.latex-workshop" });
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: vscode.Uri.file("/code") }];
    openInEditor("/elsewhere/a.tex");
  });

  describe("registerLatexWorkshopNotice", () => {
    it("shows once per workspace, whatever the answer", async () => {
      const { context } = setup();
      openInEditor("/code/repo/a.tex");
      await flush();
      openInEditor("/code/repo/b.tex");
      await flush();
      expect(info).toHaveBeenCalledTimes(1);
      expect(info.mock.calls[0]).toEqual([expect.stringContaining("LaTeX Workshop is also installed"), BUTTON]);
      expect(context.workspaceState.update).toHaveBeenCalledWith("labshelf.writing.latexWorkshopNoticeShown", true);
      expect(configUpdate).not.toHaveBeenCalled();
    });

    it("stays quiet when the workspace already saw it", async () => {
      setup("latex", true);
      openInEditor("/code/repo/a.tex");
      await flush();
      expect(info).not.toHaveBeenCalled();
    });

    it("stays quiet without LaTeX Workshop", async () => {
      getExtension.mockReturnValue(undefined);
      setup();
      openInEditor("/code/repo/a.tex");
      await flush();
      expect(info).not.toHaveBeenCalled();
    });

    it("stays quiet outside projects and for non-file documents", async () => {
      setup();
      openInEditor("/elsewhere/a.tex");
      openInEditor("/code/repo/a.tex", "untitled");
      await flush();
      expect(info).not.toHaveBeenCalled();
    });

    it("stays quiet in Typst projects", async () => {
      setup("typst");
      openInEditor("/code/repo/a.typ");
      await flush();
      expect(info).not.toHaveBeenCalled();
    });

    it("writes latex.autoBuild.run: never to the Workspace target on the button", async () => {
      info.mockResolvedValueOnce(BUTTON);
      const { logger } = setup();
      openInEditor("/code/repo/a.tex");
      await flush();
      expect(configUpdate).toHaveBeenCalledWith("latex-workshop", "latex.autoBuild.run", "never", vscode.ConfigurationTarget.Workspace);
      expect(logger.log).toHaveBeenCalledWith("INFO", "writing/build", "Turned off LaTeX Workshop auto build", expect.anything());
    });

    it("writes to the Global target when no folder is open", async () => {
      (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
      info.mockResolvedValueOnce(BUTTON);
      setup();
      openInEditor("/code/repo/a.tex");
      await flush();
      expect(configUpdate).toHaveBeenCalledWith("latex-workshop", "latex.autoBuild.run", "never", vscode.ConfigurationTarget.Global);
    });

    it("logs and reports a failed write", async () => {
      info.mockResolvedValueOnce(BUTTON);
      configUpdate.mockRejectedValueOnce(new Error("read-only settings"));
      const { logger } = setup();
      openInEditor("/code/repo/a.tex");
      await flush();
      expect(logger.error).toHaveBeenCalledWith("writing/build", expect.any(Error), expect.objectContaining({ target: vscode.ConfigurationTarget.Workspace }));
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("read-only settings"));
    });
  });
});
