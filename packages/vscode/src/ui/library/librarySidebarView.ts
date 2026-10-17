// Hosts the Library sidebar webview: sends it the folders and papers, and runs what its rows ask for.
import * as vscode from "vscode";
import { PAPERS_DIR, folderTreeFromSnapshot, type LibrarySnapshot, type PathOps } from "@labshelf/core";
import { onPaperChange, type LibraryEvents } from "../../events/index.js";
import { libraryBundleDirectory, libraryPaths, listPanelHtml, type LibraryPaths } from "../list/index.js";
import { rootNode, type LibraryNode } from "./libraryNode.js";
import { handleProjectMessage, isProjectMessage, type SidebarProjectsPort } from "./sidebarProjectMessages.js";
import { parseSidebarMessage, type HostToSidebar, type SidebarProjectItem, type SidebarToHost } from "./sidebarMessages.js";

const REFRESH_DEBOUNCE_MS = 60;

/** The writing projects the Projects section lists. */
export interface SidebarProjectsDep extends SidebarProjectsPort {
  onDidChange: vscode.Event<void>;
  rows(): Promise<SidebarProjectItem[]>;
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
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _projectsTimer: ReturnType<typeof setTimeout> | null = null;
  // Replayed once the webview is ready, so a hidden sidebar still opens on the list's folder and paper.
  private _current: HostToSidebar | null = null;
  private _selected: HostToSidebar | null = null;

  constructor(private readonly _deps: LibrarySidebarDeps) {
    // A folder move emits one paper:updated per paper, so event refreshes are coalesced.
    const refresh = (): void => this.refresh();
    onPaperChange(_deps.events, refresh);
    _deps.projects.onDidChange(() => this._refreshProjects());
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this._view = view;
    this._ready = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [libraryBundleDirectory(this._deps.extensionUri)] };
    view.webview.onDidReceiveMessage((raw: unknown) => { const m = parseSidebarMessage(raw); if (m) { void this._handle(m); } });
    view.onDidDispose(() => { this._view = undefined; this._ready = false; });
    view.webview.html = await listPanelHtml(view.webview, this._deps.extensionUri, "sidebar");
  }

  /** Points the sidebar at a library's papers root, then refreshes. */
  setLibrary(papersRoot: vscode.Uri): void {
    this._papersRoot = papersRoot;
    this.refresh();
  }

  /** Re-sends the library to the webview, debounced. */
  refresh(): void {
    if (this._timer) { clearTimeout(this._timer); }
    this._timer = setTimeout(() => { this._timer = null; void this._push(); }, REFRESH_DEBOUNCE_MS);
  }

  private _refreshProjects(): void {
    if (this._projectsTimer) { clearTimeout(this._projectsTimer); }
    this._projectsTimer = setTimeout(() => { this._projectsTimer = null; void this._pushProjects(); }, REFRESH_DEBOUNCE_MS);
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
    return this._papersRoot ? libraryPaths(this._papersRoot.fsPath, this._deps.paths) : null;
  }

  private _post(m: HostToSidebar): Thenable<boolean> | undefined {
    return this._ready ? this._view?.webview.postMessage(m) : undefined;
  }

  private async _push(): Promise<void> {
    const snapshot = this._deps.getSnapshot();
    if (!snapshot || !this._papersRoot || !this._ready) { return; }
    const papers = [...snapshot.papers.values()].map(({ record: { id, title, status, tags }, collection }) =>
      ({ record: { id, title, status, ...(tags ? { tags } : {}) }, folder: collection ? `${PAPERS_DIR}/${collection}` : PAPERS_DIR }));
    await this._post({ type: "library", folders: folderTreeFromSnapshot(snapshot), papers });
  }

  private async _pushProjects(): Promise<void> {
    if (!this._ready) { return; }
    await this._post({ type: "projects", projects: await this._deps.projects.rows() });
  }

  private _node(ui: string): LibraryNode {
    const dirPath = this._paths()!.fromUi(ui);
    return ui === PAPERS_DIR ? rootNode(dirPath) : { label: ui.slice(ui.lastIndexOf("/") + 1), dirPath };
  }

  private async _handle(m: SidebarToHost): Promise<void> {
    if (m.type === "refresh") { await vscode.commands.executeCommand("labshelf.library.refresh"); return; }
    if (m.type === "ready") {
      this._ready = true;
      // Neither push waits for the other: a slow project count must not delay the library.
      void this._pushProjects();
      await this._push();
      for (const replay of [this._current, this._selected]) { if (replay) { await this._post(replay); } }
      return;
    }
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
