// Tests Mark Version: it asks for a name, confirms a replace, builds first and snapshots the built PDF.
import * as vscode from "vscode";

import { MARK_VERSION_COMMAND, registerMarkVersionCommand } from "../../../src/writing/versions/registerMarkVersionCommand";
import { builtPdf } from "../../../src/writing/preview";
import { commandHandler, fakeHost, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/writing/preview", () => ({ builtPdf: jest.fn() }));

let mark: jest.Mock;
let list: jest.Mock;
const pdfFor = builtPdf as jest.Mock;
const window = vscode.window as unknown as Record<string, jest.Mock>;
const saveAll = (vscode.workspace as unknown as { saveAll: jest.Mock }).saveAll;

function setup(entries = [readyEntry("/p/tex"), readyEntry("/p/other")]) {
  const order: string[] = [];
  const projects = fakeProjects(entries);
  mark = projects.data.markVersion;
  list = projects.data.listVersions;
  const builders = {
    latex: { request: jest.fn(async () => { order.push("build"); return { status: "succeeded" } as const; }) },
    typst: { request: jest.fn(async () => undefined) },
  };
  saveAll.mockImplementation(async () => { order.push("saveAll"); return true; });
  list.mockResolvedValue([]);
  mark.mockImplementation(async () => { order.push("mark"); return "/p/tex/.labshelf/versions/x"; });
  const host = fakeHost();
  registerMarkVersionCommand({ context: { subscriptions: [] } as never, host, projects, builders });
  return { builders, order, host, run: commandHandler(MARK_VERSION_COMMAND) };
}

beforeEach(() => {
  jest.clearAllMocks();
  pdfFor.mockResolvedValue("/p/tex/main.pdf");
  window["showQuickPick"]!.mockResolvedValue("submitted");
  openInEditor("/p/tex/main.tex");
});

describe("labshelf.writing.markVersion", () => {
  it("saves, builds and then snapshots the built PDF under the picked name", async () => {
    const { run, order } = setup();
    await run();
    expect(order).toEqual(["saveAll", "build", "mark"]);
    expect(mark).toHaveBeenCalledWith({ folder: "/p/tex", pdfPath: "/p/tex/main.pdf", name: "submitted", now: expect.any(Date) });
    expect(window["showInformationMessage"]).toHaveBeenCalledWith("Marked version “submitted”.");
  });

  it("offers the usual milestones and a free name", async () => {
    const { run } = setup();
    await run();
    expect(window["showQuickPick"]).toHaveBeenCalledWith(["submitted", "rebuttal", "camera-ready", "Other name…"], expect.any(Object));
  });

  it("asks for a free name and accepts only names that have a slug", async () => {
    const { run } = setup();
    window["showQuickPick"]!.mockResolvedValue("Other name…");
    window["showInputBox"]!.mockResolvedValue("  Réponse 2 ");
    await run();
    const { validateInput } = window["showInputBox"]!.mock.calls[0]![0];
    expect(validateInput("Réponse 2")).toBeUndefined();
    expect(validateInput("   ")).toEqual(expect.any(String));
    expect(mark).toHaveBeenCalledWith(expect.objectContaining({ name: "Réponse 2" }));
  });

  it("does nothing when the user cancels the name", async () => {
    const { run, builders } = setup();
    window["showQuickPick"]!.mockResolvedValue(undefined);
    await run();
    expect(builders.latex.request).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
  });

  it("confirms before replacing a version of the same slug and stops when declined", async () => {
    const { run, builders } = setup();
    list.mockResolvedValue([{ slug: "submitted", name: "Submitted" }]);
    window["showWarningMessage"]!.mockResolvedValue(undefined);
    await run();
    expect(window["showWarningMessage"]).toHaveBeenCalledWith("Replace version “Submitted”?", expect.objectContaining({ modal: true }), "Replace");
    expect(builders.latex.request).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
  });

  it("replaces the version once confirmed", async () => {
    const { run } = setup();
    list.mockResolvedValue([{ slug: "submitted", name: "Submitted" }]);
    window["showWarningMessage"]!.mockResolvedValue("Replace");
    await run();
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("does not ask to replace when the slug differs", async () => {
    const { run } = setup();
    list.mockResolvedValue([{ slug: "rebuttal", name: "rebuttal" }]);
    await run();
    expect(window["showWarningMessage"]).not.toHaveBeenCalled();
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("stops without a snapshot when the build did not succeed", async () => {
    const { run, builders } = setup();
    builders.latex.request.mockResolvedValue({ status: "failed" } as never);
    await run();
    expect(window["showWarningMessage"]).toHaveBeenCalledWith(expect.stringContaining("successful build"));
    expect(mark).not.toHaveBeenCalled();
  });

  it("asks for a build when the built PDF is missing", async () => {
    const { run } = setup();
    pdfFor.mockResolvedValue(undefined);
    await run();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("Build the project first"));
    expect(mark).not.toHaveBeenCalled();
  });

  it("uses the project of the tree row it is run on, with its own format's builder", async () => {
    const { run, builders } = setup();
    openInEditor("/elsewhere/a.tex");
    await run(readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }));
    expect(builders.typst.request).toHaveBeenCalledWith("/p/typ", "main.typ", "command");
  });

  it("asks to open a project file when the active file is outside every project", async () => {
    const { run } = setup();
    openInEditor("/elsewhere/a.tex");
    await run();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("writing project"));
    expect(window["showQuickPick"]).not.toHaveBeenCalled();
  });

  it("logs a failed snapshot and shows the failure", async () => {
    const { run, host } = setup();
    const failure = new Error("disk full");
    mark.mockRejectedValue(failure);
    await run();
    expect(host.session.logger.error).toHaveBeenCalledWith(expect.any(String), failure, expect.objectContaining({ commandName: MARK_VERSION_COMMAND }));
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });
});
