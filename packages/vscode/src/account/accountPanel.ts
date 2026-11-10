// Opens the Account tab (labshelf.account): the core Account view in one webview panel, answered from the desktop's relay and a device-local user name.
import * as vscode from "vscode";
import {
  createAccountSource, createNonce, serveAccount, type AccountCloudflare, type AccountToHost, type HostToAccount, type ILogger,
} from "@labshelf/core";
import { createTabIcon, hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../ui/index.js";

const ACCOUNT_COMMAND = "labshelf.account";

// The one user name of this VS Code: the Account tab saves it here and shares, presence, comments, suggestions and discussions read it.
const USER_NAME_KEY = "labshelf.account.userName";

/** The saved user name over global state; a blank one counts as unset and `fallback` (the OS user name) answers instead. */
export function createUserNameStore(state: vscode.Memento, fallback: () => string): { read(): string; write(name: string): Promise<void>; onDidChange: vscode.Event<string> } {
  const changes = new vscode.EventEmitter<string>();
  const read = (): string => {
    const saved = state.get<string>(USER_NAME_KEY)?.trim();
    return saved ? saved : fallback();
  };
  return {
    read,
    write: async (name) => {
      await state.update(USER_NAME_KEY, name.trim());
      changes.fire(read());
    },
    onDidChange: changes.event,
  };
}

/** What only the desktop gives the Account tab: its Cloudflare relay and the name its shares use until one is saved. */
export interface AccountDesktop {
  cloudflare: AccountCloudflare;
  defaultUserName: string;
}

// Set where the platform registers the relay (the desktop); elsewhere the tab shows Connect disabled and an empty name.
let desktop: AccountDesktop | undefined;

/** Lets the Account tab connect and disconnect Cloudflare; pass undefined to take it away. */
export function provideAccountDesktop(next: AccountDesktop | undefined): void {
  desktop = next;
}

const accountBundleDirectory = (extensionUri: vscode.Uri): vscode.Uri => vscode.Uri.joinPath(extensionUri, "dist", "account");

async function accountHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = accountBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "account.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "Account", heading: "Account bundle not built", file: "dist/account/account.js", reopen: "Account" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: "Account",
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "account.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
}

let current: vscode.WebviewPanel | undefined;

async function openAccount(context: vscode.ExtensionContext, logger: ILogger | undefined): Promise<void> {
  if (current) { current.reveal(); return; }
  const { extensionUri, globalState } = context;
  const panel = vscode.window.createWebviewPanel("labshelfAccount", "Account", vscode.ViewColumn.Active, {
    enableScripts: true, localResourceRoots: [accountBundleDirectory(extensionUri), webviewChunksDir(extensionUri)],
  });
  current = panel;
  panel.iconPath = createTabIcon(extensionUri);
  const names = createUserNameStore(globalState, () => desktop?.defaultUserName ?? "");
  const source = createAccountSource({
    readUserName: async () => names.read(),
    writeUserName: (name) => names.write(name),
    cloudflare: () => desktop?.cloudflare,
    ...(logger ? { logger } : {}),
  });
  const handlers = new Set<(message: AccountToHost) => void>();
  const stop = serveAccount({
    post: (message: HostToAccount) => { void panel.webview.postMessage(message); },
    subscribe: (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
  }, source);
  const subscriptions = [
    panel.webview.onDidReceiveMessage((raw: AccountToHost) => handlers.forEach((handler) => handler(raw))),
    // A connect or disconnect run from the command palette shows once the tab is visible again.
    panel.onDidChangeViewState(() => { if (panel.visible) void source.refresh(); }),
  ];
  panel.onDidDispose(() => { current = undefined; stop(); subscriptions.forEach((s) => s.dispose()); });
  panel.webview.html = await accountHtml(panel.webview, extensionUri);
}

export function registerAccountCommand(context: vscode.ExtensionContext, getLogger: () => ILogger | undefined): void {
  context.subscriptions.push(vscode.commands.registerCommand(ACCOUNT_COMMAND, () => openAccount(context, getLogger())));
}
