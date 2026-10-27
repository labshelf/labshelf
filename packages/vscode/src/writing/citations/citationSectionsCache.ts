// Caches, per project folder, which sections cite each key; a save inside the project drops its entry.
import type * as vscode from "vscode";

import { isInside, deriveCitationSections, createSectionPlacer, type ChecklistSection, type ChecklistSource, type ILogger, type PathOps } from "@labshelf/core";
import type { ReadyProject } from "../buildRootDocument.js";

export interface CitationSections {
  /** The sections that cite each key, in source order. */
  byKey: ReadonlyMap<string, readonly ChecklistSection[]>;
  /** The section of a line (zero-based) in an absolute file path of the project. */
  sectionAt(file: string, line: number): ChecklistSection | undefined;
}

export interface CitationSectionsCacheDeps {
  /** The main file first, then the files it includes. */
  readSources(project: ReadyProject, logger: ILogger): Promise<ChecklistSource[]>;
  onDidSaveTextDocument: vscode.Event<vscode.TextDocument>;
  paths: PathOps;
}

export class CitationSectionsCache implements vscode.Disposable {
  private readonly entries = new Map<string, Promise<CitationSections>>();
  private readonly subscription: vscode.Disposable;

  constructor(private readonly deps: CitationSectionsCacheDeps) {
    this.subscription = deps.onDidSaveTextDocument((document) => this.forget(document.uri.fsPath));
  }

  /** A failed read is not cached, so the next request reads again. */
  get(project: ReadyProject, logger: ILogger): Promise<CitationSections> {
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

  private async build(project: ReadyProject, logger: ILogger): Promise<CitationSections> {
    const sources = await this.deps.readSources(project, logger);
    const main = project.main ?? "";
    const { paths } = this.deps;
    const place = createSectionPlacer(sources, main);
    const relative = (file: string): string => paths.relative(project.folder, file).split(paths.sep).join("/");
    return { byKey: deriveCitationSections(sources, main), sectionAt: (file, line) => place(relative(file), line) };
  }

  private forget(file: string): void {
    for (const folder of this.entries.keys()) {
      if (isInside(this.deps.paths, folder, file)) { this.entries.delete(folder); }
    }
  }
}
