// Serves the Project Search panel: runs its searches on the active file's writing project and carries out its opens and replacements.
import * as vscode from "vscode";

import { createEmptySearchRun, findMatchesIn, parseSearchMessage, type HostToSearch, type ILogger, type SearchOptions, type SearchScopeMode, type SearchToHost } from "@labshelf/core";
import { deriveBuildRootPath, findOwningProject, type ProjectFinder, type ReadyProject } from "../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
import { openMatch } from "./openMatch.js";
import { readScopeTexts, SEARCH_LOG_MODULE, type SearchScope } from "./projectSearchFiles.js";
import { writeReplacementsInProject } from "./writeReplacementsInProject.js";
import { readSearchBundleDir, searchHtml } from "./searchHtml.js";
import { runSearch } from "./searchRun.js";

export const PROJECT_SEARCH_VIEW = "labshelf.writing.projectSearch";
const DEBOUNCE_MS = 200;

interface ProjectSearchDeps {
  extensionUri: vscode.Uri;
  projects: ProjectFinder & Pick<WritingProjects, "fs">;
  host: WritingHost;
}

interface SearchRequest {
  query: string;
  options: SearchOptions;
  mode: SearchScopeMode;
}

/** The project that owns the active file, with what the searches and their log need. */
interface Target {
  project: ReadyProject;
  file: string;
  logger: ILogger;
}

const fileEditorPath = (editor: vscode.TextEditor | undefined): string | undefined =>
  editor?.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined;

export class ProjectSearchView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private pendingSeed: string | undefined;
  private request: SearchRequest | undefined;
  private pattern: RegExp | undefined;
  private searched: ReadonlySet<string> = new Set();
  /** The last file editor, kept while a non-text tab is in front so the panel keeps its project. */
  private activeFile = fileEditorPath(vscode.window.activeTextEditor);
  private run = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly deps: ProjectSearchDeps) {
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        const file = fileEditorPath(editor);
        if (file === undefined || file === this.activeFile) { return; }
        this.activeFile = file;
        this.postScope();
        this.schedule();
      }),
      vscode.workspace.onDidChangeTextDocument(({ document }) => { if (this.searched.has(document.uri.fsPath)) { this.schedule(); } }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [readSearchBundleDir(this.deps.extensionUri)] };
    view.webview.onDidReceiveMessage((raw: unknown) => { void this.handle(raw); });
    view.onDidDispose(() => { this.view = undefined; this.ready = false; });
    void searchHtml(view.webview, this.deps.extensionUri).then((html) => { if (this.view === view) { view.webview.html = html; } });
  }

  /** Puts the text in the search box; before the page is ready it arrives with `ready`. */
  seed(query: string): void {
    this.pendingSeed = query;
    if (this.ready) { this.postSeed(); }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.run += 1;
    while (this.subscriptions.length) { this.subscriptions.pop()?.dispose(); }
  }

  private post(message: HostToSearch): void {
    if (this.ready) { void this.view?.webview.postMessage(message); }
  }

  private postSeed(): void {
    if (this.pendingSeed !== undefined) { this.post({ type: "seed", query: this.pendingSeed }); }
    this.pendingSeed = undefined;
  }

  private target(): Target | undefined {
    const project = this.activeFile ? findOwningProject(this.deps.projects, this.activeFile) : undefined;
    const logger = this.deps.host.current()?.logger;
    return project && logger && this.activeFile ? { project, file: this.activeFile, logger } : undefined;
  }

  private scopeOf(target: Target, mode: SearchScopeMode): SearchScope {
    return { mode, folder: target.project.folder, file: target.file, paths: this.deps.projects.paths, fs: this.deps.projects.fs };
  }

  private postScope(): void {
    const target = this.target();
    this.post({
      type: "scope",
      scope: target ? { project: target.project.settings.id, folder: target.project.folder, file: deriveBuildRootPath(this.deps.projects.paths, target.project, target.file) } : null,
    });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.search(), DEBOUNCE_MS);
  }

  private async search(): Promise<void> {
    clearTimeout(this.timer);
    const ticket = ++this.run;
    const { request } = this;
    if (!request) { return; }
    const target = this.target();
    try {
      const result = target
        ? await runSearch(request.query, request.options, this.scopeOf(target, request.mode), target.logger)
        : createEmptySearchRun();
      if (ticket !== this.run) { return; }
      this.searched = result.paths;
      this.pattern = result.pattern;
      this.post(result.message);
    } catch (error) {
      await target?.logger.error(SEARCH_LOG_MODULE, error, { action: "search" });
      if (ticket === this.run) { this.post({ type: "invalid", message: `Search failed: ${error instanceof Error ? error.message : String(error)}` }); }
    }
  }

  private async handle(raw: unknown): Promise<void> {
    const message = parseSearchMessage(raw);
    if (!message) { return; }
    if (message.type === "ready") {
      this.ready = true;
      this.request = undefined;
      this.postScope();
      this.postSeed();
    } else if (message.type === "search") {
      this.request = { query: message.query, options: message.options, mode: message.scope };
      this.schedule();
    } else {
      await this.act(message);
    }
  }

  /** Opens or replaces, only in files the last search covered: the page is not trusted with arbitrary paths. */
  private async act(message: Exclude<SearchToHost, { type: "ready" } | { type: "search" }>): Promise<void> {
    const target = this.target();
    const { pattern, request } = this;
    if (!target || !pattern || !request) { return; }
    if (message.type === "open") {
      if (this.searched.has(message.path)) { await openMatch(message); }
      return;
    }
    const texts = message.type === "replace" ? [] : await readScopeTexts(this.scopeOf(target, request.mode), target.logger);
    const matches = message.type === "replace" ? [message] : findMatchesIn(texts, pattern, message.type === "replaceFile" ? message.path : undefined);
    if (matches.some(({ path }) => !this.searched.has(path))) { return; }
    const done = await writeReplacementsInProject({ matches, pattern, replacement: message.replacement, logger: target.logger, confirm: message.type === "replaceAll" });
    if (done) { await this.search(); }
  }
}
