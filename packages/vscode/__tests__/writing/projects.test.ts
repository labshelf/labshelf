// Tests that the labshelf.writing.inProject context key follows the current source (native or LabShelf editor) and the open project.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { ProjectSession } from "../../src/writing/projects/session";
import type { SourceView } from "../../src/writing/activeSource";
import { fakeHost, fakeProjects, readyEntry } from "../support/writingFixtures";

const executeCommand = vscode.commands.executeCommand as jest.Mock;
const window = vscode.window as unknown as { activeTextEditor: unknown };

const a = readyEntry("/code/a");
const b = readyEntry("/code/b");
const sessions: ProjectSession[] = [];

const viewOn = (file: string): SourceView => ({ uri: vscode.Uri.file(file), line: () => 1, reveal: jest.fn() });

/** The last value the context key was set to, or `undefined` when it was never set. */
function inProject(): unknown {
  return executeCommand.mock.calls.filter(([command, key]) => command === "setContext" && key === "labshelf.writing.inProject").at(-1)?.[2];
}

function setup(initial: SourceView | undefined, entries: ProjectEntry[] = [a, b]) {
  let current = initial;
  const changed = new vscode.EventEmitter<SourceView | undefined>();
  const activeSource = { current: () => current, onDidChange: changed.event };
  const store = new Map<string, unknown>();
  const workspaceState = {
    keys: () => [...store.keys()], get: (key: string) => store.get(key),
    update: jest.fn(async (key: string, value: unknown) => { if (value === undefined) { store.delete(key); } else { store.set(key, value); } }),
  } as unknown as vscode.Memento;
  const session = new ProjectSession({
    workspaceState, projects: fakeProjects(entries), previews: { show: jest.fn(), close: jest.fn() }, host: fakeHost(), activeSource,
  } as never);
  sessions.push(session);
  /** Focuses a source the way activeSource does: the current one changes, then the event fires. */
  const focus = (view: SourceView | undefined): void => { current = view; changed.fire(view); };
  return { session, focus };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.activeTextEditor = undefined;
});

afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); });

describe("inProject", () => {
  it("4.2b is true when a LabShelf editor on a file of the open project becomes current", async () => {
    const { session, focus } = setup(undefined);
    await session.open(a);
    expect(inProject()).toBe(false);

    focus(viewOn("/code/a/chapters/one.tex"));

    expect(inProject()).toBe(true);
  });

  it("4.2b is true when the project opens while a LabShelf editor on one of its files is already current", async () => {
    const { session } = setup(viewOn("/code/a/main.tex"));

    await session.open(a);

    expect(inProject()).toBe(true);
  });

  it("4.2b is true for the LabShelf editor even when the native active editor is outside the project", async () => {
    window.activeTextEditor = { document: { uri: Object.assign(vscode.Uri.file("/elsewhere/x.tex"), { scheme: "file" }) } };
    const { session, focus } = setup(undefined);
    await session.open(a);

    focus(viewOn("/code/a/main.tex"));

    expect(inProject()).toBe(true);
  });

  it("4.2b is false when the current LabShelf editor is on a file outside the open project", async () => {
    const { session, focus } = setup(undefined);
    await session.open(a);

    focus(viewOn("/code/b/main.tex"));

    expect(inProject()).toBe(false);
  });

  it("4.2b is false when the current LabShelf editor is on a file of no project", async () => {
    const { session, focus } = setup(undefined);
    await session.open(a);

    focus(viewOn("/elsewhere/loose.tex"));

    expect(inProject()).toBe(false);
  });

  it("4.2b is false while no project is open, whichever editor is current", () => {
    const { focus } = setup(undefined);

    focus(viewOn("/code/a/main.tex"));

    expect(inProject()).not.toBe(true);
  });

  it("4.2b turns false again when the current source moves from a project file to one outside it", async () => {
    const { session, focus } = setup(undefined);
    await session.open(a);
    focus(viewOn("/code/a/main.tex"));
    expect(inProject()).toBe(true);

    focus(viewOn("/elsewhere/loose.tex"));

    expect(inProject()).toBe(false);
  });

  it("4.2b turns false when the project closes while its LabShelf editor is current", async () => {
    const { session, focus } = setup(undefined);
    await session.open(a);
    focus(viewOn("/code/a/main.tex"));
    expect(inProject()).toBe(true);

    await session.close();

    expect(inProject()).toBe(false);
  });

  it("4.2b follows a native source the same way, through the current source", async () => {
    const { session, focus } = setup(undefined);
    await session.open(a);

    focus(viewOn("/code/a/main.typ"));

    expect(inProject()).toBe(true);
  });
});
