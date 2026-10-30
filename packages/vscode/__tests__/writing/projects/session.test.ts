// Tests the session module of writing projects, one describe per concern:
// - that the project store lists the library's projects, tolerates failures and keeps the newest reload.
// - the project session: opening and closing a project as a unit, its context keys, its change event and its restore after reload.
// - the Open Project and Close Project commands on the window's project session.
// - Verifies editor saves wait for ancestry records before the write and commit the final participant text.
import * as path from "node:path";
import * as vscode from "vscode";

import { NodeLibraryFileSystem } from "@labshelf/core/node";
import type { ProjectEntry } from "@labshelf/core";
import { WritingProjects, ProjectSession, registerProjectSession, registerProjectWriteEvents } from "../../../src/writing/projects/session";
import { fakeHost, fakeProjectData, readyEntry, fakeProjects, openInEditor, commandHandler, fakeLogger } from "../../support/writingFixtures";

describe("projectStore", () => {
  describe("WritingProjects", () => {
    let data: ReturnType<typeof fakeProjectData>;
    let list: jest.Mock;
    beforeEach(() => { data = fakeProjectData(); list = data.listProjects; });

    it("loads the projects of the session's library and announces the change", async () => {
      const host = fakeHost();
      const entry = readyEntry("/lib/projects/a");
      list.mockResolvedValue([entry]);
      const store = new WritingProjects(host, path, new NodeLibraryFileSystem(), data);
      const changed = jest.fn();
      store.onDidChange(changed);
      await store.reload();
      expect(list).toHaveBeenCalledWith("/lib");
      expect(store.list()).toEqual([entry]);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it("is empty while no library is configured", async () => {
      const store = new WritingProjects({ current: () => undefined }, path, new NodeLibraryFileSystem(), data);
      await store.reload();
      expect(store.list()).toEqual([]);
      expect(list).not.toHaveBeenCalled();
    });

    it("logs a failed listing and shows no projects", async () => {
      const host = fakeHost();
      list.mockRejectedValue(new Error("disk"));
      const store = new WritingProjects(host, path, new NodeLibraryFileSystem(), data);
      await store.reload();
      expect(host.session.logger.error).toHaveBeenCalledWith("writing/projects", expect.any(Error), { action: "list" });
      expect(store.list()).toEqual([]);
    });

    it("keeps the result of the newest reload when an older one finishes last", async () => {
      const store = new WritingProjects(fakeHost(), path, new NodeLibraryFileSystem(), data);
      let finishOld!: (entries: unknown[]) => void;
      list.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
      const newest = readyEntry("/lib/projects/new");
      list.mockResolvedValueOnce([newest]);
      const older = store.reload();
      await store.reload();
      finishOld([readyEntry("/lib/projects/old")]);
      await older;
      expect(store.list()).toEqual([newest]);
    });
  });
});

/** An active-source stub mirroring the native text editor: its file, no updates. */
function nativeActiveSource(onDidChange: vscode.Event<unknown>) {
  return {
    current: () => {
      const editor = vscode.window.activeTextEditor;
      return editor ? { uri: editor.document.uri } : undefined;
    },
    onDidChange,
  };
}

describe("projectSession", () => {
  const executeCommand = vscode.commands.executeCommand as jest.Mock;
  const window = vscode.window as unknown as Record<string, jest.Mock>;
  const stat = vscode.workspace.fs.stat as jest.Mock;
  const tabGroups = vscode.window.tabGroups as unknown as { all: { tabs: { input: unknown }[] }[]; close: jest.Mock };

  const a = readyEntry("/code/a");
  const b = readyEntry("/code/b");
  const sessions: ProjectSession[] = [];

  function memento(): vscode.Memento & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
      store,
      keys: () => [...store.keys()],
      get: (key: string) => store.get(key),
      update: jest.fn(async (key: string, value: unknown) => { if (value === undefined) { store.delete(key); } else { store.set(key, value); } }),
    } as never;
  }

  function setup(entries: ProjectEntry[] = [a, b], state = memento()) {
    const changed = new vscode.EventEmitter<void>();
    const projects = { ...fakeProjects(entries), onDidChange: changed.event };
    const previews = { show: jest.fn(), close: jest.fn() };
    const activeChanged = new vscode.EventEmitter<unknown>();
    const activeSource = nativeActiveSource(activeChanged.event);
    const session = new ProjectSession({ workspaceState: state, projects, previews, host: fakeHost(), activeSource: activeSource as never });
    sessions.push(session);
    return { session, projects, previews, state, changed, activeChanged };
  }

  function tab(fsPath: string): { input: unknown } {
    return { input: new vscode.TabInputText(vscode.Uri.file(fsPath)) };
  }

  /** The last value a context key was set to, or `undefined` when it was never set. */
  function contextKey(name: string): unknown {
    const calls = executeCommand.mock.calls.filter(([command, key]) => command === "setContext" && key === name);
    return calls.at(-1)?.[2];
  }

  function opened(): string[] {
    return executeCommand.mock.calls.filter(([command]) => command === "vscode.open").map(([, uri]) => uri.fsPath);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tabGroups.all = [];
    (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;
  });

  afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); });

  describe("open", () => {
    it("opens the main document and shows its built PDF beside it", async () => {
      const { session, previews } = setup();
      await session.open(a);
      expect(opened()).toEqual(["/code/a/main.tex"]);
      expect(previews.show).toHaveBeenCalledTimes(1);
      expect(previews.show).toHaveBeenCalledWith(a, "main.tex", "/code/a/main.pdf", { beside: true });
      expect(contextKey("labshelf.writing.projectOpen")).toBe(true);
      expect(session.project?.folder).toBe("/code/a");
    });

    it("builds the main document when its PDF does not exist", async () => {
      const { session, previews } = setup();
      stat.mockRejectedValueOnce(new Error("ENOENT"));
      await session.open(a);
      expect(executeCommand).toHaveBeenCalledWith("labshelf.writing.build");
      expect(previews.show).not.toHaveBeenCalled();
    });

    it("keeps the same project open when it is opened again", async () => {
      const { session, previews } = setup();
      await session.open(a);
      await session.open(a);
      expect(tabGroups.close).not.toHaveBeenCalled();
      expect(previews.close).not.toHaveBeenCalled();
      expect(previews.show.mock.calls.every(([project]) => project.folder === "/code/a")).toBe(true);
    });

    it("tells the user when the project has no main file", async () => {
      const noMain = readyEntry("/code/c", { main: undefined });
      const { session, previews } = setup([noMain]);
      await session.open(noMain);
      expect(opened()).toEqual([]);
      expect(previews.show).not.toHaveBeenCalled();
      expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("no main file"));
    });

    it("ignores a project that is not ready", async () => {
      const { session } = setup();
      await session.open({ kind: "broken", folder: "/gone", location: "external", reason: "folder not found" });
      expect(executeCommand).not.toHaveBeenCalled();
      expect(session.project).toBeUndefined();
    });

    it("does not open another project when closing the open one is cancelled", async () => {
      const { session } = setup();
      await session.open(a);
      tabGroups.all = [{ tabs: [tab("/code/a/main.tex")] }];
      tabGroups.close.mockResolvedValueOnce(false);
      await session.open(b);
      expect(opened()).toEqual(["/code/a/main.tex"]);
      expect(session.project?.folder).toBe("/code/a");
    });
  });

  describe("close", () => {
    it("keeps the project open when the user cancels closing its tabs", async () => {
      const { session, previews, state } = setup();
      await session.open(a);
      tabGroups.all = [{ tabs: [tab("/code/a/main.tex")] }];
      tabGroups.close.mockResolvedValueOnce(false);
      const keysBefore = executeCommand.mock.calls.filter(([command]) => command === "setContext").length;

      expect(await session.close()).toBe(false);

      expect(previews.close).not.toHaveBeenCalled();
      expect(executeCommand.mock.calls.filter(([command]) => command === "setContext")).toHaveLength(keysBefore);
      expect(session.project?.folder).toBe("/code/a");
      expect([...state.store.values()]).toEqual(["/code/a"]);
    });

    it("closes only the project's text tabs, then its preview, keys and saved state", async () => {
      const { session, previews, state } = setup();
      await session.open(a);
      const own = [tab("/code/a/main.tex"), tab("/code/a/ch/intro.tex")];
      tabGroups.all = [{ tabs: [own[0]!, tab("/code/b/main.tex"), { input: {} }] }, { tabs: [own[1]!] }];

      expect(await session.close()).toBe(true);

      expect(tabGroups.close).toHaveBeenCalledWith(own);
      expect(previews.close).toHaveBeenCalledWith("/code/a");
      expect(contextKey("labshelf.writing.projectOpen")).toBe(false);
      expect(contextKey("labshelf.writing.inProject")).toBe(false);
      expect(state.store.size).toBe(0);
      expect(session.project).toBeUndefined();
    });
  });

  describe("restore", () => {
    it("marks the saved project open after a reload without opening tabs", async () => {
      const state = memento();
      await setup([a, b], state).session.open(a);
      jest.clearAllMocks();

      const { session, previews, changed } = setup([a, b], state);
      changed.fire();

      expect(contextKey("labshelf.writing.projectOpen")).toBe(true);
      expect(session.project?.folder).toBe("/code/a");
      expect(opened()).toEqual([]);
      expect(previews.show).not.toHaveBeenCalled();
    });

    it("drops the open project when it leaves the list but keeps it saved", async () => {
      const { session, projects, state, changed } = setup();
      await session.open(a);
      projects.list.mockReturnValue([b]);
      changed.fire();
      expect(contextKey("labshelf.writing.projectOpen")).toBe(false);
      expect(session.project).toBeUndefined();
      expect([...state.store.values()]).toEqual(["/code/a"]);
    });
  });

  describe("inProject key", () => {
    it("follows whether the active editor belongs to the open project", async () => {
      const nested = readyEntry("/code/a/sub");
      const { session, activeChanged } = setup([a, b, nested]);
      await session.open(a);
      openInEditor("/code/a/ch/intro.tex");
      activeChanged.fire(undefined);
      expect(contextKey("labshelf.writing.inProject")).toBe(true);
      openInEditor("/code/b/main.tex");
      activeChanged.fire(undefined);
      expect(contextKey("labshelf.writing.inProject")).toBe(false);
      openInEditor("/code/a/sub/main.tex");
      activeChanged.fire(undefined);
      expect(contextKey("labshelf.writing.inProject")).toBe(false);
    });
  });

  describe("onDidChange", () => {
    it("fires with the project after open, on restore and with undefined after a successful close", async () => {
      const state = memento();
      const { session } = setup([a, b], state);
      const seen: (string | undefined)[] = [];
      session.onDidChange((project) => seen.push(project?.folder));
      await session.open(a);
      tabGroups.all = [{ tabs: [tab("/code/a/main.tex")] }];
      tabGroups.close.mockResolvedValueOnce(false);
      await session.close();
      tabGroups.all = [];
      await session.close();
      expect(seen).toEqual(["/code/a", undefined]);

      await session.open(b);
      const restored = setup([a, b], state);
      const restoredSeen: (string | undefined)[] = [];
      restored.session.onDidChange((project) => restoredSeen.push(project?.folder));
      restored.changed.fire();
      expect(restoredSeen).toEqual(["/code/b"]);
    });
  });
});

