// Tests Compare Versions: its pickers, the build before a current-build comparison, the latexdiff option and the marks on both readers.
import * as vscode from "vscode";

import { listVersions } from "@labshelf/core";
import { buildMarkedUpDiff, comparePdfs, findExecutable } from "@labshelf/core/node";
import { ReaderPanel } from "../../../../src/reader";
import { ensureToolchain } from "../../../../src/writing/build/node";
import { COMPARE_VERSIONS_COMMAND, registerCompareVersionsCommand } from "../../../../src/writing/versions/node";
import { builtPdf } from "../../../../src/writing/preview";
import { commandHandler, fakeHost, fakeProjects, openInEditor, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), listVersions: jest.fn(), createPreviewStore: jest.fn(() => ({})) }));
jest.mock("@labshelf/core/node", () => ({
  ...jest.requireActual("@labshelf/core/node"),
  buildMarkedUpDiff: jest.fn(), comparePdfs: jest.fn(), findExecutable: jest.fn(),
}));
jest.mock("../../../../src/writing/preview", () => ({ builtPdf: jest.fn() }));
jest.mock("../../../../src/reader", () => ({ ReaderPanel: { createOrShow: jest.fn() } }));
jest.mock("../../../../src/writing/build/node", () => ({ ...jest.requireActual("../../../../src/writing/build/node"), ensureToolchain: jest.fn() }));

const compare = comparePdfs as jest.Mock;
const markedUp = buildMarkedUpDiff as jest.Mock;
const latexdiff = findExecutable as jest.Mock;
const list = listVersions as jest.Mock;
const pdfFor = builtPdf as jest.Mock;
const toolchain = ensureToolchain as jest.Mock;
const createOrShow = ReaderPanel.createOrShow as jest.Mock;
const window = vscode.window as unknown as Record<string, jest.Mock>;
const saveAll = (vscode.workspace as unknown as { saveAll: jest.Mock }).saveAll;

const VERSIONS = [
  { slug: "submitted", name: "submitted", created: "2026-01-01T00:00:00Z", pdfPath: "/p/tex/.labshelf/versions/submitted/main.pdf", sourcesDir: "/p/tex/.labshelf/versions/submitted/sources" },
  { slug: "rebuttal", name: "Rebuttal", created: "2026-02-01T00:00:00Z", pdfPath: "/p/tex/.labshelf/versions/rebuttal/main.pdf", sourcesDir: "/p/tex/.labshelf/versions/rebuttal/sources" },
];
const CHANGES = { before: [{ page: 1, left: 0, top: 0, right: 1, bottom: 1 }], after: [{ page: 2, left: 0, top: 0, right: 1, bottom: 1 }, { page: 3, left: 0, top: 0, right: 1, bottom: 1 }] };

function picks(...labels: string[]): void {
  const queue = [...labels];
  window["showQuickPick"]!.mockImplementation(async (items: Array<{ label: string }>) => {
    const label = queue.shift();
    return items.find((item) => item.label === label);
  });
}

function setup(entries = [readyEntry("/p/tex")]) {
  const order: string[] = [];
  const builders = {
    latex: { request: jest.fn(async () => { order.push("build"); return { status: "succeeded" } as const; }) },
    typst: { request: jest.fn(async () => undefined) },
  };
  saveAll.mockImplementation(async () => { order.push("saveAll"); return true; });
  const host = fakeHost();
  registerCompareVersionsCommand({
    context: { subscriptions: [], extensionUri: vscode.Uri.file("/ext"), globalStorageUri: vscode.Uri.file("/storage") } as never,
    host, tex: {} as never, projects: fakeProjects(entries), builders, pdfjs: {} as never, reader: { locatePdfjs: jest.fn(), isMac: false },
  });
  return {
    builders, order, host, run: commandHandler(COMPARE_VERSIONS_COMMAND),
    compareWithCurrent: () => commandHandler("labshelf.writing.compareWithCurrent"),
    compareWith: () => commandHandler("labshelf.writing.compareWith"),
    openVersion: () => commandHandler("labshelf.writing.openVersion"),
  };
}

const panels = new Map<string, { controller: { showChanges: jest.Mock; reloadDocument: jest.Mock } }>();

