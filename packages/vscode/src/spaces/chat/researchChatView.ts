// Hosts the positioned Research chat panel with the active Space context.
import * as vscode from "vscode";
import type { ILogger } from "@labshelf/core";
import { researchChatHtml, researchChatBundleDirectory } from "./researchChatHtml.js";

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

  dispose(): void { this.subscriptions.forEach(subscription => subscription.dispose()); }
}
