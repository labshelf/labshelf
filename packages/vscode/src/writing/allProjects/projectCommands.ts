// Lists the project commands the All projects row menu offers and runs the ones the sidebar also allows.
import * as vscode from "vscode";
import type { ProjectEntry, ProjectMenuCommand } from "@labshelf/core";
import { PROJECT_COMMANDS, desktopCommandsAvailable, hostCommands, isSidebarProjectCommand } from "../../ui/library/index.js";

const OPEN = "labshelf.writing.openProject";
const EXTERNAL_ONLY = "labshelf.writing.removeProject";

export function projectMenuCommands(): ProjectMenuCommand[] {
  return hostCommands(PROJECT_COMMANDS, desktopCommandsAvailable()).filter((c) => c.command !== OPEN).map((c) => ({
    command: c.command, label: c.label, group: c.group, ...(c.command === EXTERNAL_ONLY ? { externalOnly: true } : {}),
  }));
}

export async function runProjectCommand(command: string, entry: ProjectEntry): Promise<void> {
  if (!isSidebarProjectCommand(command)) { throw new Error(`${command} is not a project command`); }
  await vscode.commands.executeCommand(command, entry);
}
