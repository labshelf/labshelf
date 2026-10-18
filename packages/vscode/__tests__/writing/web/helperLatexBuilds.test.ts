// Tests the web build's LaTeX builds: they compile through ILatexHelper and show the helper setup when the helper or TeX is missing.
import * as vscode from "vscode";

import { posixPathOps, type ProjectEntry } from "@labshelf/core";
import type { HelperCompileResult, HelperStatus, ILatexHelper } from "@labshelf/core/helper";
import { HelperLatexBuilds } from "../../../src/writing/web/helperLatexBuilds";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { fakeHost, readyEntry } from "../../support/writingFixtures";

const READY: HelperStatus = { state: "ready", helperVersion: "1.0.0", tex: { installed: true } } as unknown as HelperStatus;
const PDF = new Uint8Array([37, 80, 68, 70]);
const window = vscode.window as unknown as Record<string, jest.Mock>;

function fakeHelper(status: HelperStatus | Error, result: HelperCompileResult = { status: "succeeded", problems: [], pdf: PDF }): { [K in keyof ILatexHelper]: jest.Mock } {
  return {
    connect: jest.fn(async () => { if (status instanceof Error) { throw status; } return status; }),
    status: jest.fn(),
    compile: jest.fn(async () => result),
    cancel: jest.fn(),
    installTex: jest.fn(),
    installAllPackages: jest.fn(),
  };
}

async function setup(helper: ReturnType<typeof fakeHelper>, entry: ProjectEntry = readyEntry("/lib/paper", { settings: { id: "paper", format: "latex", engine: "xelatex" } })) {
  const fs = new MemoryLibraryFs();
  await fs.writeText("/lib/paper/main.tex", "\\documentclass{article}");
  await fs.writeText("/lib/paper/refs.bib", "@article{a}");
  const deps = {
    helper, host: fakeHost(), projects: { list: () => [entry], fs, paths: posixPathOps },
    diagnostics: { publish: jest.fn() }, previews: { building: jest.fn(), finished: jest.fn() }, showHelperSetup: jest.fn(async () => undefined),
  };
  return { deps, fs, builds: new HelperLatexBuilds(deps) };
}

beforeEach(() => jest.clearAllMocks());

