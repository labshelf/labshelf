// Hosts the positioned Research chat panel with the active Space context.
import * as vscode from "vscode";
import { type ILogger, createNonce } from "@labshelf/core";
import { hasBundleFile, renderBundleMissingHtml } from "../ui/index.js";
import { disposeAll } from "../disposables/index.js";

function researchChatBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "spaces");
}

async function researchChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = researchChatBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "chat.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "Research chat", heading: "Research chat bundle not built", file: "dist/spaces/chat.js", reopen: "Research chat" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Research chat</title><link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "chat.css"))}"/>
</head><body><div id="root"></div><script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script)}"></script></body></html>`;
}

export interface SpaceContext {
  context(): string | null;
  onDidChangeContext: vscode.Event<string | null>;
}

export class ResearchChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri, private readonly source: SpaceContext, private readonly logger: ILogger) {
    this.subscriptions.push(source.onDidChangeContext(() => this.postContext()));
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [researchChatBundleDirectory(this.extensionUri)] };
    const messages = view.webview.onDidReceiveMessage((raw: unknown) => {
      if (raw && typeof raw === "object" && "type" in raw && raw.type === "ready") { this.postContext(); }
    });
    const disposed = view.onDidDispose(() => {
      messages.dispose();
      disposed.dispose();
      if (this.view === view) { this.view = undefined; }
    });
    view.webview.html = await researchChatHtml(view.webview, this.extensionUri);
  }

  async toggle(): Promise<void> {
    if (this.view?.visible) { await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar"); }
    else { await vscode.commands.executeCommand("labshelf.researchChat.focus"); }
  }

  private postContext(): void {
    if (!this.view) { return; }
    void Promise.resolve(this.view.webview.postMessage({ type: "context", name: this.source.context() })).catch(error => {
      void this.logger.error("spaces/chat", error, { action: "post Research chat context" });
    });
  }

  dispose(): void { disposeAll(this.subscriptions); }
}
