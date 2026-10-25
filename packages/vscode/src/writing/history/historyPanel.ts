// Opens the editor tab that shows a project's history and answers its page: diffs, restores and the version commands.
import * as vscode from "vscode";

import {
  parseHistoryMessage,
  type DiffLine,
  type HistoryRow,
  type HistoryToHost,
  type HostToHistory,
  type ILogger,
  createNonce,
} from "@labshelf/core";
import { createTabIcon, hasBundleFile, renderBundleMissingHtml } from "../../ui/index.js";
import type { ReadyProject } from "../buildRootDocument.js";

/** <extension>/dist/history, for localResourceRoots. */
function historyBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "history");
}

async function historyHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = historyBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "history.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "History", heading: "History bundle not built", file: "dist/history/history.js", reopen: "the history" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>History</title>
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "history.css")).toString()}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}

/** What the panel reads and changes in a project's history. */
export interface ProjectHistoryStore {
  /** Newest first. */
  rows(project: ReadyProject): Promise<HistoryRow[]>;
  /** The lines entry `id` changed in `path`; null for a binary file. */
  diff(project: ReadyProject, id: string, path: string): Promise<DiffLine[] | null>;
  restore(project: ReadyProject, id: string): Promise<void>;
}

const when = (iso: string): string => new Date(iso).toLocaleString();

export class HistoryPanel {
  private ready = false;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel, private project: ReadyProject,
    private readonly store: ProjectHistoryStore, private readonly logger: ILogger, onDispose: () => void,
  ) {
    panel.webview.onDidReceiveMessage((raw: unknown) => { const message = parseHistoryMessage(raw); if (message) { void this.handle(message); } }, null, this.disposables);
    panel.onDidDispose(() => { onDispose(); while (this.disposables.length) { this.disposables.pop()?.dispose(); } }, null, this.disposables);
  }

  static async open(extensionUri: vscode.Uri, project: ReadyProject, store: ProjectHistoryStore, logger: ILogger, onDispose: () => void): Promise<HistoryPanel> {
    const panel = vscode.window.createWebviewPanel("labshelfHistory", `History: ${project.settings.id}`, vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [historyBundleDirectory(extensionUri)],
    });
    panel.iconPath = createTabIcon(extensionUri);
    const view = new HistoryPanel(panel, project, store, logger, onDispose);
    panel.webview.html = await historyHtml(panel.webview, extensionUri);
    return view;
  }

  get folder(): string { return this.project.folder; }

  show(project: ReadyProject): void {
    const switched = project.folder !== this.project.folder;
    this.project = project;
    this.panel.title = `History: ${project.settings.id}`;
    this.panel.reveal(vscode.ViewColumn.Active);
    if (switched) { void this.refresh(); }
  }

  async refresh(): Promise<void> {
    if (!this.ready) { return; }
    await this.post({ type: "history", project: this.project.settings.id, rows: await this.store.rows(this.project) });
  }

  private post(message: HostToHistory): Thenable<boolean> { return this.panel.webview.postMessage(message); }

  private async handle(message: HistoryToHost): Promise<void> {
    try {
      if (message.type === "ready") { this.ready = true; await this.refresh(); }
      if (message.type === "diff") { await this.post({ ...message, lines: await this.store.diff(this.project, message.id, message.path) }); }
      if (message.type === "restore") { await this.restore(message.id); }
      if (message.type === "markVersion") { await vscode.commands.executeCommand("labshelf.writing.markVersion", this.project); }
      if (message.type === "compareVersions") { await vscode.commands.executeCommand("labshelf.writing.compareVersions", this.project); }
    } catch (error) {
      await this.logger.error("writing/history", error, { action: message.type, folder: this.project.folder });
      void vscode.window.showErrorMessage(`History: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async restore(id: string): Promise<void> {
    const row = (await this.store.rows(this.project)).find((entry) => entry.id === id);
    if (!row) { return; }
    const answer = await vscode.window.showWarningMessage(
      `Restore ${this.project.settings.id} to ${when(row.at)}?`,
      { modal: true, detail: "The project's files go back to that point. The current state stays in the history, so you can return to it." },
      "Restore",
    );
    if (answer !== "Restore") { return; }
    // Unsaved edits are saved first so the history keeps them before the files change.
    await vscode.workspace.saveAll(false);
    await this.post({ type: "busy", busy: true });
    try {
      await this.store.restore(this.project, id);
    } finally {
      await this.post({ type: "busy", busy: false });
    }
    await this.refresh();
    void vscode.window.showInformationMessage(`Restored ${this.project.settings.id} to ${when(row.at)}.`);
  }
}
