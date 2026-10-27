// Tests what LaTeX builds show in the editor and Check Before Submitting: results, diagnostics, preview notices, dismissed toolchain setups, failures and the findings.
import * as path from "node:path";
import * as vscode from "vscode";

import type { CheckProblem } from "@labshelf/core";
import { checkProject } from "@labshelf/core/node";
import { BuildProblems } from "../../../../src/writing/build/builds";
import { CHECK_COMMAND } from "../../../../src/writing/build/index";
import { LatexBuilds, registerCheckCommand } from "../../../../src/writing/build/node/builds";
import { reportToolchainMissing } from "../../../../src/writing/build/node/toolchain";
import { readBuiltPdf } from "../../../../src/writing/preview";
import { commandHandler, fakeHost, fakeProjects, openInEditor, readyEntry } from "../../../support/writingFixtures";

jest.mock("../../../../src/writing/build/node/toolchain", () => ({ ...jest.requireActual("../../../../src/writing/build/node/toolchain"), reportToolchainMissing: jest.fn() }));
jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), checkProject: jest.fn() }));
jest.mock("../../../../src/writing/preview", () => ({ readBuiltPdf: jest.fn() }));

// Tests what LaTeX builds show in the editor: result, diagnostics, preview notices, dismissed toolchain setups and failures.
describe("registerLatexBuild", () => {
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
});

