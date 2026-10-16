// Keeps the index of which projects cite each paper, rebuilt when the projects or their sources change.
import * as vscode from "vscode";

import type { BacklinkIndex } from "@labshelf/core";
import { openEditorSources } from "../citations/index.js";
import type { WritingHost, WritingProjects } from "../projectStore.js";

const REBUILD_DEBOUNCE_MS = 1000;
const SOURCE_FILE = /\.(tex|typ)$/;

export class ProjectBacklinkIndex implements vscode.Disposable {
  private built: BacklinkIndex = new Map();
  private rebuildCount = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly projects: Pick<WritingProjects, "list" | "onDidChange" | "paths" | "data">, private readonly host: Pick<WritingHost, "current">) {
    const onDocument = (document: vscode.TextDocument): void => {
      if (this.isProjectSource(document)) { this.schedule(); }
    };
    this.subscriptions = [
      projects.onDidChange(() => this.schedule()),
      vscode.workspace.onDidSaveTextDocument(onDocument),
      vscode.workspace.onDidChangeTextDocument((event) => onDocument(event.document)),
    ];
  }

  /** The index as last built; empty until the first rebuild finishes. */
  index(): BacklinkIndex {
    return this.built;
  }

  /** The folder of the ready project with this id. */
  projectFolder(id: string): string | undefined {
    for (const entry of this.projects.list()) { if (entry.kind === "ready" && entry.settings.id === id) { return entry.folder; } }
    return undefined;
  }

  private isProjectSource(document: vscode.TextDocument): boolean {
    if (document.uri.scheme !== "file" || !SOURCE_FILE.test(document.uri.fsPath)) { return false; }
    return this.projects.list().some((entry) => entry.kind === "ready" && document.uri.fsPath.startsWith(entry.folder + this.projects.paths.sep));
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.rebuild(), REBUILD_DEBOUNCE_MS);
  }

  private async rebuild(): Promise<void> {
    const ticket = ++this.rebuildCount;
    const logger = this.host.current()?.logger;
    let index: BacklinkIndex = new Map();
    if (logger) {
      try {
        index = await this.projects.data.projectBacklinks(this.projects.list(), openEditorSources);
      } catch (error) {
        await logger.error("writing/backlinks", error, { action: "rebuild" });
        return;
      }
    }
    // A slower, older rebuild must not overwrite a newer result.
    if (ticket !== this.rebuildCount) { return; }
    this.built = index;
    this.changeEmitter.fire();
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.changeEmitter.dispose();
  }
}
