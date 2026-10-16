// Tests the build queue: toolchain first, one build at a time per project, newer requests cancel, dismissed setups stay quiet on save.
import * as path from "node:path";
import * as vscode from "vscode";

import { rootBuildFolder } from "@labshelf/core";
import { projectBuildDir, runLatexBuild, updateProjectValues } from "@labshelf/core/node";
import { BuildDiagnostics } from "../../../../src/writing/build/buildDiagnostics";
import { LatexBuilds } from "../../../../src/writing/build/node/latexBuilds";
import { ensureToolchain } from "../../../../src/writing/build/toolchain/node";
import { fakeHost, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), runLatexBuild: jest.fn(), updateProjectValues: jest.fn(), clearFlatBuildFiles: jest.fn() }));
jest.mock("../../../../src/writing/build/toolchain/node", () => ({ ensureToolchain: jest.fn() }));

const TOOLCHAIN = { engine: "tectonic", executable: "/t/tectonic" };
const run = runLatexBuild as jest.Mock;
const generateValues = updateProjectValues as jest.Mock;
const window = vscode.window as unknown as Record<string, jest.Mock>;

function setup(over: Parameters<typeof readyEntry>[1] = {}) {
  const projects = fakeProjects([readyEntry("/p/paper", over)]);
  const diagnostics = { publish: jest.fn() };
  const previews = { building: jest.fn(), finished: jest.fn() };
  const host = fakeHost();
  const builds = new LatexBuilds({ storageDir: "/storage", host, projects: projects as never, diagnostics, previews });
  return { builds, diagnostics, previews, logger: host.session.logger };
}

beforeEach(() => {
  jest.clearAllMocks();
  generateValues.mockReset();
  (ensureToolchain as jest.Mock).mockResolvedValue(TOOLCHAIN);
  run.mockResolvedValue({ status: "failed", problems: [{ severity: "error", message: "x", file: "/p/paper/main.tex", line: 2 }] });
});

