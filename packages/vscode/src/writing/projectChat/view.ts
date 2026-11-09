// Hosts the Project chat webview view in the LabShelf Details side bar: it exists only while the open project is shared (D2), and while it
// shows it serves the project's .labshelf/chat.qmd with the share's presence over the page channel.
// CONTRACT: documents/contracts/qmd-items.md#project-chat
import * as vscode from "vscode";
import { PROJECT_CHAT_PATH, serveProjectChat, type ILogger, type ProjectChatHostEnd, type ReadyProject } from "@labshelf/core";
import { disposeAll } from "../../disposables/index.js";
import { resolveSideChatView, toggleSideChatView, type SideChatBundle } from "../../ui/index.js";
import type { WritingProjects } from "../projects/index.js";
import { projectChatBackend, setProjectChatFolders, type ProjectChatBackend } from "./backend.js";

const VIEW_ID = "labshelf.projectChat";
/** True while the open project has a chat; the view and its toggle command show only then. */
const AVAILABLE_KEY = "labshelf.projectChat.available";
const MODULE = "writing/projectChat";

/** The open project, as the project session knows it. */
export interface ProjectChatSession {
  readonly project: ReadyProject | undefined;
  readonly onDidChange: vscode.Event<ReadyProject | undefined>;
}

export interface ProjectChatDeps {
  session: ProjectChatSession;
  /** The project list, whose reload follows a share or a leave. */
  projects: Pick<WritingProjects, "list" | "onDidChange">;
  logger: ILogger;
}

const projectTitle = (project: ReadyProject): string => project.settings.title ?? project.settings.id;

/** The open project with its chat, or undefined when it has none. */
interface ChatProject { project: ReadyProject; shareId: string; backend: ProjectChatBackend }

function bundle(extensionUri: vscode.Uri): SideChatBundle {
  return { dir: vscode.Uri.joinPath(extensionUri, "dist", "projectChat"), script: "projectChat.js", style: "projectChat.css", title: "Project chat", file: "dist/projectChat/projectChat.js" };
}

/** The host end over the view's webview; only the chat's own messages reach the server, not the view's ready handshake. */
function webviewEnd(webview: vscode.Webview, logger: ILogger): ProjectChatHostEnd {
  return {
    post: (message) => {
      void Promise.resolve(webview.postMessage(message)).catch((error: unknown) => logger.error(MODULE, error, { action: "post to the Project chat" }));
    },
    subscribe: (handler) => {
      const subscription = webview.onDidReceiveMessage((raw: unknown) => {
        const type = (raw as { type?: unknown } | null)?.type;
        if (typeof type === "string" && type.startsWith("projectChat.")) { handler(raw); }
      });
      return () => subscription.dispose();
    },
  };
}

/** Calls the listener when the chat file is written outside the store, as when the mirror writes a peer's message. */
function watchChatFile(folder: string): { onChange(listener: () => void): () => void; dispose(): void } {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), PROJECT_CHAT_PATH));
  return {
    onChange: (listener) => {
      const subscriptions = [watcher.onDidCreate(listener), watcher.onDidChange(listener), watcher.onDidDelete(listener)];
      return () => disposeAll(subscriptions);
    },
    dispose: () => watcher.dispose(),
  };
}

class ProjectChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  /** What the page shows now: the key of the served project ("" for none) and the stop of its server. */
  private served: { key: string; stop(): void } | undefined;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly extensionUri: vscode.Uri, private readonly deps: ProjectChatDeps) {
    const refresh = (): void => this.refresh();
    this.subscriptions = [deps.session.onDidChange(refresh), deps.projects.onDidChange(refresh), projectChatBackend.onDidChange(refresh)];
    this.refresh();
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    // PLATFORM: a hidden webview view drops its page and loads it again when shown, which then sends ready.
    const visibility = view.onDidChangeVisibility(() => { if (!view.visible && this.view === view) { this.stopServing(); } });
    await resolveSideChatView(view, this.extensionUri, bundle(this.extensionUri), () => this.serve(), () => {
      visibility.dispose();
      if (this.view !== view) { return; }
      this.stopServing();
      this.view = undefined;
    });
  }

  toggle(): Promise<void> { return toggleSideChatView(this.view, VIEW_ID); }

  private chatProject(): ChatProject | undefined {
    const project = this.deps.session.project;
    const backend = projectChatBackend.current();
    const shareId = project?.settings.shared;
    return project && backend && shareId !== undefined ? { project, shareId, backend } : undefined;
  }

  private refresh(): void {
    const open = this.chatProject();
    setProjectChatFolders(open ? [open.project.folder] : []);
    void vscode.commands.executeCommand("setContext", AVAILABLE_KEY, open !== undefined);
    if (this.served && this.served.key !== keyOf(open)) { this.serve(); }
  }

  /** Serves the open project's chat to the page, or tells it there is none; a page that loads again gets a new server. */
  private serve(): void {
    this.stopServing();
    const view = this.view;
    if (!view?.visible) { return; }
    const open = this.chatProject();
    const key = keyOf(open);
    const stop = open ? this.serveChat(view.webview, open) : () => {};
    this.served = { key, stop };
    void Promise.resolve(view.webview.postMessage({ type: "project", key, title: open ? projectTitle(open.project) : null })).catch((error: unknown) => {
      void this.deps.logger.error(MODULE, error, { action: "post the Project chat project" });
    });
  }

  private serveChat(webview: vscode.Webview, { project, shareId, backend }: ChatProject): () => void {
    const file = watchChatFile(project.folder);
    const stop = serveProjectChat({
      end: webviewEnd(webview, this.deps.logger), store: backend.store, projectDir: project.folder, title: projectTitle(project),
      author: () => backend.author(), canWrite: true, logger: this.deps.logger, onFileChange: file.onChange, presence: backend.presence(shareId),
    });
    return () => { stop(); file.dispose(); };
  }

  private stopServing(): void {
    this.served?.stop();
    this.served = undefined;
  }

  dispose(): void {
    this.stopServing();
    disposeAll(this.subscriptions);
  }
}

/** Changes when the page must show another chat: another project, its title or its share. */
const keyOf = (open: ChatProject | undefined): string => open ? JSON.stringify([open.project.folder, projectTitle(open.project), open.shareId]) : "";

/** Registers the Project chat view and its toggle command. */
export function registerProjectChat(context: vscode.ExtensionContext, deps: ProjectChatDeps): void {
  const chat = new ProjectChatView(context.extensionUri, deps);
  context.subscriptions.push(chat,
    vscode.window.registerWebviewViewProvider(VIEW_ID, chat),
    vscode.commands.registerCommand("labshelf.projectChat.toggle", () => chat.toggle()));
}
