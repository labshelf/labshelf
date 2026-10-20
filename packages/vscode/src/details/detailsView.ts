// Hosts the Details webview in the secondary sidebar and shows it the selected paper or project.
import * as vscode from "vscode";
import type { DetailsTarget, ILogger, ProjectLibraryPort } from "@labshelf/core";
import { libraryBundleDirectory, listPanelHtml, type ListPanelDeps } from "../ui/list/index.js";
import { DetailsSession } from "./detailsSession.js";

export interface DetailsViewDeps {
  extensionUri: vscode.Uri;
  listDeps: () => ListPanelDeps | null;
  projectLibrary: () => ProjectLibraryPort;
  logger: ILogger;
}

export class DetailsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private _session: DetailsSession | undefined;
  private _target: DetailsTarget | undefined;
  private readonly _folderRequests = new vscode.EventEmitter<string>();
  /** Fires with the UI path of a folder the page asked to open in the paper list. */
  readonly onDidRequestFolder: vscode.Event<string> = this._folderRequests.event;

  constructor(private readonly _deps: DetailsViewDeps) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this._session?.dispose();
    const { webview } = view;
    webview.options = { enableScripts: true, localResourceRoots: [libraryBundleDirectory(this._deps.extensionUri)] };
    const session = new DetailsSession(webview, {
      ...this._deps, target: () => this._target, onFolderOpen: (folder) => this._folderRequests.fire(folder),
    });
    this._session = session;
    const message = webview.onDidReceiveMessage((raw: unknown) => void session.handle(raw));
    view.onDidDispose(() => {
      message.dispose();
      session.dispose();
      if (this._session === session) { this._session = undefined; }
    });
    webview.html = await listPanelHtml(webview, this._deps.extensionUri, "details");
  }

  /** Stores the target and posts it when the page is ready; a page that is not ready yet receives it with its `ready` answer. */
  show(target: DetailsTarget): void {
    this._target = target;
    this._session?.show(target);
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