// Tests Check Before Submitting: it builds first, checks the built PDF and shows the findings in Problems per project.
describe("registerCheckCommand", () => {
  const check = checkProject as jest.Mock;
  const pdfFor = readBuiltPdf as jest.Mock;
  const window = vscode.window as unknown as Record<string, jest.Mock>;
  const saveAll = (vscode.workspace as unknown as { saveAll: jest.Mock }).saveAll;
  const pdfjs = {} as never;

  const TRIO: CheckProblem[] = [
    { rule: "pages", severity: "error", message: "The document has 9 pages; the limit is 8.", location: { kind: "pdf" } },
    { rule: "anonymity", severity: "error", message: "The PDF Author field names the author.", location: { kind: "pdf" } },
    { rule: "fonts", severity: "warning", message: "Type 3 font in use.", location: { kind: "pdf", page: 1 } },
  ];

  function setup(entries = [readyEntry("/p/tex"), readyEntry("/p/other")], onFindings?: (folder: string, count: number) => void) {
    const order: string[] = [];
    const builders = {
      latex: { request: jest.fn(async () => { order.push("build"); return { status: "succeeded", pdf: "/p/tex/main.pdf", problems: [] } as const; }) },
      typst: { request: jest.fn(async () => undefined) },
    };
    saveAll.mockImplementation(async () => { order.push("saveAll"); return true; });
    check.mockImplementation(async () => { order.push("check"); return TRIO; });
    const host = fakeHost();
    registerCheckCommand({ context: { subscriptions: [] } as never, host, projects: fakeProjects(entries), builders, pdfjs, ...(onFindings ? { onFindings } : {}) });
    const collection = (vscode.languages.createDiagnosticCollection as jest.Mock).mock.results.at(-1)!.value;
    return { builders, order, host, collection, run: commandHandler(CHECK_COMMAND) };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    pdfFor.mockResolvedValue("/p/tex/main.pdf");
    openInEditor("/p/tex/main.tex");
  });

  describe("labshelf.writing.checkBeforeSubmitting", () => {
    it("saves, builds and then checks the built PDF with the project's check settings", async () => {
      const { run, order, host } = setup([readyEntry("/p/tex", { settings: { id: "tex", format: "latex", check: { pages: 8 } } as never })]);
      await run();
      expect(order).toEqual(["saveAll", "build", "check"]);
      expect(check).toHaveBeenCalledWith({ folder: "/p/tex", pdfPath: "/p/tex/main.pdf", settings: { pages: 8 } }, pdfjs, host.session.logger);
    });

    it("maps whole-document and page findings onto the PDF, with the page in the message", async () => {
      const { run, collection } = setup();
      await run();
      const [uri, diagnostics] = collection.set.mock.calls[0];
      expect(uri.fsPath).toBe("/p/tex/main.pdf");
      expect(diagnostics.map((d: vscode.Diagnostic) => [d.message, d.severity, d.source, d.range.start.line])).toEqual([
        [TRIO[0]!.message, vscode.DiagnosticSeverity.Error, "LabShelf check", 0],
        [TRIO[1]!.message, vscode.DiagnosticSeverity.Error, "LabShelf check", 0],
        [`Page 1: ${TRIO[2]!.message}`, vscode.DiagnosticSeverity.Warning, "LabShelf check", 0],
      ]);
    });

    it("maps a source finding onto its file and 1-based line", async () => {
      const { run, collection } = setup();
      check.mockResolvedValue([{ rule: "anonymity", severity: "error", message: "Thanks reveals the author.", location: { kind: "source", file: "/p/tex/main.tex", line: 12 } }]);
      await run();
      const [uri, [diagnostic]] = collection.set.mock.calls[0];
      expect(uri.fsPath).toBe("/p/tex/main.tex");
      expect(diagnostic.range.start.line).toBe(11);
      expect(diagnostic.message).toBe("Thanks reveals the author.");
    });

    it("replaces the previous findings of the project on the next run and leaves other projects alone", async () => {
      const { run, collection } = setup();
      await run();
      check.mockResolvedValue([]);
      await run();
      expect(collection.delete).toHaveBeenCalledTimes(1);
      expect(collection.delete.mock.calls[0][0].fsPath).toBe("/p/tex/main.pdf");
      openInEditor("/p/other/main.tex");
      pdfFor.mockResolvedValue("/p/other/main.pdf");
      await run();
      expect(collection.delete).toHaveBeenCalledTimes(1);
    });

    it("opens Problems and reports the count", async () => {
      const { run } = setup();
      await run();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.actions.view.problems");
      expect(window["showInformationMessage"]).toHaveBeenCalledWith("3 problems found before submitting.");
      check.mockResolvedValue([TRIO[0]]);
      await run();
      expect(window["showInformationMessage"]).toHaveBeenLastCalledWith("1 problem found before submitting.");
    });

    it("reports the finding count of the project to onFindings, zero included", async () => {
      const onFindings = jest.fn();
      const { run } = setup(undefined, onFindings);
      await run();
      expect(onFindings).toHaveBeenLastCalledWith("/p/tex", 3);
      check.mockResolvedValue([]);
      await run();
      expect(onFindings).toHaveBeenLastCalledWith("/p/tex", 0);
    });

    it("does not report when the build fails", async () => {
      const onFindings = jest.fn();
      const { run, builders } = setup(undefined, onFindings);
      builders.latex.request.mockResolvedValue({ status: "failed", problems: [] } as never);
      await run();
      expect(onFindings).not.toHaveBeenCalled();
    });

    it("says so when nothing is found, without opening Problems", async () => {
      const { run } = setup();
      check.mockResolvedValue([]);
      await run();
      expect(window["showInformationMessage"]).toHaveBeenCalledWith("No problems found before submitting.");
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it("stops without checking when the build did not succeed", async () => {
      const { run, builders } = setup();
      builders.latex.request.mockResolvedValue({ status: "failed", problems: [] } as never);
      await run();
      expect(window["showWarningMessage"]).toHaveBeenCalledWith(expect.stringContaining("successful build"));
      expect(check).not.toHaveBeenCalled();
    });

    it("asks for a build when the built PDF is missing", async () => {
      const { run } = setup();
      pdfFor.mockResolvedValue(undefined);
      await run();
      expect(window["showInformationMessage"]).toHaveBeenCalledWith("Build the project first; the check reads its PDF.");
      expect(check).not.toHaveBeenCalled();
    });

    it("uses the project of the tree row it is run on, with its own format's builder", async () => {
      const { run, builders } = setup();
      openInEditor("/elsewhere/a.tex");
      await run(readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }));
      expect(builders.typst.request).toHaveBeenCalledWith("/p/typ", "main.typ", "command");
    });

    it("asks to open a project file when the active file is outside every project", async () => {
      const { run, builders } = setup();
      openInEditor("/elsewhere/a.tex");
      await run();
      expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("writing project"));
      expect(builders.latex.request).not.toHaveBeenCalled();
    });

    it("logs a check that cannot read the PDF and shows the failure", async () => {
      const { run, host } = setup();
      const failure = new Error("Invalid PDF");
      check.mockRejectedValue(failure);
      await run();
      expect(host.session.logger.error).toHaveBeenCalledWith(expect.any(String), failure, expect.objectContaining({ commandName: CHECK_COMMAND }));
      expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("Invalid PDF"));
    });
  });
});
