// Tests when Typst files trigger a build: debounced live compiles into an open preview, and debounced builds after a save.
import * as vscode from "vscode";

import { buildRootOf } from "@labshelf/core";
import { runTypstBuild } from "@labshelf/core/typst/node";
import { registerTypstBuild } from "../../../../src/writing/typst/node";
import { fakeHost, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), buildRootOf: jest.fn() }));
jest.mock("@labshelf/core/typst/node", () => ({ ...jest.requireActual("@labshelf/core/typst/node"), runTypstBuild: jest.fn() }));
jest.mock("../../../../src/writing/typst/node/typstCompilerHost", () => ({
  createTypstCompilerHost: jest.fn(() => ({ get: async () => ({ session: {}, packages: {} }) })),
}));
jest.mock("../../../../src/writing/typst/typstVersionPin", () => ({ recordTypstVersion: jest.fn(async () => {}) }));

const run = runTypstBuild as jest.Mock;
const rootOf = buildRootOf as jest.Mock;
const workspace = vscode.workspace as unknown as {
  _fireTextDocumentChange: (event: unknown) => void;
  _fireDocumentEvent: (kind: string, document: unknown) => void;
  _fireConfigChange: (section: string) => void;
  _config: Record<string, Record<string, unknown>>;
};
const doc = (fsPath: string) => ({ uri: Object.assign(vscode.Uri.file(fsPath), { scheme: "file" }) });

let context: { subscriptions: { dispose(): void }[]; globalStorageUri: vscode.Uri };

function setup(hasPreview: boolean, host = fakeHost()) {
  const projects = fakeProjects([
    readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }),
    readyEntry("/p/tex", { main: "main.tex" }),
  ]);
  context = { subscriptions: [], globalStorageUri: vscode.Uri.file("/storage") };
  registerTypstBuild({
    context: context as never, host, tex: {} as never, projects: projects as never,
    diagnostics: { publish: jest.fn() }, previews: { building: jest.fn(), finished: jest.fn() }, hasPreview: () => hasPreview,
  });
}

const change = (fsPath: string, contentChanges: unknown[] = [{}]) => workspace._fireTextDocumentChange({ document: doc(fsPath), contentChanges });
const save = (fsPath: string) => workspace._fireDocumentEvent("save", doc(fsPath));
const outputsOf = () => run.mock.calls.map(([request]) => request.outputs.length);

beforeEach(() => {
  jest.clearAllMocks();
  delete workspace._config["labshelf.writing"];
  jest.useFakeTimers();
  run.mockResolvedValue({ status: "succeeded", pdf: "/x.pdf", problems: [] });
  rootOf.mockImplementation(async (_reads: unknown, _folder: string, main: string) => main);
});

afterEach(() => {
  context.subscriptions.forEach((subscription) => subscription.dispose());
  jest.useRealTimers();
});

describe("registerTypstBuild live compiles", () => {
  it("compiles into the preview 150 ms after a change, once for a burst", async () => {
    setup(true);
    change("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(100);
    change("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(149);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(outputsOf()).toEqual([1]);
  });

  it("ignores changes while the project has no open preview", async () => {
    setup(false);
    change("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores LaTeX projects, files outside projects, non-file documents and events without content changes", async () => {
    setup(true);
    change("/p/tex/main.tex");
    change("/elsewhere/a.typ");
    change("/p/typ/main.typ", []);
    workspace._fireTextDocumentChange({ document: { uri: Object.assign(vscode.Uri.file("/p/typ/main.typ"), { scheme: "untitled" }) }, contentChanges: [{}] });
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("registerTypstBuild saves", () => {
  it("builds 300 ms after a save of any file in a Typst project, once for a burst", async () => {
    setup(false);
    save("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(200);
    save("/p/typ/refs.bib");
    await jest.advanceTimersByTimeAsync(299);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(outputsOf()).toEqual([2]);
  });

  it("resolves a saved chapter's root through buildRootOf and builds that root", async () => {
    rootOf.mockResolvedValue("book.typ");
    setup(false);
    save("/p/typ/chapters/one.typ");
    await jest.advanceTimersByTimeAsync(300);
    expect(rootOf).toHaveBeenCalledWith(expect.anything(), "/p/typ", "main.typ", "/p/typ/chapters/one.typ");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].main).toBe("book.typ");
  });

  it("debounces saves per root: two roots each get a build", async () => {
    rootOf.mockImplementation(async (_reads: unknown, _folder: string, _main: string, file: string) => (file.includes("/a/") ? "a/main.typ" : "b/main.typ"));
    setup(false);
    save("/p/typ/a/x.typ");
    save("/p/typ/b/y.typ");
    await jest.advanceTimersByTimeAsync(300);
    expect(run.mock.calls.map(([request]) => request.main).sort()).toEqual(["a/main.typ", "b/main.typ"]);
  });

  it("ignores saves in LaTeX projects", async () => {
    setup(true);
    save("/p/tex/main.tex");
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it("drops a pending build when the extension is disposed", async () => {
    setup(false);
    save("/p/typ/main.typ");
    context.subscriptions.forEach((subscription) => subscription.dispose());
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("registerTypstBuild auto compile", () => {
  const setAutoCompile = (mode: string) => {
    workspace._config["labshelf.writing"] = { autoCompile: mode };
    workspace._fireConfigChange("labshelf.writing.autoCompile");
  };

  it("compiles neither live nor on save while auto compile is off", async () => {
    workspace._config["labshelf.writing"] = { autoCompile: "off" };
    setup(true);
    change("/p/typ/main.typ");
    save("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it("compiles on save but not live in save mode", async () => {
    workspace._config["labshelf.writing"] = { autoCompile: "save" };
    setup(true);
    change("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
    save("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("applies a change of the setting without registering again", async () => {
    setup(true);
    setAutoCompile("off");
    change("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
    setAutoCompile("typing");
    change("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(150);
    expect(outputsOf()).toEqual([1]);
    save("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs the skip once per setting value, not once per keystroke or save", async () => {
    const host = fakeHost();
    workspace._config["labshelf.writing"] = { autoCompile: "off" };
    setup(true, host);
    change("/p/typ/main.typ");
    change("/p/typ/main.typ");
    save("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(1000);
    expect(host.session.logger.log).toHaveBeenCalledTimes(1);
    setAutoCompile("typing");
    setAutoCompile("off");
    save("/p/typ/main.typ");
    await jest.advanceTimersByTimeAsync(1000);
    expect(host.session.logger.log).toHaveBeenCalledTimes(2);
  });
});
