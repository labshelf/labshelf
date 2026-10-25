// Registers the share, join and leave project commands, which open the matching sharing dialog in the Library sidebar.
import * as vscode from "vscode";

import type { SharingDialogRequest } from "@labshelf/core";
import { sharingWebviews } from "../../../share/index.js";

export const SHARE_COMMAND = "labshelf.collab.share";
export const JOIN_COMMAND = "labshelf.collab.join";
export const LEAVE_COMMAND = "labshelf.collab.leave";

/** A folder path or a project entry from a view names the project; anything else, such as a URI from a menu, names none. */
function projectFolder(target: unknown): string | undefined {
  if (typeof target === "string") { return target; }
  if (typeof target !== "object" || target === null || !("folder" in target)) { return undefined; }
  const { folder } = target as { folder: unknown };
  return typeof folder === "string" ? folder : undefined;
}

const projectRequest = (kind: "shareProject" | "leaveProject", target: unknown): SharingDialogRequest => {
  const projectId = projectFolder(target);
  return projectId === undefined ? { kind } : { kind, projectId };
};

/** `requireLibrary` offers the library setup when none is open and resolves to undefined when the user declines. */
export function registerProjectDialogCommands(requireLibrary: () => Promise<string | undefined>): vscode.Disposable {
  const open = async (request: SharingDialogRequest): Promise<void> => {
    if (await requireLibrary()) { await sharingWebviews.open(request); }
  };
  return vscode.Disposable.from(
    vscode.commands.registerCommand(SHARE_COMMAND, (target?: unknown) => open(projectRequest("shareProject", target))),
    vscode.commands.registerCommand(JOIN_COMMAND, (invite?: unknown) => open(typeof invite === "string" ? { kind: "joinProject", invite } : { kind: "joinProject" })),
    vscode.commands.registerCommand(LEAVE_COMMAND, (target?: unknown) => open(projectRequest("leaveProject", target))),
  );
}
