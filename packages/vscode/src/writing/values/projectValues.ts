// Gives the value providers each project's JSON leaves, read once and dropped when a value file or the project list changes.
import * as vscode from "vscode";

import type { ILogger, PathOps, ValueLeaf } from "@labshelf/core";
import { owningProject, type ReadyProject } from "../mainDocument.js";
import type { WritingProjects } from "../session/index.js";

/** What the providers read per request: the project list and the open library's logger. */
export interface ValuesWorkspace {
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "onDidChange">;
  logger(): ILogger | undefined;
}

const SOURCE_EXTENSION = { latex: ".tex", typst: ".typ" } as const;

export class ProjectValues implements vscode.Disposable {
  private readonly cache = new Map<string, Promise<ValueLeaf[]>>();
  private watchers: vscode.Disposable[] = [];
  private readonly subscription: vscode.Disposable;

  constructor(private readonly workspace: ValuesWorkspace) {
    this.watch();
    this.subscription = workspace.projects.onDidChange(() => {
      this.cache.clear();
      this.watch();
    });
  }

  /** The path style of the project folders. */
  get paths(): PathOps {
    return this.workspace.projects.paths;
  }

  /** The ready project that lists value files and owns the file as a source of its format. */
  sourceProject(file: string): ReadyProject | undefined {
    const project = owningProject(this.workspace.projects, file);
    const listsValues = (project?.settings.values?.length ?? 0) > 0;
    return project && listsValues && this.paths.extname(file) === SOURCE_EXTENSION[project.settings.format] ? project : undefined;
  }

  leaves(project: ReadyProject): Promise<ValueLeaf[]> {
    if (!this.workspace.logger()) { return Promise.resolve([]); }
    const cached = this.cache.get(project.folder);
    if (cached) { return cached; }
    const read = this.workspace.projects.data.readProjectValues(project);
    this.cache.set(project.folder, read);
    return read;
  }

  dispose(): void {
    this.subscription.dispose();
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];
  }

  private watch(): void {
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];
    for (const entry of this.workspace.projects.list()) {
      if (entry.kind !== "ready") { continue; }
      for (const listed of entry.settings.values ?? []) {
        const file = this.paths.resolve(entry.folder, listed);
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.paths.dirname(file), this.paths.basename(file)));
        const drop = (): void => { this.cache.delete(entry.folder); };
        this.watchers.push(watcher, watcher.onDidCreate(drop), watcher.onDidChange(drop), watcher.onDidDelete(drop));
      }
    }
  }
}
