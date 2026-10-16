// Tests the Tinymist bridge: the one-time install offer, and pinning the main file only when it changes.
import * as vscode from "vscode";

import { registerTinymistBridge, tinymistInstalled } from "../../../../src/writing/typst/tinymist";
import { fakeHost, fakeLogger, openInEditor, readyEntry } from "../../../support/writingFixtures";

const info = vscode.window.showInformationMessage as jest.Mock;
const exec = vscode.commands.executeCommand as jest.Mock;
const getExtension = vscode.extensions.getExtension as jest.Mock;
const INSTALL = "Install Tinymist";
const SHOWN_KEY = "labshelf.writing.tinymistOfferShown";

type Entry = ReturnType<typeof readyEntry>;
const typstProject = (main = "main.typ"): Entry =>
  readyEntry("/code/repo", { settings: { id: "repo", format: "typst" }, main });
const latexProject = (): Entry => readyEntry("/code/repo", { settings: { id: "repo", format: "latex" } });

const registered: { subscriptions: { dispose: () => void }[] }[] = [];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(initial: Entry[], seenBefore = false) {
  let entries = initial;
  const listeners: (() => void)[] = [];
  const state = new Map<string, unknown>(seenBefore ? [[SHOWN_KEY, true]] : []);
  const context = {
    subscriptions: [] as { dispose: () => void }[],
    workspaceState: { get: (key: string) => state.get(key), update: jest.fn(async (key: string, value: unknown) => { state.set(key, value); }) },
  };
  const logger = fakeLogger();
  const projects = {
    list: () => entries,
    onDidChange: (handler: () => void) => { listeners.push(handler); return { dispose: () => {} }; },
  };
  registerTinymistBridge(context as never, { host: fakeHost(logger), projects: projects as never });
  registered.push(context);
  return { context, logger, setEntries: (next: Entry[]) => { entries = next; listeners.forEach((l) => l()); } };
}

afterEach(() => {
  registered.splice(0).forEach((context) => context.subscriptions.forEach((subscription) => subscription.dispose()));
});

beforeEach(() => {
  jest.clearAllMocks();
  getExtension.mockReturnValue(undefined);
  openInEditor("/elsewhere/a.typ");
});

describe("install offer", () => {
  it("shows once per workspace in a Typst project without Tinymist", async () => {
    const { context } = setup([typstProject()]);
    openInEditor("/code/repo/main.typ");
    await flush();
    openInEditor("/code/repo/other.typ");
    await flush();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]).toEqual([expect.stringContaining("completion and errors"), INSTALL, "Not now"]);
    expect(info.mock.calls[0][0]).toContain("LabShelf shows the preview");
    expect(context.workspaceState.update).toHaveBeenCalledWith(SHOWN_KEY, true);
    expect(exec).not.toHaveBeenCalled();
  });

  it("stays quiet when the workspace already saw it", async () => {
    setup([typstProject()], true);
    openInEditor("/code/repo/main.typ");
    await flush();
    expect(info).not.toHaveBeenCalled();
  });

  it("stays quiet when Tinymist is installed", async () => {
    getExtension.mockReturnValue({ id: "myriad-dreamin.tinymist" });
    setup([typstProject()]);
    openInEditor("/code/repo/main.typ");
    await flush();
    expect(info).not.toHaveBeenCalled();
  });

  it("stays quiet in LaTeX projects and outside projects", async () => {
    setup([latexProject()]);
    openInEditor("/code/repo/a.tex");
    openInEditor("/elsewhere/a.typ");
    await flush();
    expect(info).not.toHaveBeenCalled();
  });

  it("installs the extension on the button", async () => {
    info.mockResolvedValueOnce(INSTALL);
    setup([typstProject()]);
    openInEditor("/code/repo/main.typ");
    await flush();
    expect(exec).toHaveBeenCalledWith("workbench.extensions.installExtension", "myriad-dreamin.tinymist");
  });

  it("logs and reports a failed install", async () => {
    info.mockResolvedValueOnce(INSTALL);
    exec.mockRejectedValueOnce(new Error("offline"));
    const { logger } = setup([typstProject()]);
    openInEditor("/code/repo/main.typ");
    await flush();
    expect(logger.error).toHaveBeenCalledWith("writing/typst", expect.any(Error), expect.anything());
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });
});

describe("main pin", () => {
  beforeEach(() => { getExtension.mockReturnValue({ id: "myriad-dreamin.tinymist" }); });

  it("pins the project's main file when the editor moves into the project", async () => {
    setup([typstProject("src/thesis.typ")]);
    openInEditor("/code/repo/src/chapter.typ");
    await flush();
    expect(exec).toHaveBeenCalledWith("tinymist.pinMain", "/code/repo/src/thesis.typ");
  });

  it("pins again only when the main file changes", async () => {
    const { setEntries } = setup([typstProject()]);
    openInEditor("/code/repo/main.typ");
    openInEditor("/code/repo/other.typ");
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);
    setEntries([typstProject("paper.typ")]);
    await flush();
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenLastCalledWith("tinymist.pinMain", "/code/repo/paper.typ");
  });

  it("does not pin without Tinymist", async () => {
    getExtension.mockReturnValue(undefined);
    setup([typstProject()]);
    openInEditor("/code/repo/main.typ");
    await flush();
    expect(exec).not.toHaveBeenCalled();
  });

  it("does not pin for LaTeX projects", async () => {
    setup([latexProject()]);
    openInEditor("/code/repo/main.tex");
    await flush();
    expect(exec).not.toHaveBeenCalled();
  });

  it("does not pin a project without a main file", async () => {
    setup([readyEntry("/code/repo", { settings: { id: "repo", format: "typst" }, main: undefined })]);
    openInEditor("/code/repo/x.typ");
    await flush();
    expect(exec).not.toHaveBeenCalled();
  });

  it("logs a failed pin and retries on the next change", async () => {
    exec.mockRejectedValueOnce(new Error("server not ready"));
    const { logger } = setup([typstProject()]);
    openInEditor("/code/repo/main.typ");
    await flush();
    expect(logger.error).toHaveBeenCalledWith("writing/typst", expect.any(Error), expect.objectContaining({ main: "/code/repo/main.typ" }));
    openInEditor("/code/repo/other.typ");
    await flush();
    expect(exec).toHaveBeenCalledTimes(2);
  });
});

describe("tinymistInstalled", () => {
  it("reflects whether the extension is present", () => {
    expect(tinymistInstalled()).toBe(false);
    getExtension.mockReturnValue({ id: "myriad-dreamin.tinymist" });
    expect(tinymistInstalled()).toBe(true);
  });
});
