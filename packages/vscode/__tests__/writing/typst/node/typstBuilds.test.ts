// Tests the Typst builds: live versus saved requests, what each trigger tells the preview and Problems, and errors.
import * as path from "node:path";
import * as vscode from "vscode";

import { buildProject } from "@labshelf/core/node";
import { TypstBuilds } from "../../../../src/writing/typst/node/typstBuilds";
import { writeTypstVersion } from "../../../../src/writing/typst/typstVersionPin";
import { fakeHost, fakeLogger, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), buildProject: jest.fn() }));
jest.mock("../../../../src/writing/typst/typstVersionPin", () => ({ writeTypstVersion: jest.fn(async () => {}) }));

const run = buildProject as jest.Mock;
const window = vscode.window as unknown as Record<string, jest.Mock>;
const workspace = vscode.workspace as unknown as { textDocuments: unknown[] };
const problems = [{ severity: "error", message: "unknown variable", file: "/p/paper/main.typ", line: 2 }];
const succeeded = { status: "succeeded", pdf: "/cache/paper/main.pdf", problems: [] };
const failed = { status: "failed", problems };

function document(fsPath: string, over: Record<string, unknown> = {}) {
  return { isDirty: true, uri: Object.assign(vscode.Uri.file(fsPath), { scheme: "file" }), getText: () => `text of ${fsPath}`, ...over };
}

function setup(over: Parameters<typeof readyEntry>[1] = {}) {
  const logger = fakeLogger();
  let saved: Record<string, unknown> | Error = succeeded;
  const request = jest.fn(() => (saved instanceof Error ? Promise.reject(saved) : Promise.resolve(saved)));
  const deps = {
    queue: { request } as never,
    buildDeps: { id: "build deps" } as never,
    host: fakeHost(logger),
    projects: fakeProjects([readyEntry("/p/paper", { main: "main.typ", settings: { id: "paper", format: "typst" }, ...over })]),
    diagnostics: { publish: jest.fn() },
    previews: { building: jest.fn(), finished: jest.fn() },
  };
  return { builds: new TypstBuilds(deps), deps, logger, request, answer: (next: Record<string, unknown> | Error) => { saved = next; } };
}

beforeEach(() => {
  jest.clearAllMocks();
  workspace.textDocuments = [];
  run.mockReset();
  run.mockResolvedValue(succeeded);
});

describe("TypstBuilds live compiles", () => {
  it("bypass the queue and pass unsaved project documents as sources", async () => {
    workspace.textDocuments = [
      document("/p/paper/main.typ"),
      document("/p/paper/clean.typ", { isDirty: false }),
      document("/p/other/outside.typ"),
      document("/p/paper/untitled.typ", { uri: Object.assign(vscode.Uri.file("/p/paper/untitled.typ"), { scheme: "untitled" }) }),
    ];
    const { builds, deps, request } = setup();
    await builds.request("/p/paper", "main.typ", "live");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), deps.buildDeps, {
      root: "main.typ", unsaved: new Map([["/p/paper/main.typ", "text of /p/paper/main.typ"]]),
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("TypstBuilds saved builds", () => {
  it.each(["save", "command"] as const)("%s goes through the queue for the requested root, which need not be the main", async (trigger) => {
    const { builds, deps, request } = setup({ main: "main.typ" });
    await builds.request("/p/paper", "chapters/two/main.typ", trigger);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), { root: "chapters/two/main.typ" });
    expect(run).not.toHaveBeenCalled();
    expect(deps.diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "chapters/two/main.typ"), []);
    expect(deps.previews.finished).toHaveBeenCalledWith(expect.anything(), "chapters/two/main.typ", succeeded, trigger);
  });

  it.each(["cancelled", "no-main", "toolchain-missing"])("a %s build shows and records nothing", async (status) => {
    const { builds, deps, answer } = setup();
    answer({ status });
    expect(await builds.request("/p/paper", "main.typ", "save")).toBeUndefined();
    expect(deps.previews.finished).not.toHaveBeenCalled();
    expect(deps.diagnostics.publish).not.toHaveBeenCalled();
    expect(writeTypstVersion).not.toHaveBeenCalled();
  });
});

describe("TypstBuilds results", () => {
  it("tells the preview a live success finished as a save and records nothing else", async () => {
    const { builds, deps } = setup();
    await builds.request("/p/paper", "main.typ", "live");
    expect(deps.previews.finished).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), "main.typ", succeeded, "save");
    expect(deps.diagnostics.publish).not.toHaveBeenCalled();
    expect(writeTypstVersion).not.toHaveBeenCalled();
  });

  it("leaves the preview and Problems alone after a failed live compile", async () => {
    run.mockResolvedValue(failed);
    const { builds, deps } = setup();
    await builds.request("/p/paper", "main.typ", "live");
    expect(deps.previews.finished).not.toHaveBeenCalled();
    expect(deps.diagnostics.publish).not.toHaveBeenCalled();
  });

  it("publishes the problems and reports a failed save to the preview", async () => {
    const { builds, deps, answer } = setup();
    answer(failed);
    await builds.request("/p/paper", "main.typ", "save");
    expect(deps.diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "main.typ"), problems);
    expect(deps.previews.finished).toHaveBeenCalledWith(expect.anything(), "main.typ", failed, "save");
    expect(window["setStatusBarMessage"]).toHaveBeenLastCalledWith("$(error) Build of main.typ failed: 1 error", 5000);
    expect(writeTypstVersion).not.toHaveBeenCalled();
  });

  it("resolves a saved build with its result, and a live compile or a thrown error with nothing", async () => {
    const { builds, answer } = setup();
    answer(failed);
    expect(await builds.request("/p/paper", "main.typ", "command")).toBe(failed);
    expect(await builds.request("/p/paper", "main.typ", "live")).toBeUndefined();
    answer(new Error("boom"));
    expect(await builds.request("/p/paper", "main.typ", "save")).toBeUndefined();
  });

  it.each(["save", "command"] as const)("records the Typst version after a successful %s build", async (trigger) => {
    const { builds, deps } = setup();
    await builds.request("/p/paper", "main.typ", trigger);
    expect(writeTypstVersion).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), deps);
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
    const { builds, request } = setup();
    const order: string[] = [];
    run.mockImplementation(async () => { order.push("live"); return succeeded; });
    request.mockImplementation(async () => { order.push("saved"); return succeeded; });
    await Promise.all([builds.request("/p/paper", "main.typ", "live"), builds.request("/p/paper", "main.typ", "save")]);
    expect(order).toEqual(["live", "saved"]);
  });
});

describe("TypstBuilds without a main file or on failure", () => {
  it("asks the Build command for a main file and keeps save and live silent", async () => {
    const { builds, request } = setup({ main: undefined });
    await builds.request("/p/paper", "main.typ", "save");
    await builds.request("/p/paper", "main.typ", "live");
    expect(window["showErrorMessage"]).not.toHaveBeenCalled();
    await builds.request("/p/paper", "main.typ", "command");
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("has no main file"));
    expect(run).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("logs a thrown error and shows it for the command only", async () => {
    run.mockRejectedValue(new Error("wasm trapped"));
    const { builds, logger, answer } = setup();
    answer(new Error("wasm trapped"));
    await builds.request("/p/paper", "main.typ", "live");
    await builds.request("/p/paper", "main.typ", "save");
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(window["showErrorMessage"]).not.toHaveBeenCalled();
    await builds.request("/p/paper", "main.typ", "command");
    expect(logger.error).toHaveBeenCalledWith("writing/typst", expect.any(Error), { projectFolder: "/p/paper", trigger: "command" });
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("wasm trapped"));
  });
});