beforeEach(() => {
  jest.clearAllMocks();
  panels.clear();
  createOrShow.mockImplementation((_deps: unknown, source: { key: string }) => {
    const panel = panels.get(source.key) ?? { controller: { showChanges: jest.fn(), reloadDocument: jest.fn() } };
    panels.set(source.key, panel);
    return panel;
  });
  list.mockResolvedValue(VERSIONS);
  compare.mockResolvedValue(CHANGES);
  latexdiff.mockResolvedValue(undefined);
  pdfFor.mockResolvedValue("/p/tex/main.pdf");
  toolchain.mockResolvedValue({ engine: "pdflatex", executable: "/tex/latexmk" });
  markedUp.mockResolvedValue("/cache/compare/diff.pdf");
  openInEditor("/p/tex/main.tex");
});

describe("labshelf.writing.compareVersions", () => {
  it("compares two versions without building and marks each reader with its own side", async () => {
    const { run, builders, host } = setup();
    picks("submitted", "Rebuttal");
    await run();
    expect(builders.latex.request).not.toHaveBeenCalled();
    expect(compare).toHaveBeenCalledWith({}, VERSIONS[0]!.pdfPath, VERSIONS[1]!.pdfPath, host.session.logger);
    expect(panels.get("compare:/p/tex:submitted")!.controller.showChanges).toHaveBeenCalledWith(CHANGES.before);
    expect(panels.get("compare:/p/tex:rebuttal")!.controller.showChanges).toHaveBeenCalledWith(CHANGES.after);
    expect(window["showInformationMessage"]).toHaveBeenCalledWith("Found 3 changed regions.");
  });

  it("opens the base in the active column and the other beside it, titled with the project", async () => {
    const { run } = setup();
    picks("submitted", "Rebuttal");
    await run();
    const [base, other] = createOrShow.mock.calls.map(([, source]) => source);
    expect(base.show).toBe(vscode.ViewColumn.Active);
    expect(other.show).toEqual({ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    expect(base.paper).toEqual(expect.objectContaining({ id: "compare:tex:submitted", title: "submitted — tex" }));
    expect(other.paper.title).toBe("Rebuttal — tex");
  });

  it("offers the current build first and the other versions, never the base", async () => {
    const { run } = setup();
    picks("submitted", undefined as never);
    await run();
    const second = window["showQuickPick"]!.mock.calls[1]![0].map((item: { label: string }) => item.label);
    expect(second).toEqual(["Current build", "Rebuttal"]);
  });

  it("saves and builds before comparing with the current build", async () => {
    const { run, order } = setup();
    compare.mockImplementation(async () => { order.push("compare"); return CHANGES; });
    picks("submitted", "Current build");
    await run();
    expect(order).toEqual(["saveAll", "build", "compare"]);
    expect(compare).toHaveBeenCalledWith({}, VERSIONS[0]!.pdfPath, "/p/tex/main.pdf", expect.anything());
    expect(panels.get("compare:/p/tex:current")!.controller.showChanges).toHaveBeenCalledWith(CHANGES.after);
  });

  it("reloads a reader a previous comparison left open before marking it again", async () => {
    const { run } = setup();
    picks("submitted", "Current build", "submitted", "Current build");
    await run();
    await run();
    expect(panels.get("compare:/p/tex:current")!.controller.reloadDocument).toHaveBeenCalledTimes(1);
    expect(panels.get("compare:/p/tex:current")!.controller.showChanges).toHaveBeenCalledTimes(2);
  });

  it("stops when the build for the current side fails", async () => {
    const { run, builders } = setup();
    builders.latex.request.mockResolvedValue({ status: "failed" } as never);
    picks("submitted", "Current build");
    await run();
    expect(window["showWarningMessage"]).toHaveBeenCalledWith(expect.stringContaining("successful build"));
    expect(compare).not.toHaveBeenCalled();
  });

  it("says there is nothing to compare when no version is marked", async () => {
    const { run } = setup();
    list.mockResolvedValue([]);
    await run();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith("Mark a version first with Research: Mark Version.");
    expect(window["showQuickPick"]).not.toHaveBeenCalled();
  });

  it("reports when nothing changed", async () => {
    const { run } = setup();
    compare.mockResolvedValue({ before: [], after: [] });
    picks("submitted", "Rebuttal");
    await run();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith("No changes found.");
  });

  it("logs a failed comparison and shows the failure", async () => {
    const { run, host } = setup();
    const failure = new Error("bad pdf");
    compare.mockRejectedValue(failure);
    picks("submitted", "Rebuttal");
    await run();
    expect(host.session.logger.error).toHaveBeenCalledWith(expect.any(String), failure, expect.objectContaining({ commandName: COMPARE_VERSIONS_COMMAND }));
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("bad pdf"));
    expect(createOrShow).not.toHaveBeenCalled();
  });

  it("does not offer latexdiff to a Typst project or a machine without it", async () => {
    const { run } = setup([readyEntry("/p/tex"), readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } })]);
    latexdiff.mockResolvedValue("/tex/latexdiff");
    picks("submitted", "Rebuttal");
    await run(readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }));
    expect(window["showQuickPick"]).toHaveBeenCalledTimes(2);
    latexdiff.mockResolvedValue(undefined);
    picks("submitted", "Rebuttal");
    window["showQuickPick"]!.mockClear();
    await run();
    expect(window["showQuickPick"]).toHaveBeenCalledTimes(2);
  });

  it("offers latexdiff for a LaTeX project and highlights when that is chosen", async () => {
    const { run } = setup();
    latexdiff.mockResolvedValue("/tex/latexdiff");
    picks("submitted", "Rebuttal", "Highlight changed pages");
    await run();
    const third = window["showQuickPick"]!.mock.calls[2]![0].map((item: { label: string }) => item.label);
    expect(third).toEqual(["Highlight changed pages", "Marked-up PDF (latexdiff)"]);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(markedUp).not.toHaveBeenCalled();
  });

  it("builds a marked-up PDF from the two source folders and opens it in one reader", async () => {
    const { run, host } = setup();
    latexdiff.mockResolvedValue("/tex/latexdiff");
    picks("submitted", "Current build", "Marked-up PDF (latexdiff)");
    await run();
    expect(compare).not.toHaveBeenCalled();
    expect(markedUp).toHaveBeenCalledWith(expect.objectContaining({
      beforeDir: VERSIONS[0]!.sourcesDir, afterDir: "/p/tex", main: "main.tex", toolchain: { engine: "pdflatex", executable: "/tex/latexmk" },
      outDir: expect.stringMatching(/compare[\\/]submitted-vs-current$/),
    }), host.session.logger);
    expect(createOrShow).toHaveBeenCalledTimes(1);
    expect(createOrShow.mock.calls[0]![1]).toEqual(expect.objectContaining({ pdfUri: expect.objectContaining({ fsPath: "/cache/compare/diff.pdf" }) }));
    expect(createOrShow.mock.calls[0]![1].key).toBe("compare:/p/tex:submitted-vs-current:marked-up");
    expect(panels.get("compare:/p/tex:submitted-vs-current:marked-up")!.controller.showChanges).not.toHaveBeenCalled();
  });

  it("logs a failed marked-up build and shows the failure", async () => {
    const { run, host } = setup();
    latexdiff.mockResolvedValue("/tex/latexdiff");
    const failure = new Error("latexdiff failed");
    markedUp.mockRejectedValue(failure);
    picks("submitted", "Rebuttal", "Marked-up PDF (latexdiff)");
    await run();
    expect(host.session.logger.error).toHaveBeenCalledWith(expect.any(String), failure, expect.anything());
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("latexdiff failed"));
    expect(createOrShow).not.toHaveBeenCalled();
  });

  it("asks to open a project file when the active file is outside every project", async () => {
    const { run } = setup();
    openInEditor("/elsewhere/a.tex");
    await run();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("writing project"));
    expect(list).not.toHaveBeenCalled();
  });

  it("does nothing when the user cancels a picker", async () => {
    const { run } = setup();
    picks("submitted");
    await run();
    expect(compare).not.toHaveBeenCalled();
    expect(createOrShow).not.toHaveBeenCalled();
  });
});
