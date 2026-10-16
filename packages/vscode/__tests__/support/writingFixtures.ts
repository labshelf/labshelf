// Builds the session, project entries and command lookup the writing tests share.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ILogger, ProjectEntry } from "@labshelf/core";
import type { WritingHost, WritingSession } from "../../src/writing/index.js";

export function fakeLogger(): { log: jest.Mock; error: jest.Mock } & ILogger {
  return { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
}

export function fakeHost(logger = fakeLogger()): WritingHost & { session: WritingSession } {
  const session = { root: "/lib", logger };
  return { session, current: () => session, require: jest.fn(async () => session) };
}

export function fakeProjects(entries: ProjectEntry[] = []): { reload: jest.Mock; list: jest.Mock; paths: typeof path } {
  return { reload: jest.fn(async () => {}), list: jest.fn(() => entries), paths: path };
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
