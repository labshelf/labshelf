// Tests what LaTeX builds show in the editor: result, diagnostics, preview notices, dismissed toolchain setups and failures.
import * as path from "node:path";
import * as vscode from "vscode";

import { BuildProblems } from "../../../../src/writing/build/buildProblems";
import { LatexBuilds } from "../../../../src/writing/build/node/registerLatexBuild";
import { reportToolchainMissing } from "../../../../src/writing/build/node/ensureToolchain";
import { fakeHost, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("../../../../src/writing/build/node/ensureToolchain", () => ({ reportToolchainMissing: jest.fn() }));

type Result = Record<string, unknown>;
const window = vscode.window as unknown as Record<string, jest.Mock>;
const failed = { status: "failed", problems: [{ severity: "error", message: "x", file: "/p/paper/main.tex", line: 2 }] };
const succeeded = { status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] };

interface Options { root: string; includeOnly?: string; onCompile?: (root: string) => void }

function setup(over: Parameters<typeof readyEntry>[1] = {}) {
  const projects = fakeProjects([readyEntry("/p/paper", over)]);
  const diagnostics = { publish: jest.fn() };
  const previews = { building: jest.fn(), finished: jest.fn() };
  const host = fakeHost();
  let result: Result = failed;
  const request = jest.fn((_project: unknown, options: Options) => {
    options.onCompile?.(options.root);
    return Promise.resolve(result);
  });
  const queue = { request, cancelAll: jest.fn() };
  const builds = new LatexBuilds({ host, projects: projects as never, queue: queue as never, diagnostics, previews });
  return { builds, diagnostics, previews, queue, request, logger: host.session.logger, answer: (next: Result) => { result = next; } };
}

beforeEach(() => jest.clearAllMocks());

