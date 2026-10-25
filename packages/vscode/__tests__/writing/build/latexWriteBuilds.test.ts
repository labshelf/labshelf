// Tests when saved LaTeX files trigger a build: the root of the saved file is built, debounced per root, while auto compile is on.
import * as vscode from "vscode";

import { buildRootOf } from "@labshelf/core";
import { registerLatexWriteBuilds } from "../../../src/writing/build/latexWriteBuilds";
import { fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

const request = jest.fn<Promise<unknown>, [string, string, string | undefined]>(async () => undefined);
jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), buildRootOf: jest.fn() }));

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
