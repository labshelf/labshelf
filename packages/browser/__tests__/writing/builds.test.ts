/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Pins how the preview builds reach the frame: helper build events mirrored onto it, its blob: URLs kept alive while the reader may fetch them, and the answers to its requests (problems open their source line, Mark and Compare reach the history, limits and build options are saved).
import type { BuildOptions, ILogger, LibraryFileSystem, PreviewBuildRoots } from "@labshelf/core";
import { showInOpenEditor } from "../../src/writing/session";
import { writeProjectVersion } from "../../src/writing/history";
import { createPreviewFrame, createPreviewRequestHandler, watchBuilds, type PreviewBuildEvent, type PreviewBuildSource, type PreviewRequestDeps } from "../../src/writing/builds";

jest.mock("../../src/writing/session", () => ({ ...jest.requireActual("../../src/writing/session"), showInOpenEditor: jest.fn() }));
jest.mock("../../src/writing/history", () => ({ writeProjectVersion: jest.fn(async () => true) }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

function setup() {
  let listener: ((event: PreviewBuildEvent) => void) | undefined;
  const source: PreviewBuildSource = {
    build: jest.fn(async () => undefined),
    onBuild: (l) => { listener = l; return () => { listener = undefined; }; },
  };
  const frame = { showPdf: jest.fn(), setBuildStatus: jest.fn(), setPreviewRoots: jest.fn() };
  return { source, frame, send: (event: PreviewBuildEvent) => listener?.(event), isListening: () => listener !== undefined };
}

describe("watchBuilds", () => {
  it("shows the bytes of each pdf event and sets the status from the result", () => {
    const { source, frame, send } = setup();
    watchBuilds(source, frame, { id: "a", main: "main.tex" }, logger);
    const bytes = new Uint8Array([1, 2, 3]);
    send({ type: "building" });
    send({ type: "pdf", bytes, mode: "preview" });
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    expect(source.build).toHaveBeenCalledWith("a");
    expect(frame.showPdf).toHaveBeenCalledWith(bytes);
    expect(frame.setBuildStatus.mock.calls.map(([status]) => status.state)).toEqual(["building", "succeeded"]);
  });

  it("posts the main root with its problems after a failed and a succeeded result", () => {
    const { source, frame, send } = setup();
    watchBuilds(source, frame, { id: "a", main: "main.tex" }, logger);
    const problem = { severity: "error" as const, message: "Undefined control sequence", file: "intro.tex", line: 3, kind: "overfull" as const };
    send({ type: "result", result: { status: "failed", problems: [problem], changed: [] } });
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    const root = (failed: boolean, problems: unknown[]) => ({
      main: "main.tex", focused: "main.tex", shown: "main.tex",
      roots: [{ path: "main.tex", failed, rawLog: false, sourceLinks: false, problems }],
    });
    expect(frame.setPreviewRoots.mock.calls).toEqual([
      [root(true, [{ severity: "error", message: "Undefined control sequence", file: "intro.tex", line: 3 }])],
      [root(false, [])],
    ]);
  });

  it("carries the project's limits and posts them again on resend", () => {
    const { source, frame, send } = setup();
    const limits: { pages?: number; words?: number } = { pages: 8 };
    const follow = watchBuilds(source, frame, { id: "a", main: "main.tex", limits: () => limits }, logger);
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    limits.words = 4000;
    follow.resendRoots();
    expect(frame.setPreviewRoots.mock.calls.map(([roots]) => [roots.pageLimit, roots.wordLimit])).toEqual([[8, undefined], [8, 4000]]);
    expect(follow.roots()?.wordLimit).toBe(4000);
  });

  it("carries the build options and posts their changes on resend", () => {
    const { source, frame, send } = setup();
    const options: BuildOptions = { autoCompile: "typing", engine: null, haltOnError: false };
    const follow = watchBuilds(source, frame, { id: "a", main: "main.tex", options: () => options }, logger);
    send({ type: "result", result: { status: "succeeded", problems: [], changed: [] } });
    options.engine = "lualatex";
    follow.resendRoots();
    expect(frame.setPreviewRoots.mock.calls.map(([roots]) => roots.options)).toEqual([
      { autoCompile: "typing", engine: null, haltOnError: false },
      { autoCompile: "typing", engine: "lualatex", haltOnError: false },
    ]);
  });

  it("stops following when disposed", () => {
    const { source, frame, isListening } = setup();
    watchBuilds(source, frame, { id: "a", main: "main.tex" }, logger).dispose();
    expect(isListening()).toBe(false);
  });
});

describe("createPreviewFrame blob URLs", () => {
  let created = 0;
  const revoked: string[] = [];

  beforeEach(() => {
    created = 0;
    revoked.length = 0;
    URL.createObjectURL = () => `blob:test/${++created}`;
    URL.revokeObjectURL = (url: string) => { revoked.push(url); };
  });

  it("revokes a URL only when a third PDF arrives", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    frame.showPdf(new Uint8Array([1]));
    frame.showPdf(new Uint8Array([2]));
    expect(revoked).toEqual([]);
    frame.showPdf(new Uint8Array([3]));
    expect(revoked).toEqual(["blob:test/1"]);
    frame.dispose();
  });

  it("revokes the remaining URLs and removes the iframe on dispose", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    frame.showPdf(new Uint8Array([1]));
    frame.showPdf(new Uint8Array([2]));
    frame.showPdf(new Uint8Array([3]));
    frame.dispose();
    expect(revoked).toEqual(["blob:test/1", "blob:test/2", "blob:test/3"]);
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("createPreviewFrame channel", () => {
  const fromWindow = (source: Window | null, data: unknown): MessageEvent =>
    new MessageEvent("message", { data, origin: location.origin, source });

  it("posts the build roots to the reader page once it loads", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    const post = jest.spyOn(frame.element.contentWindow!, "postMessage");
    const roots = { main: "main.tex", focused: "main.tex", shown: "main.tex", roots: [] };
    frame.setPreviewRoots(roots);
    expect(post).not.toHaveBeenCalled();
    frame.element.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledWith({ type: "previewRoots", roots }, location.origin);
    frame.dispose();
  });

  it("hands valid requests from its reader page to the listener", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    const listener = jest.fn();
    frame.onRequest(listener);
    window.dispatchEvent(fromWindow(frame.element.contentWindow, { command: "recompile" }));
    window.dispatchEvent(fromWindow(frame.element.contentWindow, { command: "openProblem", root: "main.tex" }));
    expect(listener.mock.calls).toEqual([[{ command: "recompile" }]]);
    frame.dispose();
  });

  it("ignores requests from another window and after dispose", () => {
    const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
    const other = createPreviewFrame(document.body, { id: "q", title: "Q" });
    const listener = jest.fn();
    frame.onRequest(listener);
    window.dispatchEvent(fromWindow(other.element.contentWindow, { command: "recompile" }));
    window.dispatchEvent(fromWindow(window, { command: "recompile" }));
    const source = frame.element.contentWindow;
    frame.dispose();
    window.dispatchEvent(fromWindow(source, { command: "recompile" }));
    expect(listener).not.toHaveBeenCalled();
    other.dispose();
  });
});

describe("createPreviewFrame loading", () => {
  it("points the iframe at the reader only once it is in the page", () => {
    // A detached iframe's document boots with the light colour scheme whatever the page's theme.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src")!;
    const connectedAtSrc: boolean[] = [];
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      ...descriptor,
      set(this: HTMLIFrameElement, value: string) { connectedAtSrc.push(this.isConnected); descriptor.set!.call(this, value); },
    });
    try {
      const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
      expect(connectedAtSrc).toEqual([true]);
      frame.dispose();
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, "src", descriptor);
    }
  });
});


