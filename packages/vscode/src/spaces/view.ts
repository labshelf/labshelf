// Hosts the VS Code Spaces surface: the service for the active library, editor panels, Research chat and registration.
import * as vscode from "vscode";
import {
  HomeStore,
  SPACE_TABS,
  SpaceStore,
  type ChecklistReader,
  type ILogger,
  type PathOps,
  type Progress,
  type ProjectLibraryPort,
  type ProjectRow,
  type SpaceTab,
  type SpacesEndpoint,
  type SpacesHostPort,
  type SpacesToHost,
  type ServeSpacesOptions,
  createLibraryLayout,
  createNonce,
  createSpaceProjectList,
  placeOfSpace,
  projectExcerpt,
  deriveSpaceChecklistProgress,
  readChecklistSignals,
  serveSpaces,
} from "@labshelf/core";
import type { HostAdapters, LibraryRootController, WritingViewResult } from "../activation/index.js";
import type { ActiveServices } from "../command/index.js";
import { disposeAll } from "../disposables/index.js";
import { createSpaceNoteFiles, createVsCodeNoteFileIo } from "../reader/index.js";
import { createTabIcon, cspImageSource, hasBundleFile, renderBundleMissingHtml, webviewChunksDir } from "../ui/index.js";
import type { SpaceSharingHost } from "./spaceSharing.js";

interface SpacesPortOptions {
  services: ActiveServices;
  projectLibrary: () => ProjectLibraryPort;
  readChecklist: ChecklistReader;
  projectId: (hostId: string) => string | undefined;
  logger: ILogger;
  selectPaper: (id: string) => Promise<void>;
  paths: Pick<PathOps, 'join'>;
}

function createSpacesHostPort(options: SpacesPortOptions): SpacesHostPort {
  const { services, projectLibrary, readChecklist, logger } = options;
  return {
    library: () => services.library.snapshot.papers,
    onLibraryChange: (listener) => services.library.onChange(listener),
    projects: async () => {
      const rows = await projectLibrary().list();
      const infos = await createSpaceProjectList(rows, readChecklist, logger);
      return infos.flatMap((info) => {
        const id = options.projectId(info.projectId);
        return id ? [{ ...info, projectId: id }] : [];
      });
    },
    onProjectsChange: (listener) => projectLibrary().onDidChange(listener),
    openPaper: async (id) => { await vscode.commands.executeCommand('labshelf.openPaperPdf', id); },
    selectPaper: options.selectPaper,
    openProject: async (id) => {
      const row = (await projectLibrary().list()).find((row) => options.projectId(row.id) === id);
      if (!row) throw new Error(`Project ${id} is unavailable`);
      await projectLibrary().open(row.id);
    },
    readProjectExcerpt: async (id) => {
      const row = (await projectLibrary().list()).find((row) => options.projectId(row.id) === id);
      if (!row?.main || row.broken !== undefined) return undefined;
      return projectExcerpt(await services.fileSystem.readText(options.paths.join(row.id, row.main)));
    },
    openSpace: async (id, tab) => { await vscode.commands.executeCommand('labshelf.spaces.open', id, tab); },
    openCatalog: async () => { await vscode.commands.executeCommand('labshelf.spaces.all'); },
    saveFile: (name, text) => saveFile(name, text, logger),
  };
}

async function saveFile(name: string, text: string, logger: ILogger): Promise<void> {
  try {
    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(name), saveLabel: 'Save' });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
    void logger.log('INFO', 'spaces', 'Space export saved', { path: target.toString() });
  } catch (error) {
    void logger.error('spaces', error, { action: 'save export', name });
    throw error;
  }
}

/** Runs a note's code cell, restarts a note's process and installs the Python it needs; Spaces show Run only when present. */
export type SpacesCellHosts = Pick<ServeSpacesOptions, "runCell" | "restartCell" | "installPython" | "runMath">;

