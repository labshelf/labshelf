// Builds the session, project entries and command lookup the writing tests share.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ILogger, ProjectDataPort, ProjectEntry } from "@labshelf/core";
import type { WritingHost, WritingSession } from "../../src/writing/index.js";

export function fakeLogger(): { log: jest.Mock; error: jest.Mock } & ILogger {
  return { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
}

export function fakeHost(logger = fakeLogger()): WritingHost & { session: WritingSession } {
  const session = { root: "/lib", logger };
  return { session, current: () => session, require: jest.fn(async () => session) };
}

/** A project data port whose methods are mocks that resolve to empty results. */
export function fakeProjectData(): { [K in keyof ProjectDataPort]: jest.Mock } {
  return {
    listProjects: jest.fn(async () => []),
    createProjectFromTemplate: jest.fn(async () => { throw new Error("createProjectFromTemplate is not stubbed"); }),
    addExistingFolder: jest.fn(async () => { throw new Error("addExistingFolder is not stubbed"); }),
    unregisterProjectFolder: jest.fn(async () => {}),
    rootFileNames: jest.fn(async () => []),
    updateProjectSettings: jest.fn(async () => {}),
    listVersions: jest.fn(async () => []),
    markVersion: jest.fn(async () => { throw new Error("markVersion is not stubbed"); }),
    readProjectValues: jest.fn(async () => []),
    readFigureStates: jest.fn(async () => ({})),
    updateProjectBibliography: jest.fn(async () => ({ written: false, papersWritten: false, missing: [], mainLine: "not-needed" as const })),
    projectBacklinks: jest.fn(async () => new Map()),
    projectBuildDir: jest.fn((id: string) => `/cache/${id}`),
    readSynctexFile: jest.fn(async () => { throw new Error("readSynctexFile is not stubbed"); }),
  };
}

export function fakeProjects(entries: ProjectEntry[] = []): {
  reload: jest.Mock; list: jest.Mock; onDidChange: jest.Mock; paths: typeof path; data: ReturnType<typeof fakeProjectData>;
} {
  return { reload: jest.fn(async () => {}), list: jest.fn(() => entries), onDidChange: jest.fn(() => ({ dispose() {} })), paths: path, data: fakeProjectData() };
}

export function readyEntry(folder: string, over: Partial<Extract<ProjectEntry, { kind: "ready" }>> = {}): ProjectEntry {
  return {
    kind: "ready", folder, location: "library", main: "main.tex",
    settings: { id: folder.split("/").pop()!, format: "latex" }, ...over,
  };
}

/** The handler registered for a command id since the last mock reset. */
export function commandHandler(id: string): (...args: unknown[]) => Promise<void> {
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === id);
  if (!call) { throw new Error(`${id} is not registered`); }
  return call[1];
}

/** Makes the file the active editor and fires the active-editor event, as VS Code does when the user switches files. */
export function openInEditor(fsPath: string, scheme = "file"): void {
  const window = vscode.window as unknown as { activeTextEditor: unknown; _fireActiveEditorChange: () => void };
  window.activeTextEditor = { document: { uri: Object.assign(vscode.Uri.file(fsPath), { scheme }) } };
  window._fireActiveEditorChange();
}
