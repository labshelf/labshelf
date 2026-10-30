// Hosts the Details webview in the secondary sidebar and shows it the selected paper or project.
import * as vscode from "vscode";
import {
  type DetailsSelection,
  type ILogger,
  type SelectionHub,
  type ProjectLibraryPort,
  formatError,
  parseDetailsMessage,
  type HostToDetails,
  type DetailsToHost,
  type HostToUi,
  serveAllProjects,
  type AllProjectsEndpoint,
  type AllProjectsToHost,
  type HostToAllProjects,
} from "@labshelf/core";
import { webviewChunksDir } from "../ui/index.js";
import { readLibraryBundleDir, listPanelHtml, type ListPanelDeps } from "./listPanel.js";
import { createFeedHostCompositionRoot, LibraryFeed } from "./feed.js";
import { answerListMessage, type ListHostContext } from "./handlers.js";

interface ProjectsChannel {
  /** Hands a message the page sent on the projects channel to the server. */
  deliver(message: AllProjectsToHost): void;
  stop(): void;
}

function startProjectsChannel(post: (message: { channel: "projects"; msg: HostToAllProjects }) => void, port: ProjectLibraryPort, logger: ILogger): ProjectsChannel {
  const handlers = new Set<(message: AllProjectsToHost) => void>();
  const endpoint: AllProjectsEndpoint = {
    post: (msg) => post({ channel: "projects", msg }),
    subscribe: (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
  };
  const stop = serveAllProjects(endpoint, port, logger);
  return { deliver: (message) => handlers.forEach((handler) => handler(message)), stop };
}

interface LibraryChannel {
  /** True once the page's `ready` has been answered. */
  readonly ready: boolean;
  handle(message: Extract<DetailsToHost, { channel: "library" }>["msg"]): Promise<void>;
  dispose(): void;
}

interface LibraryChannelOptions {
  post: (message: { channel: "library"; msg: HostToUi }) => Thenable<unknown>;
  /** Runs after the library has been pushed in answer to `ready`. */
  onReady: () => Promise<void>;
  /** The page asked to open a folder (UI path); the owner routes it to the paper list. */
  onFolderOpen: (folder: string) => void;
}

function startLibraryChannel(deps: ListPanelDeps, { post, onReady, onFolderOpen }: LibraryChannelOptions): LibraryChannel {
  const feed = new LibraryFeed(deps, (msg) => post({ channel: "library", msg }));
  // The page follows the selection it is shown; it neither navigates nor selects on its own.
  const ctx: ListHostContext = createFeedHostCompositionRoot(deps, feed, {
    onReady: async () => {
      feed.queue.markReady();
      await feed.push();
      await feed.queue.flush();
      await onReady();
    },
    onNavigate: () => {},
    onSelect: () => {},
  });
  return {
    get ready() { return feed.queue.ready; },
    handle: async (message) => {
      if (message.type === "folder.open") { onFolderOpen(message.folder); return; }
      await answerListMessage(ctx, message);
    },
    dispose: () => feed.dispose(),
  };
}

const LOG_MODULE = "details.view";

interface DetailsSessionDeps {
  /** The library services' list dependencies, or null while no library is open. */
  listDeps: () => ListPanelDeps | null;
  projectLibrary: () => ProjectLibraryPort;
  logger: ILogger;
  /** The target to replay once the library channel is ready. */
  target: () => DetailsSelection | undefined;
  onFolderOpen: (folder: string) => void;
}

class DetailsSession {
  private _library: LibraryChannel | undefined;
  private readonly _projects: ProjectsChannel;
  private _disposed = false;
  private _pageReady = false;

  constructor(private readonly _webview: vscode.Webview, private readonly _deps: DetailsSessionDeps) {
    this._projects = startProjectsChannel((message) => this._post(message), _deps.projectLibrary(), _deps.logger);
  }

  /** Shows the target in the page once the library channel has answered `ready`; until then the owner's stored target is replayed. */
  show(target: DetailsSelection): void {
    if (this._library?.ready) { this._post({ type: "details.show", target }); }
  }

  async handle(raw: unknown): Promise<void> {
    const message = parseDetailsMessage(raw);
    if (!message) {
      const { channel, msg } = (raw && typeof raw === "object" ? raw : {}) as { channel?: unknown; msg?: { type?: unknown } | null };
      await this._deps.logger.log("WARN", LOG_MODULE, "Details page sent a message that is not valid", { channel, type: msg?.type });
      return;
    }
    if (message.channel === "library" && message.msg.type === "ready") { this._pageReady = true; }
    try {
      if (message.channel === "projects") { this._projects.deliver(message.msg); } else { await this._libraryChannel()?.handle(message.msg); }
    } catch (error) {
      await this._deps.logger.log("ERROR", LOG_MODULE, "Details message failed", { channel: message.channel, type: message.msg.type, message: formatError(error) });
    }
  }

  /** Replaces the library channel after the library root changed, and answers a page that already said `ready` as for a fresh `ready`. */
  async rebind(): Promise<void> {
    this._library?.dispose();
    this._library = undefined;
    if (!this._pageReady) { return; }
    try {
      await this._libraryChannel()?.handle({ type: "ready" });
    } catch (error) {
      await this._deps.logger.log("ERROR", LOG_MODULE, "Details library rebind failed", { message: formatError(error) });
    }
  }

  dispose(): void {
    this._disposed = true;
    this._library?.dispose();
    this._projects.stop();
  }

  // Created on the first library message so a view that opens before the library does recovers once it exists.
  private _libraryChannel(): LibraryChannel | undefined {
    if (this._library) { return this._library; }
    const listDeps = this._deps.listDeps();
    if (!listDeps) {
      void this._deps.logger.log("WARN", LOG_MODULE, "Details library message dropped: no library is open");
      return undefined;
    }
    this._library = startLibraryChannel(listDeps, {
      post: (message) => this._post(message),
      onReady: async () => {
        const target = this._deps.target();
        if (target !== undefined) { this._post({ type: "details.show", target }); }
      },
      onFolderOpen: this._deps.onFolderOpen,
    });
    return this._library;
  }

  private _post(message: HostToDetails): Thenable<boolean> {
    return this._disposed ? Promise.resolve(false) : this._webview.postMessage(message);
  }
}

const DETAILS_VIEW = "labshelf.details";

export interface DetailsViewDeps {
  extensionUri: vscode.Uri;
  listDeps: () => ListPanelDeps | null;
  projectLibrary: () => ProjectLibraryPort;
  logger: ILogger;
}

export class DetailsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private _session: DetailsSession | undefined;
  private _view: vscode.WebviewView | undefined;
  private _target: DetailsSelection | undefined;
  private readonly _folderRequests = new vscode.EventEmitter<string>();
  /** Fires with the UI path of a folder the page asked to open in the paper list. */
  readonly onDidRequestFolder: vscode.Event<string> = this._folderRequests.event;

  constructor(private readonly _deps: DetailsViewDeps) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this._session?.dispose();
    const { webview } = view;
    webview.options = { enableScripts: true, localResourceRoots: [readLibraryBundleDir(this._deps.extensionUri), webviewChunksDir(this._deps.extensionUri)] };
    const session = new DetailsSession(webview, {
      ...this._deps, target: () => this._target, onFolderOpen: (folder) => this._folderRequests.fire(folder),
    });
    this._session = session;
    this._view = view;
    const message = webview.onDidReceiveMessage((raw: unknown) => void session.handle(raw));
    view.onDidDispose(() => {
      message.dispose();
      session.dispose();
      if (this._session === session) { this._session = undefined; }
      if (this._view === view) { this._view = undefined; }
    });
    webview.html = await listPanelHtml(webview, this._deps.extensionUri, "details");
  }

  /** Stores the target and posts it when the page is ready; a page that is not ready yet receives it with its `ready` answer. */
  show(target: DetailsSelection): void {
    this._target = target;
    this._session?.show(target);
  }

  /** Opens the secondary side bar on this view; a view VS Code has not resolved yet can only be opened through its focus command. */
  async reveal(): Promise<void> {
    if (this._view) { this._view.show(true); return; }
    await vscode.commands.executeCommand(`${DETAILS_VIEW}.focus`);
  }

  /** Closes visible Details, or reveals it when hidden or collapsed. */
  async toggle(): Promise<void> {
    if (this._view?.visible) {
      await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
      return;
    }
    await this.reveal();
  }

  /** Re-serves the library to the page after the library root changed. */
  async rebindLibrary(): Promise<void> {
    await this._session?.rebind();
  }

  dispose(): void {
    this._session?.dispose();
    this._folderRequests.dispose();
  }
}

