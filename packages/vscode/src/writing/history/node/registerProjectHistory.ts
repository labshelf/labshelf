// Registers Show History and keeps every writing project's history: a snapshot when a project file opens and after each save.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { executeSafely } from "../../../commands/index.js";
import { activeProject } from "../../build/index.js";
import { owningProject, type ReadyProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import { HistoryPanel } from "../historyPanel.js";
import { NodeHistoryStore } from "./nodeHistoryStore.js";

const SHOW_HISTORY_COMMAND = "labshelf.writing.showHistory";
/** Save All writes several files at once; one snapshot covers them. */
const SAVE_SETTLE_MS = 600;

interface ProjectHistoryDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths">;
}

/** What the rest of the Writing view records into a project's history. */
export interface ProjectHistoryRecorder {
  recordVersion(project: ReadyProject, name: string): void;
}

export function registerProjectHistory({ context, host, projects }: ProjectHistoryDeps): ProjectHistoryRecorder {
  const logger: ILogger = {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
  const store = new NodeHistoryStore(context.globalStorageUri.fsPath, logger);
  let panel: HistoryPanel | undefined;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const record = (project: ReadyProject, kind: "edit" | "version", label?: string): void => {
    void store.record(project, kind, label)
      .then(async (entry) => { if (entry && panel?.folder === project.folder) { await panel.refresh(); } })
      .catch((error: unknown) => logger.error("writing/history", error, { action: "record", folder: project.folder, kind }));
  };
  const recordSoon = (document: vscode.TextDocument): void => {
    const project = document.uri.scheme === "file" ? owningProject(projects, document.uri.fsPath) : undefined;
    if (!project) { return; }
    clearTimeout(timers.get(project.folder));
    timers.set(project.folder, setTimeout(() => { timers.delete(project.folder); record(project, "edit"); }, SAVE_SETTLE_MS));
  };

  const show = (): Promise<void> => executeSafely(logger, SHOW_HISTORY_COMMAND, async () => {
    const project = activeProject(projects) ?? projects.list().find((entry): entry is ReadyProject => entry.kind === "ready" && entry.folder === panel?.folder);
    if (!project) {
      await vscode.window.showInformationMessage("Open a file of a writing project to see its history.");
      return;
    }
    await store.record(project, "edit");
    if (panel) { panel.show(project); await panel.refresh(); return; }
    panel = await HistoryPanel.open(context.extensionUri, project, store, logger, () => { panel = undefined; });
  });

  context.subscriptions.push(
    // Opening a file records the project as it is before any edit, so the history reaches back to its start.
    vscode.workspace.onDidOpenTextDocument(recordSoon),
    vscode.workspace.onDidSaveTextDocument(recordSoon),
    vscode.commands.registerCommand(SHOW_HISTORY_COMMAND, show),
    { dispose: () => { for (const timer of timers.values()) { clearTimeout(timer); } } },
  );
  return { recordVersion: (project, name) => record(project, "version", name) };
}