export interface ActiveSpaces extends SpacesCellHosts, Pick<ServeSpacesOptions, "noteFiles" | "home"> {
  store: SpaceStore;
  port: SpacesHostPort;
  /** The member's display name from the sharing host; absent where none is provided, so serveSpaces stamps its default. */
  author?: () => string;
  logger: ILogger;
  /** The absolute `spaces/<id>` folder of a Space in this library. */
  spaceDir(id: string): string;
}

export interface SpacesServiceOptions {
  controller: Pick<LibraryRootController, 'currentRoot' | 'currentServices' | 'onDidChangeRoot' | 'require'>;
  paths: Pick<PathOps, 'join'>;
  projectLibrary: () => ProjectLibraryPort;
  readChecklist: ChecklistReader;
  projectId: (hostId: string) => string | undefined;
  logger: ILogger;
  selectPaper: (id: string) => Promise<void>;
  cells?: SpacesCellHosts;
}

export class SpacesService implements vscode.Disposable {
  private active: ActiveSpaces | undefined;
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changes.event;
  private readonly spacesChanged = new vscode.EventEmitter<void>();
  /** Fires when the Space list may differ: a change of library or a reload of its Spaces. */
  readonly onDidChangeSpaces = this.spacesChanged.event;
  private sharing: SpaceSharingHost | undefined;
  private readonly subscriptions: vscode.Disposable[];
  private rootSubscriptions: vscode.Disposable[] = [];

  constructor(private readonly options: SpacesServiceOptions) {
    this.subscriptions = [
      options.controller.onDidChangeRoot((change) => this.bind(change)),
      vscode.commands.registerCommand('labshelf.spaces.new', () => this.createSpace()),
    ];
    const root = options.controller.currentRoot();
    const services = options.controller.currentServices();
    if (root && services) this.bind({ root, services });
  }

  current(): ActiveSpaces | undefined { return this.active; }

  /** Adds the share actions to the Space pages of this and every later library; panels open already keep the port they had. */
  provideSharing(sharing: SpaceSharingHost): vscode.Disposable {
    this.sharing = sharing;
    if (this.active) {
      const { author, ...port } = sharing;
      this.active.port = { ...this.active.port, ...port };
      this.active.author = author;
    }
    return new vscode.Disposable(() => { if (this.sharing === sharing) this.sharing = undefined; });
  }

  async createSpace(): Promise<string | undefined> {
    await this.options.controller.require();
    const active = this.active;
    if (!active) return undefined;
    const name = await vscode.window.showInputBox({ prompt: 'Space name', ignoreFocusOut: true });
    if (!name?.trim()) return undefined;
    try {
      if (this.active !== active) throw new Error('The library changed while naming the Space');
      const id = await active.store.createSpace(name.trim());
      await active.port.openSpace(id);
      return id;
    } catch (error) {
      void active.logger.error('spaces', error, { action: 'create Space', name });
      await vscode.window.showErrorMessage(`Could not create Space: ${String(error)}`);
      return undefined;
    }
  }

