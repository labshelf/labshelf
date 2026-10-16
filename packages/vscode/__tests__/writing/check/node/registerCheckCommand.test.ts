// Tests Check Before Submitting: it builds first, checks the built PDF and shows the findings in Problems per project.
import * as vscode from "vscode";

import type { CheckFinding } from "@labshelf/core";
import { checkProject } from "@labshelf/core/node";
import { CHECK_COMMAND } from "../../../../src/writing/check";
import { registerCheckCommand } from "../../../../src/writing/check/node";
import { builtPdf } from "../../../../src/writing/preview";
import { commandHandler, fakeHost, fakeProjects, openInEditor, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), checkProject: jest.fn() }));
jest.mock("../../../../src/writing/preview", () => ({ builtPdf: jest.fn() }));

const check = checkProject as jest.Mock;
const pdfFor = builtPdf as jest.Mock;
const window = vscode.window as unknown as Record<string, jest.Mock>;
const saveAll = (vscode.workspace as unknown as { saveAll: jest.Mock }).saveAll;
const pdfjs = {} as never;

const TRIO: CheckFinding[] = [
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
