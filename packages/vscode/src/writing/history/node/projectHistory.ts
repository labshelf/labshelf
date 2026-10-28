// Registers Show History and keeps every writing project's history: a snapshot when a project file opens and after each save.
import * as vscode from "vscode";

import {
  createKeyedDebouncer,
  type ILogger,
  readHistoryDiff,
  readHistoryRows,
  writeSnapshot,
  applySnapshot,
  type DiffLine,
  type HistoryKind,
} from "@labshelf/core";
import { runSafely } from "../../../command/index.js";
import { readActiveProject } from "../../build/index.js";
import { findOwningProject, type ReadyProject } from "../../projects/index.js";
import type { ProjectHistoryRecorder, WritingHost, WritingProjects } from "../../projects/index.js";
import { HistoryPanel, type ProjectHistoryStore } from "../historyPanel.js";
import * as path from "node:path";
import { createNodeHistoryProject } from "@labshelf/core/node";

class NodeHistoryStore implements ProjectHistoryStore {
  constructor(private readonly storageDir: string, private readonly logger: ILogger) {}

  // History is per device: it lives outside the project folder, so the user's sync tool never copies it between devices.
  private target(project: ReadyProject) {
    return createNodeHistoryProject(project.folder, path.join(this.storageDir, "history", encodeURIComponent(project.settings.id)));
  }

  record(project: ReadyProject, kind: HistoryKind, label?: string): Promise<unknown> {
    return writeSnapshot(this.target(project), kind, this.logger, label);
  }

  rows(project: ReadyProject) {
    return readHistoryRows(this.target(project).storage, this.logger);
  }

  diff(project: ReadyProject, id: string, file: string): Promise<DiffLine[] | null> {
    return readHistoryDiff(this.target(project).storage, id, file, this.logger);
  }

  async restore(project: ReadyProject, id: string): Promise<void> {
    await applySnapshot(this.target(project), id, this.logger);
  }
}

const SHOW_HISTORY_COMMAND = "labshelf.writing.showHistory";
/** Save All writes several files at once; one snapshot covers them. */
const SAVE_SETTLE_MS = 600;

interface ProjectHistoryDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths">;
}

export function registerProjectHistory({ context, host, projects }: ProjectHistoryDeps): ProjectHistoryRecorder {
  const logger: ILogger = {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
  const store = new NodeHistoryStore(context.globalStorageUri.fsPath, logger);
  let panel: HistoryPanel | undefined;
  const settling = new Map<string, ReadyProject>();

  const record = (project: ReadyProject, kind: "edit" | "version", label?: string): void => {
    void store.record(project, kind, label)
      .then(async (entry) => { if (entry && panel?.folder === project.folder) { await panel.refresh(); } })
      .catch((error: unknown) => logger.error("writing/history", error, { action: "record", folder: project.folder, kind }));
  };
  const settle = createKeyedDebouncer<string>(SAVE_SETTLE_MS, (folder) => {
    const project = settling.get(folder);
    settling.delete(folder);
    if (project) { record(project, "edit"); }
  });
  const recordSoon = (document: vscode.TextDocument): void => {
    const project = document.uri.scheme === "file" ? findOwningProject(projects, document.uri.fsPath) : undefined;
    if (!project) { return; }
    settling.set(project.folder, project);
    settle.call(project.folder);
  };

  const show = (): Promise<void> => runSafely(logger, SHOW_HISTORY_COMMAND, async () => {
    const project = readActiveProject(projects) ?? projects.list().find((entry): entry is ReadyProject => entry.kind === "ready" && entry.folder === panel?.folder);
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
    { dispose: () => { settle.dispose(); settling.clear(); } },
  );
  return { recordVersion: (project, name) => record(project, "version", name) };
}