  private bind({ root, services }: { root: vscode.Uri; services: ActiveServices }): void {
    disposeAll(this.rootSubscriptions);
    const store = new SpaceStore({ root: root.fsPath, fs: services.fileSystem, paths: this.options.paths, logger: services.logger });
    // Web VS Code provides no sharing, so its pages keep the default author and show no presence.
    const { author, ...sharing }: Partial<SpaceSharingHost> = this.sharing ?? {};
    const port: SpacesHostPort = { ...createSpacesHostPort({ ...this.options, services, logger: services.logger }), ...sharing };
    const { runCell, restartCell, installPython } = this.options.cells ?? {};
    // The desktop runCell port carries the runner's runMath beside it.
    const runMath = this.options.cells?.runMath ?? (runCell as (typeof runCell & Pick<SpacesCellHosts, "runMath">) | undefined)?.runMath;
    const layout = createLibraryLayout(root.fsPath, this.options.paths.join);
    const home = new HomeStore({ root: root.fsPath, fs: services.fileSystem, paths: this.options.paths, logger: services.logger });
    this.active = {
      store, port, home, logger: services.logger, spaceDir: layout.spaceDir,
      noteFiles: createSpaceNoteFiles(createVsCodeNoteFileIo(services.fileSystem, this.options.paths.join), layout.spaceDir),
      ...(runCell ? { runCell } : {}), ...(restartCell ? { restartCell } : {}), ...(installPython ? { installPython } : {}),
      ...(runMath ? { runMath } : {}), ...(author ? { author } : {}),
    };
    const homeWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, 'home.json'));
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, 'spaces/**'));
    const reload = (): void => {
      void store.reload().catch((error: unknown) => {
        void services.logger.error('spaces', error, { action: 'reload Spaces', root: root.fsPath });
      });
    };
    const homeChanged = (): void => home.changed();
    this.rootSubscriptions = [watcher, homeWatcher, homeWatcher.onDidCreate(homeChanged), homeWatcher.onDidChange(homeChanged), homeWatcher.onDidDelete(homeChanged), watcher.onDidCreate(reload), watcher.onDidChange(reload), watcher.onDidDelete(reload),
      { dispose: store.onChange(() => { this.spacesChanged.fire(); this.changes.fire(); }) },
      { dispose: port.onLibraryChange(() => this.changes.fire()) },
      { dispose: port.onProjectsChange(() => this.changes.fire()) },
    ];
    this.spacesChanged.fire();
    this.changes.fire();
    reload();
  }

  dispose(): void {
    disposeAll(this.rootSubscriptions);
    disposeAll(this.subscriptions);
    this.active = undefined;
    this.changes.dispose();
    this.spacesChanged.dispose();
  }
}

interface SpacesView { view: "catalog" | "space" | "home"; id?: string; tab?: SpaceTab }
const spacesBundleDirectory = (extension: vscode.Uri): vscode.Uri => vscode.Uri.joinPath(extension, "dist", "spaces");

async function spacesHtml(webview: vscode.Webview, extension: vscode.Uri, view: SpacesView): Promise<string> {
  const dir = spacesBundleDirectory(extension);
  const script = vscode.Uri.joinPath(dir, "spaces.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "Spaces", heading: "Spaces bundle not built", file: "dist/spaces/spaces.js", reopen: "Spaces" });
  }
  const nonce = createNonce();
  const config = JSON.stringify(view).replace(/</g, "\\u003c");
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource};${cspImageSource(webview.cspSource, "qmd")} font-src ${webview.cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Spaces</title><link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "spaces.css"))}"/>
</head><body><div id="root"></div><script nonce="${nonce}" type="application/json" id="spaces-config">${config}</script>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script)}"></script></body></html>`;
}

type Binding = Omit<ServeSpacesOptions, "today">;
class SpacesPanel {
  private disposed = false;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly stop: () => void;
  readonly panel: vscode.WebviewPanel;

  constructor(extension: vscode.Uri, readonly view: SpacesView, title: string, binding: Binding, activate: () => void, close: () => void) {
    const panel = this.panel = vscode.window.createWebviewPanel("labshelfSpaces", title, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [spacesBundleDirectory(extension), webviewChunksDir(extension)],
    });
    panel.iconPath = createTabIcon(extension);
    const handlers = new Set<(message: SpacesToHost) => void>();
    const endpoint: SpacesEndpoint = {
      post: message => { if (!this.disposed) void panel.webview.postMessage(message); },
      subscribe: handler => { handlers.add(handler); return () => { handlers.delete(handler); }; },
    };
    this.subscriptions.push(panel.webview.onDidReceiveMessage(raw => handlers.forEach(handler => handler(raw))));
    this.stop = serveSpaces(endpoint, { ...binding, today: () => new Date().toLocaleDateString("en-CA") });
    this.subscriptions.push(panel.onDidChangeViewState(activate), panel.onDidDispose(() => { this.dispose(); close(); }));
    void spacesHtml(panel.webview, extension, view).then(html => { if (!this.disposed) panel.webview.html = html; }).catch(error => {
      void binding.logger.log("ERROR", "spaces/panel", "Spaces page could not load", { view: view.view, id: view.id, error: String(error) });
      void vscode.window.showErrorMessage(`Could not open Spaces: ${String(error)}`);
    });
    void binding.logger.log("INFO", "spaces/panel", "Spaces panel opened", { view: view.view, id: view.id });
  }

  reveal(tab?: SpaceTab): void {
    this.panel.reveal(vscode.ViewColumn.One);
    if (tab) void this.panel.webview.postMessage({ type: "spaces.navigate", tab });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.panel.dispose();
    disposeAll(this.subscriptions);
  }
}

