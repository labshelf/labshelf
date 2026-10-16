// Tests the LaTeX Workshop notice: once per workspace, only with the extension and a LaTeX project, and the button's setting.
import * as vscode from "vscode";

import { registerLatexWorkshopNotice } from "../../../src/writing/build";
import { fakeHost, fakeLogger, openInEditor, readyEntry } from "../../support/writingFixtures";

const info = vscode.window.showInformationMessage as jest.Mock;
const getExtension = vscode.extensions.getExtension as jest.Mock;
const configUpdate = (vscode.workspace as unknown as { _configUpdate: jest.Mock })._configUpdate;
const BUTTON = "Turn off its auto build";

function setup(format: "latex" | "typst" = "latex", seenBefore = false) {
  const state = new Map<string, unknown>(seenBefore ? [["labshelf.writing.latexWorkshopNoticeShown", true]] : []);
  const context = {
    subscriptions: [] as { dispose: () => void }[],
    workspaceState: { get: (key: string) => state.get(key), update: jest.fn(async (key: string, value: unknown) => { state.set(key, value); }) },
  };
  const logger = fakeLogger();
  const projects = { list: () => [readyEntry("/code/repo", { settings: { id: "repo", format } })] };
  registerLatexWorkshopNotice({ context: context as never, host: fakeHost(logger), projects });
  registered.push(context);
  return { context, logger };
}

const registered: { subscriptions: { dispose: () => void }[] }[] = [];
const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  registered.splice(0).forEach((context) => context.subscriptions.forEach((subscription) => subscription.dispose()));
});

beforeEach(() => {
  jest.clearAllMocks();
  getExtension.mockReturnValue({ id: "James-Yu.latex-workshop" });
  (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: vscode.Uri.file("/code") }];
  openInEditor("/elsewhere/a.tex");
});

describe("registerLatexWorkshopNotice", () => {
  it("shows once per workspace, whatever the answer", async () => {
    const { context } = setup();
    openInEditor("/code/repo/a.tex");
    await flush();
    openInEditor("/code/repo/b.tex");
    await flush();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]).toEqual([expect.stringContaining("LaTeX Workshop is also installed"), BUTTON]);
    expect(context.workspaceState.update).toHaveBeenCalledWith("labshelf.writing.latexWorkshopNoticeShown", true);
    expect(configUpdate).not.toHaveBeenCalled();
  });

  it("stays quiet when the workspace already saw it", async () => {
    setup("latex", true);
    openInEditor("/code/repo/a.tex");
    await flush();
    expect(info).not.toHaveBeenCalled();
  });

  it("stays quiet without LaTeX Workshop", async () => {
    getExtension.mockReturnValue(undefined);
    setup();
    openInEditor("/code/repo/a.tex");
    await flush();
    expect(info).not.toHaveBeenCalled();
  });

  it("stays quiet outside projects and for non-file documents", async () => {
    setup();
    openInEditor("/elsewhere/a.tex");
    openInEditor("/code/repo/a.tex", "untitled");
    await flush();
    expect(info).not.toHaveBeenCalled();
  });

  it("stays quiet in Typst projects", async () => {
    setup("typst");
    openInEditor("/code/repo/a.typ");
    await flush();
    expect(info).not.toHaveBeenCalled();
  });

  it("writes latex.autoBuild.run: never to the Workspace target on the button", async () => {
    info.mockResolvedValueOnce(BUTTON);
    const { logger } = setup();
    openInEditor("/code/repo/a.tex");
    await flush();
    expect(configUpdate).toHaveBeenCalledWith("latex-workshop", "latex.autoBuild.run", "never", vscode.ConfigurationTarget.Workspace);
    expect(logger.log).toHaveBeenCalledWith("INFO", "writing/build", "Turned off LaTeX Workshop auto build", expect.anything());
  });

  it("writes to the Global target when no folder is open", async () => {
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
    info.mockResolvedValueOnce(BUTTON);
    setup();
    openInEditor("/code/repo/a.tex");
    await flush();
    expect(configUpdate).toHaveBeenCalledWith("latex-workshop", "latex.autoBuild.run", "never", vscode.ConfigurationTarget.Global);
  });

  it("logs and reports a failed write", async () => {
    info.mockResolvedValueOnce(BUTTON);
    configUpdate.mockRejectedValueOnce(new Error("read-only settings"));
    const { logger } = setup();
    openInEditor("/code/repo/a.tex");
    await flush();
    expect(logger.error).toHaveBeenCalledWith("writing/build", expect.any(Error), expect.objectContaining({ target: vscode.ConfigurationTarget.Workspace }));
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("read-only settings"));
  });
});
