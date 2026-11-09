// Hosts the Project chat webview view in the LabShelf Details side bar and tells it the title of the open writing project.
// PREVIEW: the webview keeps an in-memory demo chat per project; nothing is saved or shared yet.
import * as vscode from "vscode";
import type { ILogger, ReadyProject } from "@labshelf/core";
import { disposeAll } from "../../disposables/index.js";
import { resolveSideChatView, toggleSideChatView, type SideChatBundle } from "../../ui/index.js";

const VIEW_ID = "labshelf.projectChat";

/** The open project, as the project session knows it. */
export interface ProjectChatSession {
  readonly project: ReadyProject | undefined;
  readonly onDidChange: vscode.Event<ReadyProject | undefined>;
}

const projectTitle = (project: ReadyProject | undefined): string | null => project ? project.settings.title ?? project.settings.id : null;

function bundle(extensionUri: vscode.Uri): SideChatBundle {
  return { dir: vscode.Uri.joinPath(extensionUri, "dist", "projectChat"), script: "projectChat.js", style: "projectChat.css", title: "Project chat", file: "dist/projectChat/projectChat.js" };
}

class ProjectChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri, private readonly session: ProjectChatSession, private readonly logger: ILogger) {
    this.subscriptions.push(session.onDidChange(() => this.postProject()));
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    await resolveSideChatView(view, this.extensionUri, bundle(this.extensionUri), () => this.postProject(), () => {
      if (this.view === view) { this.view = undefined; }
    });
  }

  toggle(): Promise<void> { return toggleSideChatView(this.view, VIEW_ID); }

  private postProject(): void {
    if (!this.view) { return; }
    void Promise.resolve(this.view.webview.postMessage({ type: "project", title: projectTitle(this.session.project) })).catch(error => {
      void this.logger.error("writing/projectChat", error, { action: "post Project chat project" });
    });
  }

  dispose(): void { disposeAll(this.subscriptions); }
}

/** Registers the Project chat view and its toggle command. */
export function registerProjectChat(context: vscode.ExtensionContext, deps: { session: ProjectChatSession; logger: ILogger }): void {
  const chat = new ProjectChatView(context.extensionUri, deps.session, deps.logger);
  context.subscriptions.push(chat,
    vscode.window.registerWebviewViewProvider(VIEW_ID, chat),
    vscode.commands.registerCommand("labshelf.projectChat.toggle", () => chat.toggle()));
}
