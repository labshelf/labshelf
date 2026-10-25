// Runs the two protocol channels of one resolved Details view: validates what the page sends and routes it to the right server.
import type * as vscode from "vscode";
import { errorMessage, parseDetailsMessage, type DetailsTarget, type HostToDetails, type ILogger, type ProjectLibraryPort } from "@labshelf/core";
import type { ListPanelDeps } from "../index.js";
import { startLibraryChannel, type LibraryChannel } from "./libraryChannel.js";
import { startProjectsChannel, type ProjectsChannel } from "./projectsChannel.js";

const LOG_MODULE = "details.view";

export interface DetailsSessionDeps {
  /** The library services' list dependencies, or null while no library is open. */
  listDeps: () => ListPanelDeps | null;
  projectLibrary: () => ProjectLibraryPort;
  logger: ILogger;
  /** The target to replay once the library channel is ready. */
  target: () => DetailsTarget | undefined;
  onFolderOpen: (folder: string) => void;
}

export class DetailsSession {
  private _library: LibraryChannel | undefined;
  private readonly _projects: ProjectsChannel;
  private _disposed = false;
  private _pageReady = false;

  constructor(private readonly _webview: vscode.Webview, private readonly _deps: DetailsSessionDeps) {
    this._projects = startProjectsChannel((message) => this._post(message), _deps.projectLibrary(), _deps.logger);
  }

  /** Shows the target in the page once the library channel has answered `ready`; until then the owner's stored target is replayed. */
  show(target: DetailsTarget): void {
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
      await this._deps.logger.log("ERROR", LOG_MODULE, "Details message failed", { channel: message.channel, type: message.msg.type, message: errorMessage(error) });
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
      await this._deps.logger.log("ERROR", LOG_MODULE, "Details library rebind failed", { message: errorMessage(error) });
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
