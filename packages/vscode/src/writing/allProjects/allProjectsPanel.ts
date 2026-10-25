// Opens the editor tab that shows every project and connects its webview to the All projects server.
import * as vscode from "vscode";
import {
  isSharingMessage,
  parseAllProjectsMessage,
  serveAllProjects,
  type AllProjectsEndpoint,
  type AllProjectsToHost,
  type ILogger,
  type ProjectLibraryPort,
  createNonce,
} from "@labshelf/core";
import { sharingWebviews } from "../../share/index.js";
import { labshelfTabIcon, bundleExists, bundleMissingHtml } from "../../ui/index.js";

/** <extension>/dist/projects, for localResourceRoots. */
function allProjectsBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "projects");
}

async function allProjectsHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = allProjectsBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "projects.js");
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "All projects", heading: "All projects bundle not built", file: "dist/projects/projects.js", reopen: "All projects" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>All projects</title>
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "projects.css")).toString()}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}

export interface AllProjectsSelection {
  onSelect(id: string | null): void;
  onActivate(): void;
}

export class AllProjectsPanel {
  private disposed = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly stopServing: () => void;

  private constructor(
    private readonly panel: vscode.WebviewPanel, extensionUri: vscode.Uri, port: ProjectLibraryPort, logger: ILogger, selection: AllProjectsSelection, private readonly onDispose: () => void,
  ) {
    const handlers = new Set<(message: AllProjectsToHost) => void>();
    const endpoint: AllProjectsEndpoint = {
      post: (message) => { if (!this.disposed) { void panel.webview.postMessage(message); } },
      subscribe: (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
    };
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseAllProjectsMessage(raw);
      if (!message) {
        if (isSharingMessage(raw)) { return; }
        void logger.log("WARN", "writing.allProjects", "unparseable message from the page", { type: (raw as { type?: unknown } | null)?.type });
        return;
      }
      if (message.type === "project.selected") { selection.onSelect(message.id); }
      handlers.forEach((handler) => handler(message));
    }, null, this.disposables);
    this.disposables.push(sharingWebviews.attach(panel.webview));
    this.stopServing = serveAllProjects(endpoint, port, logger);
    void allProjectsHtml(panel.webview, extensionUri).then((html) => { if (!this.disposed) { panel.webview.html = html; } });
    panel.onDidChangeViewState((e) => { if (e.webviewPanel.active) { selection.onActivate(); } }, null, this.disposables);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static open(extensionUri: vscode.Uri, port: ProjectLibraryPort, logger: ILogger, selection: AllProjectsSelection, onDispose: () => void): AllProjectsPanel {
    const panel = vscode.window.createWebviewPanel("labshelfAllProjects", "All projects", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [allProjectsBundleDirectory(extensionUri)],
    });
    panel.iconPath = labshelfTabIcon(extensionUri);
    return new AllProjectsPanel(panel, extensionUri, port, logger, selection, onDispose);
  }

  reveal(): void { this.panel.reveal(vscode.ViewColumn.One); }

  dispose(): void {
    // panel.dispose() below re-enters through onDidDispose.
    if (this.disposed) { return; }
    this.disposed = true;
    this.stopServing();
    this.onDispose();
    this.panel.dispose();
    while (this.disposables.length) { this.disposables.pop()?.dispose(); }
  }
}
