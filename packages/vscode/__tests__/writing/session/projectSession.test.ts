// Tests the project session: opening and closing a project as a unit, its context keys and its restore after reload.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { ProjectSession } from "../../../src/writing/session";
import { fakeHost, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

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
  const session = new ProjectSession({ workspaceState: state, projects, previews, host: fakeHost() });
  sessions.push(session);
  return { session, projects, previews, state, changed };
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
    const { session } = setup([a, b, nested]);
    await session.open(a);
    openInEditor("/code/a/ch/intro.tex");
    expect(contextKey("labshelf.writing.inProject")).toBe(true);
    openInEditor("/code/b/main.tex");
    expect(contextKey("labshelf.writing.inProject")).toBe(false);
    openInEditor("/code/a/sub/main.tex");
    expect(contextKey("labshelf.writing.inProject")).toBe(false);
  });
});
