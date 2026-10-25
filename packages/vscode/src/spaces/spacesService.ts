// Maintains Spaces services for the active VS Code library root.
import * as vscode from 'vscode';
import {
  SpaceStore,
  type ChecklistReader,
  type ILogger,
  type PathOps,
  type ProjectLibraryPort,
  type SpacesHostPort,
  buildSpaceProjectInfos,
} from '@labshelf/core';
import type { LibraryRootController } from '../activation/index.js';
import type { ActiveServices } from '../command/index.js';

interface SpacesPortOptions {
  services: ActiveServices;
  projectLibrary: () => ProjectLibraryPort;
  readChecklist: ChecklistReader;
  projectId: (hostId: string) => string | undefined;
  logger: ILogger;
  selectPaper: (id: string) => Promise<void>;
}

function createSpacesHostPort(options: SpacesPortOptions): SpacesHostPort {
  const { services, projectLibrary, readChecklist, logger } = options;
  return {
    library: () => services.library.snapshot.papers,
    onLibraryChange: (listener) => services.library.onChange(listener),
    projects: async () => {
      const rows = await projectLibrary().list();
      const infos = await buildSpaceProjectInfos(rows, readChecklist, logger);
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

export interface ActiveSpaces {
  store: SpaceStore;
  port: SpacesHostPort;
  logger: ILogger;
}

export interface SpacesServiceOptions {
  controller: Pick<LibraryRootController, 'currentRoot' | 'currentServices' | 'onDidChangeRoot' | 'require'>;
  paths: Pick<PathOps, 'join'>;
  projectLibrary: () => ProjectLibraryPort;
  readChecklist: ChecklistReader;
  projectId: (hostId: string) => string | undefined;
  logger: ILogger;
  selectPaper: (id: string) => Promise<void>;
}

export class SpacesService implements vscode.Disposable {
  private active: ActiveSpaces | undefined;
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changes.event;
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
    this.rootSubscriptions.forEach((subscription) => subscription.dispose());
    const store = new SpaceStore({ root: root.fsPath, fs: services.fileSystem, paths: this.options.paths, logger: services.logger });
    const port = createSpacesHostPort({ ...this.options, services, logger: services.logger });
    this.active = { store, port, logger: services.logger };
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, 'spaces/**'));
    const reload = (): void => {
      void store.reload().catch((error: unknown) => {
        void services.logger.error('spaces', error, { action: 'reload Spaces', root: root.fsPath });
      });
    };
    this.rootSubscriptions = [watcher, watcher.onDidCreate(reload), watcher.onDidChange(reload), watcher.onDidDelete(reload),
      { dispose: store.onChange(() => this.changes.fire()) },
      { dispose: port.onLibraryChange(() => this.changes.fire()) },
      { dispose: port.onProjectsChange(() => this.changes.fire()) },
    ];
    this.changes.fire();
    reload();
  }

  dispose(): void {
    this.rootSubscriptions.forEach((subscription) => subscription.dispose());
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.active = undefined;
    this.changes.dispose();
  }
}
