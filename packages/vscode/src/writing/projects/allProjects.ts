// The All projects editor tab: the command that opens it, the panel that serves its webview and the library port that feeds it.
import * as vscode from "vscode";

import {
  isShareMessage,
  parseAllProjectsMessage,
  serveAllProjects,
  type AllProjectsEndpoint,
  type AllProjectsToHost,
  type ILogger,
  type ProjectLibraryPort,
  createNonce,
} from "@labshelf/core";
import { sharingWebviews } from "../../share/index.js";
import { createTabIcon, hasBundleFile, renderBundleMissingHtml, renderHtmlShell } from "../../ui/index.js";
import { createProjectLibrary, type VscodeProjectLibraryDeps } from "./sidebar.js";

/** <extension>/dist/projects, for localResourceRoots. */
function allProjectsBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "projects");
}

async function allProjectsHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = allProjectsBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "projects.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "All projects", heading: "All projects bundle not built", file: "dist/projects/projects.js", reopen: "All projects" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: "All projects",
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "projects.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
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
        if (isShareMessage(raw)) { return; }
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
    panel.iconPath = createTabIcon(extensionUri);
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

const ALL_PROJECTS_COMMAND = "labshelf.projects.all";

export interface AllProjectsDeps extends VscodeProjectLibraryDeps {
  context: vscode.ExtensionContext;
  /** Reports the page's project selection and the tab becoming active, for the Details view. */
  selection: AllProjectsSelection;
}

/** @returns the factory of the library port the All projects page reads, which the Details view serves too */
export function registerAllProjects({ context, selection, ...library }: AllProjectsDeps): () => ProjectLibraryPort {
  let panel: AllProjectsPanel | undefined;
  const open = (): void => {
    if (panel) { panel.reveal(); return; }
    panel = AllProjectsPanel.open(context.extensionUri, createProjectLibrary(library), library.logger, selection, () => { panel = undefined; });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(ALL_PROJECTS_COMMAND, open),
    { dispose: () => panel?.dispose() },
  );
  return () => createProjectLibrary(library);
}