describe("HelperLatexBuilds", () => {
  it("compiles the project's files through the helper and writes the PDF next to the root", async () => {
    const helper = fakeHelper(READY);
    const { deps, fs, builds } = await setup(helper);
    const result = await builds.request("/lib/paper", "main.tex", "command");
    const project = helper.compile.mock.calls[0]![0];
    expect(project).toEqual(expect.objectContaining({ projectId: "paper", main: "main.tex", engine: "xelatex" }));
    expect(project.files.map((file: { path: string }) => file.path).sort()).toEqual(["main.tex", "refs.bib"]);
    expect(result).toEqual({ status: "succeeded", pdf: "/lib/paper/main.pdf", problems: [] });
    expect(await fs.readFile("/lib/paper/main.pdf")).toEqual(PDF);
    expect(deps.previews.building).toHaveBeenCalledWith("/lib/paper", "main.tex");
    expect(deps.previews.finished).toHaveBeenCalledWith(expect.objectContaining({ folder: "/lib/paper" }), "main.tex", result, "command");
    expect(deps.showHelperSetup).not.toHaveBeenCalled();
  });

  it("builds with the project's engine", async () => {
    const helper = fakeHelper(READY);
    const { builds } = await setup(helper, readyEntry("/lib/paper", { settings: { id: "paper", format: "latex", engine: "lualatex" } }));
    await builds.request("/lib/paper", "main.tex", "command");
    expect(helper.compile.mock.calls[0]![0].engine).toBe("lualatex");
  });

  it("builds projects without an engine with pdfLaTeX", async () => {
    const helper = fakeHelper(READY);
    const { builds } = await setup(helper, readyEntry("/lib/paper", { settings: { id: "paper", format: "latex" } }));
    await builds.request("/lib/paper", "main.tex", "command");
    expect(helper.compile.mock.calls[0]![0].engine).toBe("pdflatex");
  });

  it("runs one build of a project at a time, and of the requests waiting meanwhile only the latest", async () => {
    const helper = fakeHelper(READY);
    const finishes: (() => void)[] = [];
    helper.compile.mockImplementation(() => new Promise((resolve) => finishes.push(() => resolve({ status: "succeeded", problems: [], pdf: PDF }))));
    const { builds } = await setup(helper);
    const first = builds.request("/lib/paper", "main.tex", "focus");
    const replaced = builds.request("/lib/paper", "main.tex", "save");
    const latest = builds.request("/lib/paper", "main.tex", "command");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(helper.compile).toHaveBeenCalledTimes(1);
    finishes[0]!();
    expect(await first).toEqual(expect.objectContaining({ status: "succeeded" }));
    expect(await replaced).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(helper.compile).toHaveBeenCalledTimes(2);
    finishes[1]!();
    expect(await latest).toEqual(expect.objectContaining({ status: "succeeded" }));
  });

  it("starts the next build after a build that threw", async () => {
    const helper = fakeHelper(READY);
    helper.compile.mockRejectedValueOnce(new Error("port closed"));
    const { builds } = await setup(helper);
    const first = builds.request("/lib/paper", "main.tex", "save");
    const second = builds.request("/lib/paper", "main.tex", "save");
    expect(await first).toBeUndefined();
    expect(await second).toEqual(expect.objectContaining({ status: "succeeded" }));
  });

  it("publishes a failed build's problems and reports it as failed", async () => {
    const problems = [{ file: "main.tex", line: 1, message: "Undefined control sequence", severity: "error" }];
    const helper = fakeHelper(READY, { status: "failed", problems } as unknown as HelperCompileResult);
    const { deps, builds } = await setup(helper);
    expect(await builds.request("/lib/paper", "main.tex", "save")).toEqual({ status: "failed", problems });
    expect(deps.diagnostics.publish).toHaveBeenCalledWith("/lib/paper/main.tex", problems);
  });

  it("shows the setup card instead of compiling when the helper is not installed", async () => {
    const helper = fakeHelper({ state: "not-installed" });
    const { deps, builds } = await setup(helper);
    expect(await builds.request("/lib/paper", "main.tex", "command")).toBeUndefined();
    expect(deps.showHelperSetup).toHaveBeenCalledTimes(1);
    expect(helper.compile).not.toHaveBeenCalled();
  });

  it("shows the setup card when the page has no helper command at all", async () => {
    const helper = fakeHelper(new Error("command 'labshelf.editorHost.latexHelper' not found"));
    const { deps, builds } = await setup(helper);
    expect(await builds.request("/lib/paper", "main.tex", "command")).toBeUndefined();
    expect(deps.showHelperSetup).toHaveBeenCalledTimes(1);
    expect(deps.host.session.logger.error).toHaveBeenCalled();
  });

  it("shows the setup card when the helper reports TeX missing", async () => {
    const helper = fakeHelper(READY, { status: "toolchain-missing", problems: [] });
    const { deps, builds } = await setup(helper);
    expect(await builds.request("/lib/paper", "main.tex", "command")).toBeUndefined();
    expect(deps.showHelperSetup).toHaveBeenCalledTimes(1);
    expect(deps.previews.finished).not.toHaveBeenCalled();
  });

  it("tells the user when the page cannot show the setup card either", async () => {
    const helper = fakeHelper({ state: "not-installed" });
    const { deps, builds } = await setup(helper);
    deps.showHelperSetup.mockRejectedValueOnce(new Error("command not found"));
    await builds.request("/lib/paper", "main.tex", "command");
    expect(window["showErrorMessage"]!.mock.calls[0]![0]).toContain("LabShelf Helper");
  });
});
