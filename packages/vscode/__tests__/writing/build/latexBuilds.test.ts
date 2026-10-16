// Tests the build queue: toolchain first, one build at a time per project, newer requests cancel, dismissed setups stay quiet on save.
import * as vscode from "vscode";

import { projectBuildDir, runLatexBuild, updateProjectValues } from "@labshelf/core/node";
import { BuildDiagnostics } from "../../../src/writing/build/buildDiagnostics";
import { LatexBuilds } from "../../../src/writing/build/latexBuilds";
import { ensureToolchain } from "../../../src/writing/build/toolchain";
import { fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), runLatexBuild: jest.fn(), updateProjectValues: jest.fn() }));
jest.mock("../../../src/writing/build/toolchain", () => ({ ensureToolchain: jest.fn() }));

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
    await builds.request("/p/paper", "command");
    expect(order).toEqual(["values", "run"]);
    expect(generateValues).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper", main: "main.tex" }), expect.anything());
  });

  it("logs a failed values generation with its context and still compiles", async () => {
    const { builds, logger } = setup({ settings: { id: "paper", format: "latex", values: ["results.json"] } });
    const error = new Error("disk full");
    generateValues.mockRejectedValue(error);
    await builds.request("/p/paper", "command");
    expect(logger.error).toHaveBeenCalledWith("writing/build", error, { projectFolder: "/p/paper", action: "generate-values" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not generate values for a project without values", async () => {
    const { builds } = setup();
    await builds.request("/p/paper", "command");
    expect(generateValues).not.toHaveBeenCalled();
  });

  it("builds the main file into the project's cache folder and publishes the problems", async () => {
    const { builds, diagnostics } = setup();
    await builds.request("/p/paper", "command");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      toolchain: TOOLCHAIN, projectFolder: "/p/paper", main: "main.tex", outDir: projectBuildDir("paper"),
    }));
    expect(diagnostics.publish).toHaveBeenCalledWith("/p/paper", [expect.objectContaining({ message: "x" })]);
    expect(window["setStatusBarMessage"]).toHaveBeenLastCalledWith("$(error) Build of main.tex failed: 1 error", 5000);
  });

  it("resolves with the build's result, and with nothing for a cancelled build", async () => {
    const { builds } = setup();
    const result = { status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] };
    run.mockResolvedValue(result);
    expect(await builds.request("/p/paper", "command")).toBe(result);
    run.mockResolvedValue({ status: "cancelled" });
    expect(await builds.request("/p/paper", "command")).toBeUndefined();
  });

  it("cancels the running build on a newer request and folds a burst into one more build", async () => {
    const { builds, diagnostics } = setup();
    const signals: AbortSignal[] = [];
    run.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ status: "cancelled" })));
    });
    const first = builds.request("/p/paper", "save");
    await new Promise((resolve) => setImmediate(resolve));
    void builds.request("/p/paper", "save");
    run.mockResolvedValue({ status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] });
    const last = builds.request("/p/paper", "save");
    await Promise.all([first, last]);
    expect(signals[0]!.aborted).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(diagnostics.publish).toHaveBeenCalledTimes(1);
    expect(diagnostics.publish).toHaveBeenCalledWith("/p/paper", []);
  });

  it("tells the preview a build started and what it produced, and says nothing about a cancelled build", async () => {
    const { builds, previews } = setup();
    const order: string[] = [];
    previews.building.mockImplementation(() => order.push("building"));
    run.mockImplementation(async () => { order.push("run"); return { status: "succeeded", pdf: "/p/paper/main.pdf", problems: [] }; });
    previews.finished.mockImplementation(() => order.push("finished"));
    await builds.request("/p/paper", "command");
    expect(order).toEqual(["building", "run", "finished"]);
    expect(previews.finished).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/paper" }), expect.objectContaining({ status: "succeeded" }), "command");

    previews.finished.mockClear();
    run.mockResolvedValue({ status: "cancelled" });
    await builds.request("/p/paper", "save");
    expect(previews.finished).not.toHaveBeenCalled();
  });

  it("stops asking on save after the toolchain prompt is dismissed, and asks again on the command", async () => {
    const { builds } = setup();
    (ensureToolchain as jest.Mock).mockResolvedValue(undefined);
    await builds.request("/p/paper", "save");
    await builds.request("/p/paper", "save");
    expect(ensureToolchain).toHaveBeenCalledTimes(1);
    await builds.request("/p/paper", "command");
    expect(ensureToolchain).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("asks for a main file instead of building when the project has none", async () => {
    const { builds } = setup({ main: undefined });
    await builds.request("/p/paper", "command");
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("has no main file"));
    expect(run).not.toHaveBeenCalled();
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
});