describe("registerProjectSession", () => {
  const executeCommand = vscode.commands.executeCommand as jest.Mock;
  const entry = readyEntry("/code/a");

  function setup() {
    const context = { subscriptions: [] as vscode.Disposable[], workspaceState: { get: () => undefined, update: jest.fn(async () => {}) } };
    const projects = { ...fakeProjects([entry]), onDidChange: new vscode.EventEmitter<void>().event };
    const previews = { show: jest.fn(), close: jest.fn() };
    const activeSource = nativeActiveSource(new vscode.EventEmitter<unknown>().event);
    const session = registerProjectSession({ context: context as never, host: fakeHost(), projects, previews, activeSource: activeSource as never });
    return { context, session, previews };
  }

  beforeEach(() => { jest.clearAllMocks(); });

  it("opens the project given to the open command", async () => {
    const { context, session } = setup();
    await commandHandler("labshelf.writing.openProject")(entry);
    expect(executeCommand).toHaveBeenCalledWith("vscode.open", expect.objectContaining({ fsPath: "/code/a/main.tex" }));
    expect(session.project?.folder).toBe("/code/a");
    expect(context.subscriptions).toContain(session);
    session.dispose();
  });

  it("closes the open project with the close command", async () => {
    const { session, previews } = setup();
    await commandHandler("labshelf.writing.openProject")(entry);
    await commandHandler("labshelf.writing.closeProject")();
    expect(previews.close).toHaveBeenCalledWith("/code/a");
    expect(session.project).toBeUndefined();
    session.dispose();
  });
});

describe("projectWriteEvents", () => {
  it('records before saving and completes with the final saved text', async () => {
    const will = vscode.workspace.onWillSaveTextDocument as jest.Mock;
    const did = vscode.workspace.onDidSaveTextDocument as jest.Mock;
    const saves = { fs: {} as never, beforeSave: jest.fn(async () => {}), afterSave: jest.fn(async () => {}) };
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    registerProjectWriteEvents(context, saves, fakeLogger());
    let text = 'draft';
    const document = { uri: vscode.Uri.file('/project/main.tex'), getText: () => text };
    const waitUntil = jest.fn();
    will.mock.calls.at(-1)![0]({ document, waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
    expect(saves.beforeSave).toHaveBeenCalledWith('/project/main.tex', 'draft');
    text = 'formatted';
    did.mock.calls.at(-1)![0](document);
    await Promise.resolve();
    expect(saves.afterSave).toHaveBeenCalledWith('/project/main.tex', 'formatted');
    for (const disposable of context.subscriptions) disposable.dispose();
  });
});
