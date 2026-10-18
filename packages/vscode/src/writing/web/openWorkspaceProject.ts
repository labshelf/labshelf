// Opens the project the web host's workspace folder holds once the projects load, as picking it in the sidebar does on the desktop.
import * as vscode from "vscode";

import type { WritingHost, WritingProjects } from "../session/index.js";
import { OPEN_PROJECT_COMMAND } from "../session/index.js";

interface WorkspaceProjectDeps {
  context: Pick<vscode.ExtensionContext, "subscriptions">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "onDidChange">;
}

// PLATFORM: the web editor page opens one project as its workspace folder and has no sidebar pick that opens it.
export function registerWorkspaceProjectOpen({ context, host, projects }: WorkspaceProjectDeps): void {
  let opened = false;
  const open = (): void => {
    if (opened || !host.current()) { return; }
    const folders = new Set((vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath));
    const entry = projects.list().find((candidate) => candidate.kind === "ready" && folders.has(candidate.folder));
    if (!entry) { return; }
    opened = true;
    void host.current()?.logger.log("INFO", "writing/session", "Opening the workspace folder's project", { folder: entry.folder });
    void vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, entry);
  };
  context.subscriptions.push(projects.onDidChange(open));
  open();
}
