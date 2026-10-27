// Reads the scanned sources of a LaTeX project: the editors or disk it comes from, the cache of the owning project and the range conversion.
import * as vscode from "vscode";

import {
  readLatexProjectSources, type ILogger, type LatexRange, type MissingSource, type ProjectSourceFile, type ProjectSourceReader,
} from "@labshelf/core";
import { disposeAll } from "../disposables/index.js";
import { findOwningProject, type ReadyProject } from "../writing/index.js";
import type { WritingProjects } from "../writing/projects/index.js";

export function deriveVscodeRange(range: LatexRange): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

const MISSING_CODES = new Set(["FileNotFound", "ENOENT"]);

export function createProjectSourceReader(root: vscode.Uri, logger: () => ILogger | undefined): ProjectSourceReader {
  return {
    async read(relativePath) {
      const uri = vscode.Uri.joinPath(root, relativePath);
      // Unsaved text wins so labels and macros follow what the user is typing.
      const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === "file" && document.uri.fsPath === uri.fsPath);
      if (open) { return open.getText(); }
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch (error) {
        if (!MISSING_CODES.has((error as { code?: string }).code ?? "")) {
          await logger()?.error("writing/latex-editing", error, { action: "read", file: uri.fsPath });
        }
        return undefined;
      }
    },
  };
}

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
  projects: Pick<WritingProjects, "list" | "paths" | "onDidChange">;
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
    if (file.scheme !== "file" || this.workspace.projects.paths.extname(file.fsPath) !== ".tex") { return undefined; }
    const project = findOwningProject(this.workspace.projects, file.fsPath);
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
    disposeAll(this.subscriptions);
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
    const sources = await readLatexProjectSources(main, reader);
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
