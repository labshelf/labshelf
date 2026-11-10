// Hosts the VS Code Spaces surface: the service for the active library, Research chat and registration; the editor panels are in spacesPanels.ts.
import * as vscode from "vscode";
import {
  HomeStore,
  SpaceStore,
  type ChecklistReader,
  type ILogger,
  type PathOps,
  type Progress,
  type ProjectLibraryPort,
  type ProjectRow,
  type ReadyProject,
  type SpaceProjectChat,
  type SpacesHostPort,
  type ServeSpacesOptions,
  createLibraryLayout,
  createSpaceProjectList,
  projectExcerpt,
  deriveSpaceChecklistProgress,
  readChecklistSignals,
} from "@labshelf/core";
import type { HostAdapters, LibraryRootController, WritingViewResult } from "../activation/index.js";
import type { ActiveServices } from "../command/index.js";
import { disposeAll } from "../disposables/index.js";
import { createSpaceNoteFiles, createVsCodeNoteFileIo } from "../reader/index.js";
import { resolveSideChatView, toggleSideChatView, type SideChatBundle } from "../ui/index.js";
import type { SpaceSharingHost } from "./spaceSharing.js";
import { registerSpacesPanels } from "./spacesPanels.js";
import { projectChatOptions } from "../writing/projectChat/index.js";
import { createCodeLinkSource } from "../writing/index.js";

interface SpacesPortOptions {
  services: ActiveServices;
  projectLibrary: () => ProjectLibraryPort;
  readChecklist: ChecklistReader;
  projectId: (hostId: string) => string | undefined;
  logger: ILogger;
  selectPaper: (id: string) => Promise<void>;
  paths: Pick<PathOps, 'join'>;
  projectChat: (projectId: string) => Promise<SpaceProjectChat | undefined>;
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
    projectChat: options.projectChat,
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
  /** The Project chat of a shared project by its settings id, for the Discussions of the Spaces linking it. */
  projectChat: (projectId: string) => Promise<SpaceProjectChat | undefined>;
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

export async function readProjectChecklist(writing: WritingViewResult, row: ProjectRow): Promise<Progress | undefined> {
  const project = writing.projects.list().find(entry => entry.folder === row.id);
  if (project?.kind !== "ready") { return undefined; }
  const [signals, list] = await Promise.all([
    readChecklistSignals(writing.projects.reads(writing.logger), project, undefined, undefined, createCodeLinkSource(writing.projects.paths, project.folder)),
    writing.readingLists.of(project),
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
    projectChat: async id => {
      const entry = writing.projects.list().find((project): project is ReadyProject => project.kind === "ready" && project.settings.id === id);
      return entry ? projectChatOptions(entry, writing.logger) : undefined;
    },
  });
  const panels = registerSpacesPanels(context, spaces);
  const chat = new ResearchChatView(context.extensionUri, panels, writing.logger);
  context.subscriptions.push(spaces, chat,
    vscode.window.registerWebviewViewProvider("labshelf.researchChat", chat),
    vscode.commands.registerCommand("labshelf.researchChat.toggle", () => chat.toggle()));
  return spaces;
}

function researchChatBundle(extensionUri: vscode.Uri): SideChatBundle {
  return { dir: vscode.Uri.joinPath(extensionUri, "dist", "spaces"), script: "chat.js", style: "chat.css", title: "Research chat", file: "dist/spaces/chat.js" };
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
    await resolveSideChatView(view, this.extensionUri, researchChatBundle(this.extensionUri), () => this.postContext(), () => {
      if (this.view === view) { this.view = undefined; }
    });
  }

  toggle(): Promise<void> { return toggleSideChatView(this.view, "labshelf.researchChat"); }

  private postContext(): void {
    if (!this.view) { return; }
    void Promise.resolve(this.view.webview.postMessage({ type: "context", name: this.source.context() })).catch(error => {
      void this.logger.error("spaces/chat", error, { action: "post Research chat context" });
    });
  }

  dispose(): void { disposeAll(this.subscriptions); }
}
