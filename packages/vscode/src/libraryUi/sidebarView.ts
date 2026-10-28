// Hosts the Library sidebar webview: sends it the folders and papers, and runs what its rows ask for.
import * as vscode from "vscode";
import {
  PAPERS_DIR,
  createDebouncer,
  deriveSidebarRows,
  deriveFolderTree,
  type LibrarySnapshot,
  type PathOps,
  type SidebarOpenProject,
  type SidebarProjectItem,
  type ProjectEntry,
  parseSidebarMessage,
  type HostToSidebar,
  type ProjectTreeMessage,
  type SidebarToHost,
  type ProjectAction,
} from "@labshelf/core";
import { onPaperChange, type LibraryEvents } from "../library/index.js";
import { sharingWebviews } from "../share/index.js";
import { readLibraryBundleDir, listPanelHtml } from "./listPanel.js";
import { createLibraryPaths, createLibraryRootNode, type LibraryPaths, type LibraryNode } from "./paths.js";
import { runProjectUpdate, runProjectFolderAction, type ProjectOrganizerPort } from "./organizer.js";
import { answerSidebarSpaceMessage, type SidebarSpacesDep } from "./handlers.js";
import { canApplyProjectCommand, isSidebarProjectCommand } from "./projectCommands.js";
import { disposeAll } from "../disposables/index.js";

/** What the host needs to know about the projects the sidebar lists. */
interface SidebarProjectsPort {
  find(id: string): ProjectEntry | undefined;
}

const ACTION_COMMANDS: Record<ProjectAction, string> = {
  browseTemplates: "labshelf.templates.open",
  allProjects: "labshelf.projects.all",
  newBlank: "labshelf.writing.newBlankProject",
  addExisting: "labshelf.writing.addExistingFolder",
  refresh: "labshelf.writing.refresh",
};

type ProjectMessage = Extract<SidebarToHost, { type: "openProject" | "projectCommand" | "projectAction" }>;

const isProjectMessage = (m: SidebarToHost): m is ProjectMessage =>
  m.type === "openProject" || m.type === "projectCommand" || m.type === "projectAction";

/** Runs one project message; a row the host does not list, or a command that does not apply to it, is ignored. */
async function handleProjectMessage(m: ProjectMessage, projects: SidebarProjectsPort): Promise<void> {
  if (m.type === "projectAction") { await vscode.commands.executeCommand(ACTION_COMMANDS[m.action]); return; }
  const entry = projects.find(m.id);
  if (!entry) { return; }
  const command = m.type === "openProject" ? "labshelf.writing.openProject" : m.command;
  if (!canApplyProjectCommand(command, { kind: entry.kind, external: entry.location === "external" })) { return; }
  await vscode.commands.executeCommand(command, entry);
}

const REFRESH_DEBOUNCE_MS = 60;

/** The writing projects the Projects section lists. */
export interface SidebarProjectsDep extends SidebarProjectsPort, ProjectOrganizerPort {
  onDidChange: vscode.Event<void>;
  rows(): Promise<SidebarProjectItem[]>;
}

/** The open project's Files, Outline and Checklist, as the Projects section shows them. */
export interface SidebarProjectTreesDep {
  onDidChange: vscode.Event<void>;
  snapshot(): Promise<SidebarOpenProject | null>;
  handle(request: Omit<ProjectTreeMessage, "type">): Promise<void>;
}

export interface LibrarySidebarDeps {
  extensionUri: vscode.Uri;
  /** The active library's current snapshot, or undefined while none is configured. */
  getSnapshot: () => LibrarySnapshot | undefined;
  events: LibraryEvents;
  paths: PathOps;
  importFiles: (uris: vscode.Uri[], targetDir: string) => Promise<void>;
  moveFolder: (sourceDir: string, targetDir: string) => Promise<void>;
  projects: SidebarProjectsDep;
  spaces?: SidebarSpacesDep;
  projectTrees: SidebarProjectTreesDep;
}

function parseUriList(raw: string): vscode.Uri[] {
  return raw.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).flatMap((line) => {
    try { return [vscode.Uri.parse(line, true)]; } catch { return []; }
  }).filter((u) => u.scheme === "file");
}

