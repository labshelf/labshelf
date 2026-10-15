// Collects the scanned source files of the LaTeX project that owns a document, cached until one of its files changes.
import * as path from "node:path";
import * as vscode from "vscode";

import {
  collectProjectSources, type ILogger, type MissingSource, type ProjectSourceFile, type ProjectSourceReader,
} from "@labshelf/core";
import { owningProject, type ReadyProject } from "../../mainDocument.js";
import type { WritingProjects } from "../../projectStore.js";
import { createProjectSourceReader } from "./projectSourceReader.js";

/** A LaTeX project read from its main file through every file it includes. */
export interface LatexProject {
  root: vscode.Uri;
  /** The main file as a project-root-relative posix path. */
  main: string;
  files: ProjectSourceFile[];
  missing: MissingSource[];
  /** The text each scanned file had when read, by path; unsaved editor text included. */
  texts: ReadonlyMap<string, string>;
}

export interface LatexProjectWorkspace {
  projects: Pick<WritingProjects, "list" | "onDidChange">;
  logger(): ILogger | undefined;
}

export class LatexProjectSources implements vscode.Disposable {
  private readonly cache = new Map<string, Promise<LatexProject>>();
  private readonly changes = new vscode.EventEmitter<string>();
  /** Fires with the project folder whose sources changed. */
  readonly onDidChange = this.changes.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly workspace: LatexProjectWorkspace) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.tex");
    const touched = (uri: vscode.Uri): void => this.invalidateFile(uri);
    this.subscriptions = [
      this.changes, watcher,
      watcher.onDidCreate(touched), watcher.onDidChange(touched), watcher.onDidDelete(touched),
      vscode.workspace.onDidChangeTextDocument((event) => touched(event.document.uri)),
      vscode.workspace.onDidSaveTextDocument((document) => touched(document.uri)),
      vscode.workspace.onDidCloseTextDocument((document) => touched(document.uri)),
      workspace.projects.onDidChange(() => this.invalidateAll()),
    ];
  }

  /** The LaTeX project that owns a `.tex` file on disk, if any. */
  projectOf(file: vscode.Uri): ReadyProject | undefined {
    if (file.scheme !== "file" || path.extname(file.fsPath) !== ".tex") { return undefined; }
    const project = owningProject(this.workspace.projects.list(), file.fsPath);
    return project?.settings.format === "latex" ? project : undefined;
  }

  /** The sources of the project that owns the document; undefined outside a project or when it has no main file. */
  projectSourcesFor(document: Pick<vscode.TextDocument, "uri">): Promise<LatexProject | undefined> {
    const project = this.projectOf(document.uri);
    return project ? this.load(project) : Promise.resolve(undefined);
  }

  /** The sources of the project in the folder. */
  projectSourcesAt(folder: string): Promise<LatexProject | undefined> {
    const project = this.workspace.projects.list().find((entry) => entry.kind === "ready" && entry.folder === folder);
    return project?.kind === "ready" ? this.load(project) : Promise.resolve(undefined);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
  }

  private load(project: ReadyProject): Promise<LatexProject | undefined> {
    const main = project.main;
    if (!main) { return Promise.resolve(undefined); }
    let loading = this.cache.get(project.folder);
    if (!loading) {
      loading = this.collect(project.folder, main);
      this.cache.set(project.folder, loading);
    }
    return loading;
  }

  private async collect(folder: string, main: string): Promise<LatexProject> {
    const root = vscode.Uri.file(folder);
    const base = createProjectSourceReader(root, () => this.workspace.logger());
    const texts = new Map<string, string>();
    const reader: ProjectSourceReader = {
      async read(relativePath) {
        const text = await base.read(relativePath);
        if (text !== undefined) { texts.set(relativePath, text); }
        return text;
      },
    };
    const sources = await collectProjectSources(main, reader);
    return { root, main, ...sources, texts };
  }

  private invalidateFile(file: vscode.Uri): void {
    const folder = this.projectOf(file)?.folder;
    if (folder === undefined) { return; }
    this.cache.delete(folder);
    this.changes.fire(folder);
  }

  private invalidateAll(): void {
    this.cache.clear();
    for (const entry of this.workspace.projects.list()) {
      if (entry.kind === "ready" && entry.settings.format === "latex") { this.changes.fire(entry.folder); }
    }
  }
}