/** The panel key of Home; Space ids never start with "#". */
const HOME_KEY = "#home";

class SpacesPanelRegistry implements vscode.Disposable {
  private readonly panels = new Map<string, SpacesPanel>();
  private readonly changed = new vscode.EventEmitter<string | null>();
  readonly onDidChangeContext = this.changed.event;
  private active: SpacesPanel | undefined;
  private name: string | null = null;
  private binding: ReturnType<SpacesService["current"]>;
  private stopStore: (() => void) | undefined;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly extension: vscode.Uri, private readonly spaces: SpacesService) {
    this.binding = spaces.current();
    this.bindStore();
    this.subscription = spaces.onDidChange(() => {
      if (this.binding !== spaces.current()) {
        this.closePanels(); this.binding = spaces.current(); this.bindStore();
      } else this.refresh();
    });
  }

  context(): string | null { return this.name; }

  /** Opens the one Home panel, or reveals it. */
  openHome(): void {
    const binding = this.spaces.current();
    const existing = this.panels.get(HOME_KEY);
    if (existing || !binding) { existing?.reveal(); return; }
    const panel = new SpacesPanel(this.extension, { view: "home" }, "Home", binding, () => this.updateContext(),
      () => { this.panels.delete(HOME_KEY); if (this.active === panel) this.active = undefined; this.updateContext(); });
    this.panels.set(HOME_KEY, panel);
  }

  open(id?: string, tab?: unknown): void {
    const binding = this.spaces.current();
    if (!binding) return;
    const key = id ?? "";
    const selected = SPACE_TABS.includes(tab as SpaceTab) ? tab as SpaceTab : undefined;
    const existing = this.panels.get(key);
    if (existing) { existing.reveal(selected); this.active = existing; this.updateContext(); return; }
    const row = id ? binding.store.list().find(row => row.state === "ready" && row.space.id === id) : undefined;
    if (id && (!row || row.state !== "ready" || placeOfSpace(row.space) === "trash")) return;
    const view = id ? { view: "space" as const, id, ...(selected ? { tab: selected } : {}) } : { view: "catalog" as const };
    const panel = new SpacesPanel(this.extension, view, row?.state === "ready" ? row.space.name : "All Spaces", binding,
      () => { if (panel.panel.active) this.active = panel; this.updateContext(); },
      () => { this.panels.delete(key); if (this.active === panel) this.active = undefined; this.updateContext(); });
    this.panels.set(key, panel); this.active = panel; this.updateContext();
  }

  private updateContext(): void {
    const next = this.active?.panel.active && this.active.view.view === "space" ? this.active.panel.title : null;
    if (this.name !== next) { this.name = next; this.changed.fire(next); }
  }

  private refresh(): void {
    const rows = this.binding?.store.list() ?? [];
    for (const panel of [...this.panels.values()]) {
      if (!panel.view.id) continue;
      const row = rows.find(row => row.state === "ready" && row.space.id === panel.view.id);
      if (!row || (row.state === "ready" && placeOfSpace(row.space) === "trash")) panel.dispose();
      else if (row.state === "ready") panel.panel.title = row.space.name;
    }
    this.updateContext();
  }

  private bindStore(): void { this.stopStore?.(); this.stopStore = this.binding?.store.onChange(() => this.refresh()); }
  private closePanels(): void { for (const panel of [...this.panels.values()]) panel.dispose(); this.panels.clear(); }
  dispose(): void { this.closePanels(); this.stopStore?.(); this.subscription.dispose(); this.changed.dispose(); }
}

export interface SpacesPanelContext extends vscode.Disposable {
  context(): string | null;
  onDidChangeContext: vscode.Event<string | null>;
}

