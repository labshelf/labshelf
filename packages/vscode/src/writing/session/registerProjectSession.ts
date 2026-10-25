// Registers the Open Project and Close Project commands on the window's project session.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { executeSafely } from "../../command/index.js";
import { ProjectSession, type ProjectSessionDeps } from "./projectSession.js";

export const OPEN_PROJECT_COMMAND = "labshelf.writing.openProject";
const CLOSE_PROJECT_COMMAND = "labshelf.writing.closeProject";

interface ProjectSessionCommandsDeps extends Omit<ProjectSessionDeps, "workspaceState"> {
  context: vscode.ExtensionContext;
}

export function registerProjectSession(deps: ProjectSessionCommandsDeps): ProjectSession {
  const { context, ...sessionDeps } = deps;
  const session = new ProjectSession({ ...sessionDeps, workspaceState: context.workspaceState });
  // Without an open library there is no logger; VS Code then reports a failure itself.
  const run = (command: string, action: () => Promise<void>): Promise<void> => {
    const logger = deps.host.current()?.logger;
    return logger ? executeSafely(logger, command, action) : action();
  };
  context.subscriptions.push(
    session,
    vscode.commands.registerCommand(OPEN_PROJECT_COMMAND, (entry?: ProjectEntry) => run(OPEN_PROJECT_COMMAND, () => session.open(entry))),
    vscode.commands.registerCommand(CLOSE_PROJECT_COMMAND, () => run(CLOSE_PROJECT_COMMAND, async () => { await session.close(); })),
  );
  return session;
}
