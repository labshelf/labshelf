// Builds the session, project entries and command lookup the writing tests share.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import type { ProjectEntry } from "@labshelf/core/node";
import type { WritingHost, WritingSession } from "../../src/writing/index.js";

export function fakeLogger(): { log: jest.Mock; error: jest.Mock } & ILogger {
  return { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
}

export function fakeHost(logger = fakeLogger()): WritingHost & { session: WritingSession } {
  const session = { root: "/lib", logger };
  return { session, current: () => session, require: jest.fn(async () => session) };
}

export function fakeProjects(entries: ProjectEntry[] = []): { reload: jest.Mock; list: jest.Mock } {
  return { reload: jest.fn(async () => {}), list: jest.fn(() => entries) };
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