export function registerSpacesPanels(context: vscode.ExtensionContext, spaces: SpacesService): SpacesPanelContext {
  const registry = new SpacesPanelRegistry(context.extensionUri, spaces);
  context.subscriptions.push(registry,
    vscode.commands.registerCommand("labshelf.spaces.all", () => registry.open()),
    vscode.commands.registerCommand("labshelf.home", () => registry.openHome()),
    vscode.commands.registerCommand("labshelf.spaces.open", (id: unknown, tab?: unknown) => { if (typeof id === "string") registry.open(id, tab); }),
  );
  return registry;
}

export async function readProjectChecklist(writing: WritingViewResult, row: ProjectRow): Promise<Progress | undefined> {
  const project = writing.projects.list().find(entry => entry.folder === row.id);
  if (project?.kind !== "ready") { return undefined; }
  const [signals, list] = await Promise.all([
    readChecklistSignals(writing.projects.reads(writing.logger), project), writing.readingLists.of(project),
  ]);
  const reading = list.entries.flatMap(({ key, paper }) => paper ? [{ key, title: paper.title, status: paper.status }] : []);
  return deriveSpaceChecklistProgress(signals, reading);
}

export function registerSpaces(
  context: vscode.ExtensionContext, controller: LibraryRootController, adapters: HostAdapters, writing: WritingViewResult,
  selectPaper: (id: string) => Promise<void>, cells: SpacesCellHosts,
): SpacesService {
  const spaces = new SpacesService({
    controller, paths: adapters.paths, projectLibrary: writing.projectLibrary, logger: writing.logger, selectPaper, cells,
    projectId: hostId => {
      const entry = writing.projects.list().find(project => project.folder === hostId);
      return entry?.kind === "ready" ? entry.settings.id : undefined;
    },
    readChecklist: row => readProjectChecklist(writing, row),
  });
  const panels = registerSpacesPanels(context, spaces);
  const chat = new ResearchChatView(context.extensionUri, panels, writing.logger);
  context.subscriptions.push(spaces, chat,
    vscode.window.registerWebviewViewProvider("labshelf.researchChat", chat),
    vscode.commands.registerCommand("labshelf.researchChat.toggle", () => chat.toggle()));
  return spaces;
}

function researchChatBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "spaces");
}

async function researchChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = researchChatBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "chat.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "Research chat", heading: "Research chat bundle not built", file: "dist/spaces/chat.js", reopen: "Research chat" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource};${cspImageSource(webview.cspSource, "qmd")} font-src ${webview.cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Research chat</title><link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "chat.css"))}"/>
</head><body><div id="root"></div><script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script)}"></script></body></html>`;
}

interface SpaceContext {
  context(): string | null;
  onDidChangeContext: vscode.Event<string | null>;
}

class ResearchChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri, private readonly source: SpaceContext, private readonly logger: ILogger) {
    this.subscriptions.push(source.onDidChangeContext(() => this.postContext()));
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [researchChatBundleDirectory(this.extensionUri), webviewChunksDir(this.extensionUri)] };
    const messages = view.webview.onDidReceiveMessage((raw: unknown) => {
      if (raw && typeof raw === "object" && "type" in raw && raw.type === "ready") { this.postContext(); }
    });
    const disposed = view.onDidDispose(() => {
      messages.dispose();
      disposed.dispose();
      if (this.view === view) { this.view = undefined; }
    });
    view.webview.html = await researchChatHtml(view.webview, this.extensionUri);
  }

  async toggle(): Promise<void> {
    if (this.view?.visible) { await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar"); }
    else { await vscode.commands.executeCommand("labshelf.researchChat.focus"); }
  }

  private postContext(): void {
    if (!this.view) { return; }
    void Promise.resolve(this.view.webview.postMessage({ type: "context", name: this.source.context() })).catch(error => {
      void this.logger.error("spaces/chat", error, { action: "post Research chat context" });
    });
  }

  dispose(): void { disposeAll(this.subscriptions); }
}
