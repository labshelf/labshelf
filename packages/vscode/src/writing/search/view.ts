// Serves the Project Search panel: its HTML shell, its searches on the active file's writing project, its opens and replacements, and the command that focuses it.
import * as vscode from "vscode";

import {
  createDebouncer, createEmptySearchRun, createNonce, findMatchesIn, formatError, parseSearchMessage, searchProjectTexts,
  type HostToSearch, type ILogger, type MatchPosition, type SearchOptions, type SearchRun, type SearchScopeKind, type SearchToHost,
} from "@labshelf/core";
import { hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";
import { openSourceAt } from "../openSourceAt.js";
import { deriveBuildRootPath, findOwningProject, type ProjectFinder, type ReadyProject } from "../projects/index.js";
import type { WritingHost, WritingProjects } from "../projects/index.js";
import { readScopeTexts, SEARCH_LOG_MODULE, writeReplacementsInProject, type SearchScope } from "./replace.js";

const PROJECT_SEARCH_VIEW = "labshelf.writing.projectSearch";
const SEARCH_IN_PROJECT_COMMAND = "labshelf.writing.searchInProject";
const DEBOUNCE_MS = 200;

interface ProjectSearchDeps {
  extensionUri: vscode.Uri;
  projects: ProjectFinder & Pick<WritingProjects, "fs">;
  host: WritingHost;
}

interface RegisterProjectSearchDeps extends Omit<ProjectSearchDeps, "extensionUri"> {
  context: vscode.ExtensionContext;
}

interface SearchRequest {
  query: string;
  options: SearchOptions;
  mode: SearchScopeKind;
}

/** The project that owns the active file, with what the searches and their log need. */
interface Target {
  project: ReadyProject;
  file: string;
  logger: ILogger;
}

const fileEditorPath = (editor: vscode.TextEditor | undefined): string | undefined =>
  editor?.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined;

function selectedQuery(editor: vscode.TextEditor | undefined): string {
  if (!editor) { return ""; }
  const { selection, document } = editor;
  return selection.isEmpty || !selection.isSingleLine ? "" : document.getText(selection);
}

/** <extension>/dist/search, for localResourceRoots. */
function readSearchBundleDir(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "search");
}

export async function searchHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = readSearchBundleDir(extensionUri);
  const script = vscode.Uri.joinPath(dir, "search.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "Project Search", heading: "Project Search bundle not built", file: "dist/search/search.js", reopen: "the panel" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: "Project Search",
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "search.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
}

async function openMatch({ path, line, column, length }: MatchPosition): Promise<void> {
  const range = new vscode.Range(line, column, line, column + length);
  await openSourceAt(vscode.Uri.file(path), line + 1, { selection: range });
}

async function runSearch(query: string, options: SearchOptions, scope: SearchScope, logger: ILogger): Promise<SearchRun> {
  if (query === "") { return createEmptySearchRun(); }
  return searchProjectTexts(query, options, scope, await readScopeTexts(scope, logger));
}

class ProjectSearchView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private pendingSeed: string | undefined;
  private request: SearchRequest | undefined;
  private pattern: RegExp | undefined;
  private searched: ReadonlySet<string> = new Set();
  /** The last file editor, kept while a non-text tab is in front so the panel keeps its project. */
  private activeFile = fileEditorPath(vscode.window.activeTextEditor);
  private run = 0;
  private readonly searchSoon = createDebouncer(() => void this.search(), DEBOUNCE_MS);
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
    view.webview.options = { enableScripts: true, localResourceRoots: [readSearchBundleDir(this.deps.extensionUri), webviewChunksDir(this.deps.extensionUri)] };
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
    this.searchSoon.cancel();
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

  private scopeOf(target: Target, mode: SearchScopeKind): SearchScope {
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
    this.searchSoon.call();
  }

  private async search(): Promise<void> {
    this.searchSoon.cancel();
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
      if (ticket === this.run) { this.post({ type: "invalid", message: `Search failed: ${formatError(error)}` }); }
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

export function registerProjectSearch({ context, projects, host }: RegisterProjectSearchDeps): void {
  const view = new ProjectSearchView({ extensionUri: context.extensionUri, projects, host });
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(PROJECT_SEARCH_VIEW, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand(SEARCH_IN_PROJECT_COMMAND, async () => {
      const query = selectedQuery(vscode.window.activeTextEditor);
      if (query !== "") { view.seed(query); }
      await vscode.commands.executeCommand(`${PROJECT_SEARCH_VIEW}.focus`);
    }),
  );
}
