// Tests the preview of a Typst project: whether one is open, and that source links explain they are LaTeX-only.
import * as vscode from "vscode";

import { ReaderPanel } from "../../../src/pdf-viewer";
import { BuildPreviews } from "../../../src/writing/preview";
import { fakeHost, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/pdf-viewer", () => ({ ReaderPanel: { createOrShow: jest.fn() } }));

const create = ReaderPanel.createOrShow as jest.Mock;
type Project = Parameters<BuildPreviews["finished"]>[0];
const typst = readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }) as Project;
const message = vscode.window.showInformationMessage as jest.Mock;
const TYPST_MESSAGE = expect.stringContaining("works in LaTeX projects");

function setup() {
  const host = fakeHost();
  const controller = { setBuildStatus: jest.fn(), reloadDocument: jest.fn(), revealPoint: jest.fn() };
  let closed: (() => void) | undefined;
  create.mockImplementation((_deps, source) => { closed = source.onClosed; return { controller }; });
  const previews = new BuildPreviews({ host, extensionUri: vscode.Uri.file("/ext"), locatePdfjs: () => null, isMac: false });
  return { previews, controller, host, close: () => closed?.(), ports: () => create.mock.calls[0][1].preview };
}

beforeEach(() => jest.clearAllMocks());

describe("BuildPreviews.hasPreview", () => {
  it("is true after the preview is shown and false before it and after it is closed", () => {
    const { previews, close } = setup();
    expect(previews.hasPreview("/p/typ")).toBe(false);
    previews.show(typst, "/cache/typ/main.pdf", { beside: false });
    expect(previews.hasPreview("/p/typ")).toBe(true);
    expect(previews.hasPreview("/p/other")).toBe(false);
    close();
    expect(previews.hasPreview("/p/typ")).toBe(false);
  });
});

describe("Typst preview source links", () => {
  it("explains on a double-click that source links are LaTeX-only", async () => {
    const { previews, ports, host } = setup();
    previews.show(typst, "/cache/typ/main.pdf", { beside: false });
    await ports().showSource({ page: 1, x: 10, y: 10 });
    expect(message).toHaveBeenCalledWith(TYPST_MESSAGE);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(host.session.logger.log).not.toHaveBeenCalledWith("WARN", expect.anything(), "No SyncTeX data for the preview", expect.anything());
  });

  it("explains in Show in Preview that source links are LaTeX-only, and reveals nothing", async () => {
    const { previews, controller } = setup();
    previews.show(typst, "/cache/typ/main.pdf", { beside: false });
    await previews.revealSource(typst, "/p/typ/main.typ", 3);
    expect(message).toHaveBeenCalledWith(TYPST_MESSAGE);
    expect(controller.revealPoint).not.toHaveBeenCalled();
  });

  it("reloads the document after a build without reading SyncTeX data", async () => {
    const { previews, controller } = setup();
    previews.show(typst, "/cache/typ/main.pdf", { beside: false });
    previews.finished(typst, { status: "succeeded", pdf: "/cache/typ/main.pdf", problems: [] }, "save");
    expect(controller.reloadDocument).toHaveBeenCalledTimes(1);
    expect(controller.setBuildStatus).toHaveBeenLastCalledWith("succeeded");
  });
});