describe("LatexBuilds", () => {
  it("generates the values file before compiling a project that lists values", async () => {
    const { builds } = setup({ settings: { id: "paper", format: "latex", values: ["results.json"] } });
    const order: string[] = [];
    generateValues.mockImplementation(async () => { order.push("values"); });
    run.mockImplementation(async () => { order.push("run"); return { status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] }; });
    await builds.request("/p/paper", "main.tex", "command");
    expect(order).toEqual(["values", "run"]);
    expect(generateValues).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper", main: "main.tex" }), expect.anything());
  });

  it("logs a failed values generation with its context and still compiles", async () => {
    const { builds, logger } = setup({ settings: { id: "paper", format: "latex", values: ["results.json"] } });
    const error = new Error("disk full");
    generateValues.mockRejectedValue(error);
    await builds.request("/p/paper", "main.tex", "command");
    expect(logger.error).toHaveBeenCalledWith("writing/build", error, { projectFolder: "/p/paper", action: "generate-values" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not generate values for a project without values", async () => {
    const { builds } = setup();
    await builds.request("/p/paper", "main.tex", "command");
    expect(generateValues).not.toHaveBeenCalled();
  });

  it("builds the main file into the project's cache folder and publishes the problems", async () => {
    const { builds, diagnostics } = setup();
    await builds.request("/p/paper", "main.tex", "command");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      toolchain: TOOLCHAIN, projectFolder: "/p/paper", main: "main.tex", outDir: path.join(projectBuildDir("paper"), rootBuildFolder("main.tex")),
    }));
    expect(diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "main.tex"), [expect.objectContaining({ message: "x" })]);
    expect(window["setStatusBarMessage"]).toHaveBeenLastCalledWith("$(error) Build of main.tex failed: 1 error", 5000);
  });

  it("resolves with the build's result, and with nothing for a cancelled build", async () => {
    const { builds } = setup();
    const result = { status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] };
    run.mockResolvedValue(result);
    expect(await builds.request("/p/paper", "main.tex", "command")).toBe(result);
    run.mockResolvedValue({ status: "cancelled" });
    expect(await builds.request("/p/paper", "main.tex", "command")).toBeUndefined();
  });

  it("cancels the running build on a newer request and folds a burst into one more build", async () => {
    const { builds, diagnostics } = setup();
    const signals: AbortSignal[] = [];
    run.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ status: "cancelled" })));
    });
    const first = builds.request("/p/paper", "main.tex", "save");
    await new Promise((resolve) => setImmediate(resolve));
    void builds.request("/p/paper", "main.tex", "save");
    run.mockResolvedValue({ status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] });
    const last = builds.request("/p/paper", "main.tex", "save");
    await Promise.all([first, last]);
    expect(signals[0]!.aborted).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(diagnostics.publish).toHaveBeenCalledTimes(1);
    expect(diagnostics.publish).toHaveBeenCalledWith(path.join("/p/paper", "main.tex"), []);
  });

  it("tells the preview a build started and what it produced, and says nothing about a cancelled build", async () => {
    const { builds, previews } = setup();
    const order: string[] = [];
    previews.building.mockImplementation(() => order.push("building"));
    run.mockImplementation(async () => { order.push("run"); return { status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] }; });
    previews.finished.mockImplementation(() => order.push("finished"));
    await builds.request("/p/paper", "main.tex", "command");
    expect(order).toEqual(["building", "run", "finished"]);
    expect(previews.building).toHaveBeenCalledWith("/p/paper", "main.tex");
    expect(previews.finished).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), "main.tex", expect.objectContaining({ status: "succeeded" }), "command");

    previews.finished.mockClear();
    run.mockResolvedValue({ status: "cancelled" });
    await builds.request("/p/paper", "main.tex", "save");
    expect(previews.finished).not.toHaveBeenCalled();
  });

  it("stops asking on save after the toolchain prompt is dismissed, and asks again on the command", async () => {
    const { builds } = setup();
    (ensureToolchain as jest.Mock).mockResolvedValue(undefined);
    await builds.request("/p/paper", "main.tex", "save");
    await builds.request("/p/paper", "main.tex", "save");
    expect(ensureToolchain).toHaveBeenCalledTimes(1);
    await builds.request("/p/paper", "main.tex", "command");
    expect(ensureToolchain).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("asks for a main file instead of building when the project has none", async () => {
    const { builds } = setup({ main: undefined });
    await builds.request("/p/paper", "main.tex", "command");
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("has no main file"));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("LatexBuilds with several roots in one project", () => {
  const problem = (file: string, message: string) => ({ severity: "error", message, file, line: 1 });

  it("compiles each root into its own build folder and publishes its problems under its own file", async () => {
    const { builds, diagnostics } = setup();
    run.mockImplementation(async ({ main }: { main: string }) => ({ status: "failed", problems: [problem(`/p/paper/${main}`, main)] }));
    await builds.request("/p/paper", "a/main.tex", "command");
    await builds.request("/p/paper", "b/main.tex", "command");
    const [first, second] = run.mock.calls.map(([request]) => request);
    expect([first.main, second.main]).toEqual(["a/main.tex", "b/main.tex"]);
    expect(first.outDir).toBe(path.join(projectBuildDir("paper"), rootBuildFolder("a/main.tex")));
    expect(second.outDir).toBe(path.join(projectBuildDir("paper"), rootBuildFolder("b/main.tex")));
    expect(first.outDir).not.toBe(second.outDir);
    expect(diagnostics.publish).toHaveBeenNthCalledWith(1, path.join("/p/paper", "a/main.tex"), [expect.objectContaining({ message: "a/main.tex" })]);
    expect(diagnostics.publish).toHaveBeenNthCalledWith(2, path.join("/p/paper", "b/main.tex"), [expect.objectContaining({ message: "b/main.tex" })]);
  });

  it("aborts the running build of one root when another root of the project is requested", async () => {
    const { builds } = setup();
    const signals: AbortSignal[] = [];
    run.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ status: "cancelled" })));
    });
    run.mockResolvedValue({ status: "succeeded", pdf: "/p/paper/b/main.pdf", problems: [] });
    const first = builds.request("/p/paper", "a/main.tex", "save");
    await new Promise((resolve) => setImmediate(resolve));
    const second = builds.request("/p/paper", "b/main.tex", "save");
    await Promise.all([first, second]);
    expect(signals[0]!.aborted).toBe(true);
    expect(run.mock.calls.map(([request]) => request.main)).toEqual(["a/main.tex", "b/main.tex"]);
  });
});

describe("BuildDiagnostics", () => {
  it("replaces the files a project's previous build reported", () => {
    const diagnostics = new BuildDiagnostics();
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
    const diagnostics = new BuildDiagnostics();
    const collection = (vscode.languages.createDiagnosticCollection as jest.Mock).mock.results.at(-1)!.value;
    diagnostics.publish("/p/a/main.tex", [{ severity: "error", message: "in a", file: "/p/a/main.tex", line: 1 }]);
    diagnostics.publish("/p/b/main.tex", [{ severity: "error", message: "in b", file: "/p/b/main.tex", line: 1 }]);
    expect(collection.delete).not.toHaveBeenCalled();
    diagnostics.publish("/p/b/main.tex", []);
    expect(collection.delete.mock.calls.map(([uri]: [vscode.Uri]) => uri.fsPath)).toEqual(["/p/b/main.tex"]);
  });
});