export class LibrarySidebarView implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _ready = false;
  private _papersRoot: vscode.Uri | null = null;
  private readonly _refresh = createDebouncer(() => void this._push(), REFRESH_DEBOUNCE_MS);
  private readonly _subscriptions: vscode.Disposable[] = [];
  private _stopSpaces: (() => void) | undefined;
  private readonly _refreshProjectsSoon = createDebouncer(() => void this._pushProjects(), REFRESH_DEBOUNCE_MS);
  // Replayed once the webview is ready, so a hidden sidebar still opens on the list's folder and paper.
  private _current: HostToSidebar | null = null;
  private _selected: HostToSidebar | null = null;

  constructor(private readonly _deps: LibrarySidebarDeps) {
    // A folder move emits one paper:updated per paper, so event refreshes are coalesced.
    const refresh = (): void => this.refresh();
    this._subscriptions.push(onPaperChange(_deps.events, refresh));
    this._bindSpaces();
    if (_deps.spaces) this._subscriptions.push(_deps.spaces.onDidChange(() => { this._bindSpaces(); this.refresh(); }));
    this._subscriptions.push(_deps.projects.onDidChange(() => this._refreshProjects()));
    this._subscriptions.push(_deps.projectTrees.onDidChange(() => void this._pushOpenProject()));
  }

  dispose(): void {
    this._stopSpaces?.();
    disposeAll(this._subscriptions);
    this._refresh.cancel();
    this._refreshProjectsSoon.cancel();
    this._ready = false;
    this._view = undefined;
  }

  private _bindSpaces(): void {
    this._stopSpaces?.();
    this._stopSpaces = this._deps.spaces?.current()?.store.onChange(() => this.refresh());
  }

  private async _pushSpaces(): Promise<void> {
    const current = this._deps.spaces?.current();
    await this._post({ type: "spaces", rows: current ? deriveSidebarRows(current.store.list(), current.port.library()) : [] });
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this._view = view;
    this._ready = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [readLibraryBundleDir(this._deps.extensionUri)] };
    view.webview.onDidReceiveMessage((raw: unknown) => { const m = parseSidebarMessage(raw, isSidebarProjectCommand); if (m) { void this._handle(m); } });
    const sharing = sharingWebviews.attach(view.webview, { opensDialogs: true });
    view.onDidDispose(() => { this._view = undefined; this._ready = false; sharing.dispose(); });
    view.webview.html = await listPanelHtml(view.webview, this._deps.extensionUri, "sidebar");
  }

  /** Points the sidebar at a library's papers root, then refreshes. */
  setLibrary(papersRoot: vscode.Uri): void {
    this._papersRoot = papersRoot;
    this.refresh();
  }

  /** Re-sends the library to the webview, debounced. */
  refresh(): void {
    this._refresh.call();
  }

  private _refreshProjects(): void {
    this._refreshProjectsSoon.call();
  }

  /** Marks the folder the list panel shows. */
  showFolder(folder: LibraryNode): void {
    const ui = this._paths()?.toUi(folder.dirPath);
    if (!ui) { return; }
    this._current = { type: "current", folder: ui };
    void this._post(this._current);
  }

  /** Marks the paper the list panel selected. */
  showPaper(id: string): void {
    this._selected = { type: "selected", id };
    void this._post(this._selected);
  }

  private _paths(): LibraryPaths | null {
    return this._papersRoot ? createLibraryPaths(this._papersRoot.fsPath, this._deps.paths) : null;
  }

  private _post(m: HostToSidebar): Thenable<boolean> | undefined {
    return this._ready ? this._view?.webview.postMessage(m) : undefined;
  }

  private async _push(): Promise<void> {
    await this._pushSpaces();
    const snapshot = this._deps.getSnapshot();
    if (!snapshot || !this._papersRoot || !this._ready) { return; }
    const papers = [...snapshot.papers.values()].map(({ record: { id, title, status, tags }, collection }) =>
      ({ record: { id, title, status, ...(tags ? { tags } : {}) }, folder: collection ? `${PAPERS_DIR}/${collection}` : PAPERS_DIR }));
    await this._post({ type: "library", folders: deriveFolderTree(snapshot), papers });
  }

  private async _pushProjects(): Promise<void> {
    if (!this._ready) { return; }
    await this._post({ type: "projects", projects: await this._deps.projects.rows() });
  }

  private async _pushOpenProject(): Promise<void> {
    if (!this._ready) { return; }
    await this._post({ type: "openProject", project: await this._deps.projectTrees.snapshot() });
  }

  private _node(ui: string): LibraryNode {
    const dirPath = this._paths()!.fromUi(ui);
    return ui === PAPERS_DIR ? createLibraryRootNode(dirPath) : { label: ui.slice(ui.lastIndexOf("/") + 1), dirPath };
  }

  private async _handle(m: SidebarToHost): Promise<void> {
    if (m.type === "spaceAction") {
      if (this._deps.spaces) await answerSidebarSpaceMessage(m, this._deps.spaces);
      return;
    }
    if (m.type === "refresh") { await vscode.commands.executeCommand("labshelf.library.refresh"); return; }
    if (m.type === "ready") {
      this._ready = true;
      // Neither push waits for the other: a slow project count must not delay the library.
      void this._pushProjects();
      void this._pushOpenProject();
      await this._push();
      for (const replay of [this._current, this._selected]) { if (replay) { await this._post(replay); } }
      return;
    }
    if (m.type === "projectFolder") { await runProjectFolderAction(this._deps.projects, m.action, m.path); return; }
    if (m.type === "projectTree") { const { type: _, ...request } = m; await this._deps.projectTrees.handle(request); return; }
    if (m.type === "projectEdit") { await runProjectUpdate(this._deps.projects, m.id, m.edit); return; }
    if (isProjectMessage(m)) { await handleProjectMessage(m, this._deps.projects); return; }
    if (m.type === "searchTag") { await vscode.commands.executeCommand("labshelf.searchListTag", m.tag); return; }
    if (m.type === "revealPaper") { await vscode.commands.executeCommand("labshelf.revealPaper", m.id); return; }
    if (!this._paths()) { return; }
    const node = this._node(m.path);
    switch (m.type) {
      case "openFolder": await vscode.commands.executeCommand("labshelf.openListTab", node); break;
      case "createFolder": await vscode.commands.executeCommand("labshelf.newFolder", node); break;
      case "addFiles": await vscode.commands.executeCommand("labshelf.addPaperHere", node); break;
      case "renameFolder": await vscode.commands.executeCommand("labshelf.renameFolder", node); break;
      case "removeFolder": await vscode.commands.executeCommand("labshelf.deleteFolder", node); break;
      case "import": { const uris = parseUriList(m.uris); if (uris.length > 0) { await this._deps.importFiles(uris, node.dirPath); } break; }
      case "moveFolder": await this._deps.moveFolder(node.dirPath, this._node(m.target).dirPath); break;
    }
  }
}
