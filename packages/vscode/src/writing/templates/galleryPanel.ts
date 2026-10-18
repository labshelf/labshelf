// Opens the editor tab that shows the template gallery and connects its webview to the gallery host.
import * as vscode from "vscode";
import { createGalleryHost, type GalleryHost, type GalleryHostDeps } from "@labshelf/core";
import { labshelfTabIcon } from "../../ui/index.js";
import { galleryBundleDirectory, galleryHtml } from "./galleryHtml.js";
import { askProjectTitle } from "./projectTitlePrompt.js";
import { createPublishHost } from "./publish/index.js";
import type { TemplateGalleryDeps } from "./index.js";

export class GalleryPanel {
  private readonly host: GalleryHost;
  private disposed = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly panel: vscode.WebviewPanel, deps: TemplateGalleryDeps, private readonly onDispose: () => void) {
    const post: GalleryHostDeps["post"] = (message) => { if (!this.disposed) { void panel.webview.postMessage(message); } };
    const hostDeps: GalleryHostDeps = {
      sources: deps.sources,
      engines: deps.engines,
      logger: deps.logger,
      createProject: deps.createProject,
      askTitle: askProjectTitle,
      publish: createPublishHost({ ...deps.publish, logger: deps.logger, post }),
      post,
    };
    this.host = createGalleryHost(hostDeps);
    void galleryHtml(panel.webview, deps.context.extensionUri).then((html) => { if (!this.disposed) { panel.webview.html = html; } });
    panel.webview.onDidReceiveMessage((raw: unknown) => { void this.host.handle(raw); }, null, this.disposables);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static open(deps: TemplateGalleryDeps, onDispose: () => void): GalleryPanel {
    const panel = vscode.window.createWebviewPanel("labshelfTemplates", "Templates", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [galleryBundleDirectory(deps.context.extensionUri)],
    });
    panel.iconPath = labshelfTabIcon(deps.context.extensionUri);
    return new GalleryPanel(panel, deps, onDispose);
  }

  reveal(): void { this.panel.reveal(vscode.ViewColumn.One); }

  openPublish(projectId?: string): Promise<void> { return this.host.openPublish(projectId); }

  /** Lists the sources again; before the page is ready its own `ready` does the listing. */
  refresh(): void { if (this.host.isReady()) { void this.host.handle({ type: "refresh" }); } }

  dispose(): void {
    // panel.dispose() below re-enters through onDidDispose.
    if (this.disposed) { return; }
    this.disposed = true;
    this.host.dispose();
    this.onDispose();
    this.panel.dispose();
    while (this.disposables.length) { this.disposables.pop()?.dispose(); }
  }
}
