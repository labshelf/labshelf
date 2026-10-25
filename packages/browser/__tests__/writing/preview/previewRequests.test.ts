// Pins how the preview tab answers frame requests: problems open their source line, Mark and Compare reach the history, limits and build options are saved.
import type { ILogger, LibraryFileSystem, PreviewBuildRoots } from "@labshelf/core";
import { revealInOpenEditor } from "../../../src/writing/session";
import { markProjectVersion } from "../../../src/writing/history/markProjectVersion";
import { previewRequestHandler, type PreviewRequestDeps } from "../../../src/writing/preview/previewRequests";

jest.mock("../../../src/writing/session/openEditors", () => ({ revealInOpenEditor: jest.fn() }));
jest.mock("../../../src/writing/history/markProjectVersion", () => ({ markProjectVersion: jest.fn(async () => true) }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const roots: PreviewBuildRoots = {
  main: "main.tex", focused: "main.tex", shown: "main.tex",
  roots: [{ path: "main.tex", failed: true, rawLog: false, sourceLinks: false, problems: [{ severity: "error", message: "a" }, { severity: "error", message: "b", file: "intro.tex", line: 7 }] }],
};

function setup(folder: string | null = "projects/a") {
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
  return { deps, handle: previewRequestHandler(deps) };
}

beforeEach(() => jest.clearAllMocks());

describe("previewRequestHandler", () => {
  it("opens the problem's file and reveals its zero-based line", async () => {
    const { deps, handle } = setup();
    handle({ command: "openProblem", root: "main.tex", index: 1 });
    await flush();
    expect(deps.workspace.openTab).toHaveBeenCalledWith("source", { projectId: "a", path: "intro.tex" }, 0);
    expect(revealInOpenEditor).toHaveBeenCalledWith("a", "intro.tex", 6);
  });

  it("opens nothing for a problem without a file", async () => {
    const { deps, handle } = setup();
    handle({ command: "openProblem", root: "main.tex", index: 0 });
    await flush();
    expect(deps.workspace.openTab).not.toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ index: 0 }));
  });

  it("marks a version of the project", async () => {
    const { handle } = setup();
    handle({ command: "runCommand", id: "markVersion" });
    await flush();
    expect(markProjectVersion).toHaveBeenCalledWith(expect.objectContaining({ lastFullPdf: expect.any(Function) }), { id: "a", folder: "projects/a" });
  });

  it("opens the history to compare versions", async () => {
    const { deps, handle } = setup();
    handle({ command: "runCommand", id: "compareVersions" });
    await flush();
    expect(deps.workspace.openTab).toHaveBeenCalledWith("history", { projectId: "a" }, 1);
  });

  it("saves the check limits and posts the roots again with them", async () => {
    const { deps, handle } = setup();
    handle({ command: "setCheckLimits", limits: { pages: null, words: 4000 } });
    await flush();
    expect(deps.data.updateProjectSettings).toHaveBeenCalledWith("projects/a", { check: { pages: undefined, words: 4000 } });
    expect(deps.limits).toEqual({ pages: undefined, words: 4000 });
    expect(deps.builds.resendRoots).toHaveBeenCalled();
  });

  it("writes nothing while the project is not open", async () => {
    const { deps, handle } = setup(null);
    handle({ command: "setCheckLimits", limits: { pages: 3 } });
    handle({ command: "runCommand", id: "markVersion" });
    await flush();
    expect(deps.data.updateProjectSettings).not.toHaveBeenCalled();
    expect(markProjectVersion).not.toHaveBeenCalled();
  });

  it.each([
    [{ command: "setAutoCompile", mode: "save" } as const, { autoCompile: "save" }],
    [{ command: "setHaltOnError", on: true } as const, { haltOnError: true }],
  ])("saves the user's %j before the open build changes", async (request, patch) => {
    const { deps, handle } = setup();
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
    const { deps, handle } = setup();
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
    const { deps, handle } = setup(null);
    handle({ command: "setEngine", engine: "xelatex" });
    await flush();
    expect(deps.data.updateProjectSettings).not.toHaveBeenCalled();
    expect(deps.helperProject.setBuild).not.toHaveBeenCalled();
    expect(deps.options.engine).toBeNull();
  });
});