export function registerDetailsView(context: vscode.ExtensionContext, deps: DetailsViewDeps): DetailsView {
  const view = new DetailsView(deps);
  context.subscriptions.push(
    view,
    vscode.commands.registerCommand("labshelf.details.toggle", () => view.toggle()),
    vscode.window.registerWebviewViewProvider(DETAILS_VIEW, view, { webviewOptions: { retainContextWhenHidden: true } }),
  );
  return view;
}

const SOURCES_LOG_MODULE = "details.sources";

export interface SelectionSources {
  /** The list tab's selection changed; no ids clears it. */
  listSelected(ids: string[]): void;
  /** The All projects selection changed; null clears it. */
  projectSelected(id: string | null): void;
  /** A reader became the active tab. */
  readerActivated(paperId: string): void;
  listActivated(): void;
  projectsActivated(): void;
}

export function createSelectionSources(hub: SelectionHub, logger: ILogger): SelectionSources {
  // Hub subscribers run inside webview message handlers, so a failure is logged instead of thrown into them.
  const run = (action: string, step: () => void): void => {
    try { step(); } catch (error) { void logger.log("ERROR", SOURCES_LOG_MODULE, "Details selection failed", { action, message: formatError(error) }); }
  };
  return {
    listSelected: (ids) => run("list.publish", () => hub.publish("list", ids.length ? { kind: "paper", ids } : null)),
    projectSelected: (id) => run("projects.publish", () => hub.publish("projects", id ? { kind: "project", id } : null)),
    readerActivated: (paperId) => run("reader.publish", () => hub.publish("reader", { kind: "paper", ids: [paperId] })),
    listActivated: () => run("list.activate", () => hub.activate("list")),
    projectsActivated: () => run("projects.activate", () => hub.activate("projects")),
  };
}