it("delivers only the latest PDF when builds finish before the frame loads", () => {
  const frame = createPreviewFrame(document.body, { id: "p", title: "P" });
  const post = jest.spyOn(frame.element.contentWindow!, "postMessage");
  const urls = ["blob:one", "blob:two", "blob:three"];
  URL.createObjectURL = jest.fn().mockImplementation(() => urls.shift());
  URL.revokeObjectURL = jest.fn();
  frame.showPdf(new Uint8Array([1]));
  frame.showPdf(new Uint8Array([2]));
  frame.showPdf(new Uint8Array([3]));
  frame.element.dispatchEvent(new Event("load"));
  expect(post.mock.calls).toEqual([[{ type: "reloadDocument", pdfUrl: "blob:three" }, location.origin]]);
  frame.dispose();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const roots: PreviewBuildRoots = {
  main: "main.tex", focused: "main.tex", shown: "main.tex",
  roots: [{ path: "main.tex", failed: true, rawLog: false, sourceLinks: false, problems: [{ severity: "error", message: "a" }, { severity: "error", message: "b", file: "intro.tex", line: 7 }] }],
};

function setupRequests(folder: string | null = "projects/a") {
  const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const deps: PreviewRequestDeps = {
    project: { id: "a", folder: folder ?? undefined }, fs: {} as LibraryFileSystem, logger,
    workspace: { openTab: jest.fn() },
    helperProject: { build: jest.fn(async () => undefined), lastFullPdf: jest.fn(() => undefined), setBuild: jest.fn() },
    data: { updateProjectSettings: jest.fn(async () => undefined) },
    builds: { roots: () => roots, resendRoots: jest.fn() },
    limits: { pages: 8 },
    options: { autoCompile: "typing", engine: null, haltOnError: false },
    updateSettings: jest.fn(async () => undefined),
  };
  return { deps, handle: createPreviewRequestHandler(deps) };
}

beforeEach(() => jest.clearAllMocks());

describe("createPreviewRequestHandler", () => {
  it("opens the problem's file and reveals its zero-based line", async () => {
    const { deps, handle } = setupRequests();
    handle({ command: "openProblem", root: "main.tex", index: 1 });
    await flush();
    expect(deps.workspace.openTab).toHaveBeenCalledWith("source", { projectId: "a", path: "intro.tex" }, 0);
    expect(showInOpenEditor).toHaveBeenCalledWith("a", "intro.tex", 6);
  });

  it("opens nothing for a problem without a file", async () => {
    const { deps, handle } = setupRequests();
    handle({ command: "openProblem", root: "main.tex", index: 0 });
    await flush();
    expect(deps.workspace.openTab).not.toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ index: 0 }));
  });

  it("marks a version of the project", async () => {
    const { handle } = setupRequests();
    handle({ command: "runCommand", id: "markVersion" });
    await flush();
    expect(writeProjectVersion).toHaveBeenCalledWith(expect.objectContaining({ lastFullPdf: expect.any(Function) }), { id: "a", folder: "projects/a" });
  });

  it("opens the history to compare versions", async () => {
    const { deps, handle } = setupRequests();
    handle({ command: "runCommand", id: "compareVersions" });
    await flush();
    expect(deps.workspace.openTab).toHaveBeenCalledWith("history", { projectId: "a" }, 1);
  });

  it("saves the check limits and posts the roots again with them", async () => {
    const { deps, handle } = setupRequests();
    handle({ command: "setCheckLimits", limits: { pages: null, words: 4000 } });
    await flush();
    expect(deps.data.updateProjectSettings).toHaveBeenCalledWith("projects/a", { check: { pages: undefined, words: 4000 } });
    expect(deps.limits).toEqual({ pages: undefined, words: 4000 });
    expect(deps.builds.resendRoots).toHaveBeenCalled();
  });

  it("writes nothing while the project is not open", async () => {
    const { deps, handle } = setupRequests(null);
    handle({ command: "setCheckLimits", limits: { pages: 3 } });
    handle({ command: "runCommand", id: "markVersion" });
    await flush();
    expect(deps.data.updateProjectSettings).not.toHaveBeenCalled();
    expect(writeProjectVersion).not.toHaveBeenCalled();
  });

  it.each([
    [{ command: "setAutoCompile", mode: "save" } as const, { autoCompile: "save" }],
    [{ command: "setHaltOnError", on: true } as const, { haltOnError: true }],
  ])("saves the user's %j before the open build changes", async (request, patch) => {
    const { deps, handle } = setupRequests();
    const order: string[] = [];
    (deps.updateSettings as jest.Mock).mockImplementation(async () => { order.push("save"); });
    (deps.helperProject.setBuild as jest.Mock).mockImplementation(() => order.push("build"));
    handle(request);
    await flush();
    expect(deps.updateSettings).toHaveBeenCalledWith(patch);
    expect(deps.helperProject.setBuild).toHaveBeenCalledWith("a", patch);
    expect(order).toEqual(["save", "build"]);
    expect(deps.options).toEqual({ autoCompile: "typing", engine: null, haltOnError: false, ...patch });
    expect(deps.builds.resendRoots).toHaveBeenCalled();
  });

  it("writes the engine to the project before the open build changes", async () => {
    const { deps, handle } = setupRequests();
    const order: string[] = [];
    (deps.data.updateProjectSettings as jest.Mock).mockImplementation(async () => { order.push("write"); });
    (deps.helperProject.setBuild as jest.Mock).mockImplementation(() => order.push("build"));
    handle({ command: "setEngine", engine: "xelatex" });
    await flush();
    expect(deps.data.updateProjectSettings).toHaveBeenCalledWith("projects/a", { engine: "xelatex" });
    expect(deps.helperProject.setBuild).toHaveBeenCalledWith("a", { engine: "xelatex" });
    expect(order).toEqual(["write", "build"]);
    expect(deps.options.engine).toBe("xelatex");
    expect(deps.builds.resendRoots).toHaveBeenCalled();
  });

  it("writes no engine while the project is not open", async () => {
    const { deps, handle } = setupRequests(null);
    handle({ command: "setEngine", engine: "xelatex" });
    await flush();
    expect(deps.data.updateProjectSettings).not.toHaveBeenCalled();
    expect(deps.helperProject.setBuild).not.toHaveBeenCalled();
    expect(deps.options.engine).toBeNull();
  });
});
