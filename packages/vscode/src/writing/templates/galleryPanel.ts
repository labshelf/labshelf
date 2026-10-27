// Opens the editor tab that shows the template gallery and connects its webview to the gallery host.
import * as vscode from "vscode";
import {
  createGalleryHost,
  createPublishHost,
  type GalleryHost,
  type GalleryHostDeps,
  createNonce,
} from "@labshelf/core";
import { createTabIcon, hasBundleFile, renderBundleMissingHtml, renderHtmlShell } from "../../ui/index.js";
import type { TemplateGalleryDeps } from "./index.js";

/** <extension>/dist/templates, for localResourceRoots. */
function galleryBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "templates");
}

async function galleryHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = galleryBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "templates.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "Templates", heading: "Template gallery bundle not built", file: "dist/templates/templates.js", reopen: "the gallery" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: "Templates",
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "templates.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
    // Thumbnails arrive as data: URIs.
    dataImages: true,
  });
}

/** @returns the trimmed title, or undefined when the user cancels */
async function askProjectTitle(defaultTitle: string): Promise<string | undefined> {
  const title = await vscode.window.showInputBox({
    title: "New project from template",
    prompt: "Project title",
    value: defaultTitle,
    validateInput: (value) => (value.trim() ? undefined : "Enter a title"),
  });
  return title?.trim();
}

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
    panel.iconPath = createTabIcon(deps.context.extensionUri);
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
