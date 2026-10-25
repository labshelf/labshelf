// Caches, per project folder, which sections cite each key; a save inside the project drops its entry.
import type * as vscode from "vscode";

import { citeSections, sectionPlacer, type ChecklistSection, type ChecklistSource, type ILogger, type PathOps } from "@labshelf/core";
import { isInside, type ReadyProject } from "../buildRootDocument.js";

export interface CiteSections {
  /** The sections that cite each key, in source order. */
  byKey: ReadonlyMap<string, readonly ChecklistSection[]>;
  /** The section of a line (zero-based) in an absolute file path of the project. */
  sectionAt(file: string, line: number): ChecklistSection | undefined;
}

export interface CiteSectionsCacheDeps {
  /** The main file first, then the files it includes. */
  readSources(project: ReadyProject, logger: ILogger): Promise<ChecklistSource[]>;
  onDidSaveTextDocument: vscode.Event<vscode.TextDocument>;
  paths: PathOps;
}

export class CiteSectionsCache implements vscode.Disposable {
  private readonly entries = new Map<string, Promise<CiteSections>>();
  private readonly subscription: vscode.Disposable;

  constructor(private readonly deps: CiteSectionsCacheDeps) {
    this.subscription = deps.onDidSaveTextDocument((document) => this.forget(document.uri.fsPath));
  }

  /** A failed read is not cached, so the next request reads again. */
  get(project: ReadyProject, logger: ILogger): Promise<CiteSections> {
    let entry = this.entries.get(project.folder);
    if (!entry) {
      entry = this.build(project, logger);
      this.entries.set(project.folder, entry);
      entry.catch(() => this.entries.delete(project.folder));
    }
    return entry;
  }

  dispose(): void {
    this.subscription.dispose();
    this.entries.clear();
  }

  private async build(project: ReadyProject, logger: ILogger): Promise<CiteSections> {
    const sources = await this.deps.readSources(project, logger);
    const main = project.main ?? "";
    const { paths } = this.deps;
    const place = sectionPlacer(sources, main);
    const relative = (file: string): string => paths.relative(project.folder, file).split(paths.sep).join("/");
    return { byKey: citeSections(sources, main), sectionAt: (file, line) => place(relative(file), line) };
  }

  private forget(file: string): void {
    for (const folder of this.entries.keys()) {
      if (isInside(this.deps.paths, folder, file)) { this.entries.delete(folder); }
    }
  }
}
