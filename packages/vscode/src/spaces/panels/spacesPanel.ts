// Connects a Spaces editor panel to the shared Spaces server.
import * as vscode from "vscode";
import { serveSpaces, type ServeSpacesOptions, type SpacesEndpoint, type SpacesToHost, type SpaceTab } from "@labshelf/core";
import { labshelfTabIcon } from "../../ui/index.js";
import { spacesBundleDirectory, spacesHtml, type SpacesView } from "./spacesHtml.js";

type Binding = Omit<ServeSpacesOptions, "today">;
export class SpacesPanel {
  private disposed = false;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly stop: () => void;
  readonly panel: vscode.WebviewPanel;

  constructor(extension: vscode.Uri, readonly view: SpacesView, title: string, binding: Binding, activate: () => void, close: () => void) {
    const panel = this.panel = vscode.window.createWebviewPanel("labshelfSpaces", title, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [spacesBundleDirectory(extension)],
    });
    panel.iconPath = labshelfTabIcon(extension);
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
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
