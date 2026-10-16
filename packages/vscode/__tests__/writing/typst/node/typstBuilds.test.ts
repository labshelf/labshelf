// Tests the Typst build queue: live versus saved outputs, what each trigger tells the preview and Problems, and errors.
import * as path from "node:path";
import * as vscode from "vscode";

import { rootBuildFolder } from "@labshelf/core";
import { runTypstBuild } from "@labshelf/core/typst/node";
import { tinymistInstalled } from "../../../../src/writing/typst/tinymist";
import { TypstBuilds } from "../../../../src/writing/typst/node/typstBuilds";
import { recordTypstVersion } from "../../../../src/writing/typst/typstVersionPin";
import { fakeHost, fakeLogger, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/typst/node", () => ({ ...jest.requireActual("@labshelf/core/typst/node"), runTypstBuild: jest.fn() }));
jest.mock("../../../../src/writing/typst/tinymist", () => ({ tinymistInstalled: jest.fn() }));
jest.mock("../../../../src/writing/typst/typstVersionPin", () => ({ recordTypstVersion: jest.fn(async () => {}) }));

const run = runTypstBuild as jest.Mock;
const window = vscode.window as unknown as Record<string, jest.Mock>;
const workspace = vscode.workspace as unknown as { textDocuments: unknown[] };
const previewOf = (root: string) => path.join("/cache/paper", rootBuildFolder(root), `${path.parse(root).name}.pdf`);
const PREVIEW = previewOf("main.typ");
const problems = [{ severity: "error", message: "unknown variable", file: "/p/paper/main.typ", line: 2 }];
const succeeded = { status: "succeeded", pdf: PREVIEW, problems: [] };
const failed = { status: "failed", problems };

function document(fsPath: string, over: Record<string, unknown> = {}) {
  return { isDirty: true, uri: Object.assign(vscode.Uri.file(fsPath), { scheme: "file" }), getText: () => `text of ${fsPath}`, ...over };
}

function setup(over: Parameters<typeof readyEntry>[1] = {}) {
  const logger = fakeLogger();
  const compiler = { session: { id: "session" }, packages: { id: "packages" } };
  const deps = {
    compiler: { get: jest.fn(async () => compiler) } as never,
    host: fakeHost(logger),
    projects: fakeProjects([readyEntry("/p/paper", { main: "main.typ", settings: { id: "paper", format: "typst" }, ...over })]),
    diagnostics: { publish: jest.fn() },
    previews: { building: jest.fn(), finished: jest.fn() },
  };
  return { builds: new TypstBuilds(deps), deps, logger, compiler };
}

beforeEach(() => {
  jest.clearAllMocks();
  workspace.textDocuments = [];
  (tinymistInstalled as jest.Mock).mockReturnValue(false);
  run.mockResolvedValue(succeeded);
});

describe("TypstBuilds outputs", () => {
  it("live compiles only into the preview and passes unsaved project documents as sources", async () => {
    workspace.textDocuments = [
      document("/p/paper/main.typ"),
      document("/p/paper/clean.typ", { isDirty: false }),
      document("/p/other/outside.typ"),
      document("/p/paper/untitled.typ", { uri: Object.assign(vscode.Uri.file("/p/paper/untitled.typ"), { scheme: "untitled" }) }),
    ];
    const { builds, compiler } = setup();
    await builds.request("/p/paper", "main.typ", "live");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      session: compiler.session, packages: compiler.packages, projectFolder: "/p/paper", main: "main.typ", outputs: [PREVIEW],
    }));
    expect(run.mock.calls[0][0].sources).toEqual(new Map([["/p/paper/main.typ", "text of /p/paper/main.typ"]]));
  });

  it.each(["save", "command"] as const)("%s writes the preview PDF and then <main>.pdf next to main, from disk", async (trigger) => {
    workspace.textDocuments = [document("/p/paper/sub/main.typ")];
    const { builds } = setup({ main: "sub/main.typ" });
    await builds.request("/p/paper", "sub/main.typ", trigger);
    const request = run.mock.calls[0][0];
    expect(request.outputs).toEqual([previewOf("sub/main.typ"), "/p/paper/sub/main.pdf"]);
    expect(request.sources.size).toBe(0);
  });
  it("builds a root that is not the project's main: passes it as main and writes both PDFs for that root", async () => {
    const { builds, deps } = setup({ main: "main.typ" });
    await builds.request("/p/paper", "chapters/two/main.typ", "save");
    const request = run.mock.calls[0][0];
    expect(request.main).toBe("chapters/two/main.typ");
    expect(request.outputs).toEqual([previewOf("chapters/two/main.typ"), "/p/paper/chapters/two/main.pdf"]);
    expect(deps.diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "chapters/two/main.typ"), []);
    expect(deps.previews.finished).toHaveBeenCalledWith(expect.anything(), "chapters/two/main.typ", succeeded, "save");
  });
});