describe("LatexBuilds", () => {
  it("asks the queue for the root and publishes the problems under that root's own file", async () => {
    const { builds, diagnostics, request } = setup();
    await builds.request("/p/paper", "a/main.tex", "command", "ch/two");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), expect.objectContaining({ root: "a/main.tex", includeOnly: "ch/two" }));
    expect(diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "a/main.tex"), [expect.objectContaining({ message: "x" })]);
    expect(window["setStatusBarMessage"]).toHaveBeenLastCalledWith("$(error) Build of a/main.tex failed: 1 error", 5000);
  });

  it("passes the halt-on-error setting to the queue", async () => {
    (vscode.workspace as unknown as { _config: Record<string, unknown> })._config["labshelf.writing"] = { haltOnError: true };
    const { builds, request } = setup();
    await builds.request("/p/paper", "main.tex", "command");
    expect(request.mock.calls[0]![1]).toHaveProperty("haltOnError", true);
    delete (vscode.workspace as unknown as { _config: Record<string, unknown> })._config["labshelf.writing"];
  });

  it("leaves includeOnly out of the request when none is given", async () => {
    const { builds, request } = setup();
    await builds.request("/p/paper", "main.tex", "command");
    expect(request.mock.calls[0]![1]).not.toHaveProperty("includeOnly");
  });

  it("resolves with the build's result, and with nothing for a cancelled build", async () => {
    const { builds, answer } = setup();
    answer(succeeded);
    expect(await builds.request("/p/paper", "main.tex", "command")).toBe(succeeded);
    answer({ status: "cancelled" });
    expect(await builds.request("/p/paper", "main.tex", "command")).toBeUndefined();
  });

  it("tells the preview a build started and what it produced, and says nothing about a cancelled build", async () => {
    const { builds, previews, answer } = setup();
    answer(succeeded);
    await builds.request("/p/paper", "main.tex", "command");
    expect(previews.building).toHaveBeenCalledWith("/p/paper", "main.tex");
    expect(previews.finished).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), "main.tex", succeeded, "command");

    previews.finished.mockClear();
    answer({ status: "cancelled" });
    await builds.request("/p/paper", "main.tex", "save");
    expect(previews.finished).not.toHaveBeenCalled();
  });

  it("stops the status bar spinner when the build ends", async () => {
    const { builds, answer } = setup();
    const spinner = { dispose: jest.fn() };
    window["setStatusBarMessage"]!.mockReturnValueOnce(spinner);
    answer(succeeded);
    await builds.request("/p/paper", "main.tex", "command");
    expect(spinner.dispose).toHaveBeenCalledTimes(1);
  });

  it("stops asking on save after the toolchain prompt is dismissed, and asks again on the command", async () => {
    const { builds, request, answer, diagnostics } = setup();
    const missing = { status: "toolchain-missing" };
    answer(missing);
    expect(await builds.request("/p/paper", "main.tex", "save")).toBeUndefined();
    await builds.request("/p/paper", "main.tex", "save");
    expect(request).toHaveBeenCalledTimes(1);
    expect(reportToolchainMissing).toHaveBeenCalledWith(missing);
    await builds.request("/p/paper", "main.tex", "command");
    expect(request).toHaveBeenCalledTimes(2);
    expect(reportToolchainMissing).toHaveBeenCalledTimes(2);
    expect(diagnostics.publish).not.toHaveBeenCalled();
  });

  it("asks saves again after a build that ran", async () => {
    const { builds, request, answer } = setup();
    answer({ status: "toolchain-missing" });
    await builds.request("/p/paper", "main.tex", "save");
    answer(succeeded);
    await builds.request("/p/paper", "main.tex", "command");
    await builds.request("/p/paper", "main.tex", "save");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("asks for a main file instead of building when the project has none", async () => {
    const { builds, request } = setup({ main: undefined });
    await builds.request("/p/paper", "main.tex", "command");
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("has no main file"));
    expect(request).not.toHaveBeenCalled();
  });

  it("logs a build that throws, shows it, and resolves with nothing", async () => {
    const { builds, request, logger } = setup();
    const error = new Error("boom");
    request.mockRejectedValueOnce(error);
    expect(await builds.request("/p/paper", "main.tex", "save")).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("writing/build", error, { projectFolder: "/p/paper", root: "main.tex", trigger: "save" });
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("cancels every queued build", () => {
    const { builds, queue } = setup();
    builds.cancelAll();
    expect(queue.cancelAll).toHaveBeenCalledTimes(1);
  });
});

describe("BuildProblems", () => {
  it("replaces the files a project's previous build reported", () => {
    const diagnostics = new BuildProblems();
    const collection = (vscode.languages.createDiagnosticCollection as jest.Mock).mock.results.at(-1)!.value;
    diagnostics.publish("/p", [{ severity: "error", message: "Unknown command \\x.", hint: "Check the spelling.", file: "/p/a.tex", line: 3 }]);
    const [uri, [diagnostic]] = collection.set.mock.calls[0];
    expect(uri.fsPath).toBe("/p/a.tex");
    expect(diagnostic).toMatchObject({ message: "Unknown command \\x.\nCheck the spelling.", severity: vscode.DiagnosticSeverity.Error, source: "LabShelf" });
    expect(diagnostic.range.start.line).toBe(2);
    diagnostics.publish("/p", []);
    expect(collection.delete).toHaveBeenCalledWith(uri);
  });

  it("keeps the problems of one root when another root of the project publishes", () => {
    const diagnostics = new BuildProblems();
    const collection = (vscode.languages.createDiagnosticCollection as jest.Mock).mock.results.at(-1)!.value;
    diagnostics.publish("/p/a/main.tex", [{ severity: "error", message: "in a", file: "/p/a/main.tex", line: 1 }]);
    diagnostics.publish("/p/b/main.tex", [{ severity: "error", message: "in b", file: "/p/b/main.tex", line: 1 }]);
    expect(collection.delete).not.toHaveBeenCalled();
    diagnostics.publish("/p/b/main.tex", []);
    expect(collection.delete.mock.calls.map(([uri]: [vscode.Uri]) => uri.fsPath)).toEqual(["/p/b/main.tex"]);
  });
});