describe("TypstBuilds results", () => {
  it("tells the preview a live success finished as a save and records nothing else", async () => {
    const { builds, deps } = setup();
    await builds.request("/p/paper", "main.typ", "live");
    expect(deps.previews.finished).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), "main.typ", succeeded, "save");
    expect(deps.diagnostics.publish).not.toHaveBeenCalled();
    expect(recordTypstVersion).not.toHaveBeenCalled();
  });

  it("leaves the preview and Problems alone after a failed live compile", async () => {
    run.mockResolvedValue(failed);
    const { builds, deps } = setup();
    await builds.request("/p/paper", "main.typ", "live");
    expect(deps.previews.finished).not.toHaveBeenCalled();
    expect(deps.diagnostics.publish).not.toHaveBeenCalled();
  });

  it("publishes the problems and reports a failed save to the preview", async () => {
    run.mockResolvedValue(failed);
    const { builds, deps } = setup();
    await builds.request("/p/paper", "main.typ", "save");
    expect(deps.diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "main.typ"), problems);
    expect(deps.previews.finished).toHaveBeenCalledWith(expect.anything(), "main.typ", failed, "save");
    expect(window["setStatusBarMessage"]).toHaveBeenLastCalledWith("$(error) Build of main.typ failed: 1 error", 5000);
    expect(recordTypstVersion).not.toHaveBeenCalled();
  });

  it("resolves a saved build with its result, and a live compile or a thrown error with nothing", async () => {
    run.mockResolvedValue(failed);
    const { builds } = setup();
    expect(await builds.request("/p/paper", "main.typ", "command")).toBe(failed);
    expect(await builds.request("/p/paper", "main.typ", "live")).toBeUndefined();
    run.mockRejectedValue(new Error("boom"));
    expect(await builds.request("/p/paper", "main.typ", "save")).toBeUndefined();
  });

  it("does not publish what Tinymist already lists, but the preview still gets the problems", async () => {
    (tinymistInstalled as jest.Mock).mockReturnValue(true);
    run.mockResolvedValue(failed);
    const { builds, deps } = setup();
    await builds.request("/p/paper", "main.typ", "save");
    expect(deps.diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "main.typ"), []);
    expect(deps.previews.finished).toHaveBeenCalledWith(expect.anything(), "main.typ", expect.objectContaining({ problems }), "save");
  });

  it.each(["save", "command"] as const)("records the Typst version after a successful %s build", async (trigger) => {
    const { builds, deps } = setup();
    await builds.request("/p/paper", "main.typ", trigger);
    expect(recordTypstVersion).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), deps);
    expect(deps.diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "main.typ"), []);
    expect(window["setStatusBarMessage"]).toHaveBeenLastCalledWith("$(check) Built main.pdf", 5000);
  });
});

describe("TypstBuilds queue", () => {
  it("runs one compile for several live requests made while one is queued", async () => {
    let release!: () => void;
    run.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(succeeded); }));
    const { builds } = setup();
    const first = builds.request("/p/paper", "main.typ", "live");
    await new Promise((resolve) => setImmediate(resolve));
    const rest = [builds.request("/p/paper", "main.typ", "live"), builds.request("/p/paper", "main.typ", "live"), builds.request("/p/paper", "main.typ", "live")];
    release();
    await Promise.all([first, ...rest]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs a save request after a running live compile instead of folding it", async () => {
    const { builds } = setup();
    await Promise.all([builds.request("/p/paper", "main.typ", "live"), builds.request("/p/paper", "main.typ", "save")]);
    expect(run.mock.calls.map(([request]) => request.outputs.length)).toEqual([1, 2]);
  });
});

describe("TypstBuilds without a main file or on failure", () => {
  it("asks the Build command for a main file and keeps save and live silent", async () => {
    const { builds } = setup({ main: undefined });
    await builds.request("/p/paper", "main.typ", "save");
    await builds.request("/p/paper", "main.typ", "live");
    expect(window["showErrorMessage"]).not.toHaveBeenCalled();
    await builds.request("/p/paper", "main.typ", "command");
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("has no main file"));
    expect(run).not.toHaveBeenCalled();
  });

  it("logs a thrown error and shows it for the command only", async () => {
    run.mockRejectedValue(new Error("wasm trapped"));
    const { builds, logger } = setup();
    await builds.request("/p/paper", "main.typ", "live");
    await builds.request("/p/paper", "main.typ", "save");
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(window["showErrorMessage"]).toHaveBeenCalledTimes(1);
    await builds.request("/p/paper", "main.typ", "command");
    expect(logger.error).toHaveBeenCalledWith("writing/typst", expect.any(Error), { projectFolder: "/p/paper", trigger: "command" });
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("wasm trapped"));
  });
});
