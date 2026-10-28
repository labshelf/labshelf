// Registers the command that opens the sync guide.
import * as vscode from "vscode";
import { type ILogger, formatError, createNonce, syncGuide } from "@labshelf/core";
import { createTabIcon, hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../ui/index.js";

const GUIDE_URLS: ReadonlySet<string> = new Set([...syncGuide.tools, syncGuide.noCloud.tool].map((tool) => tool.url));

export function isGuideUrl(url: unknown): url is string {
  return typeof url === "string" && GUIDE_URLS.has(url);
}

/** @returns the URL of an `openLink` message, or null for any other message. */
export function parseOpenUrl(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) { return null; }
  const message = raw as { type?: unknown; url?: unknown };
  return message.type === "openLink" && typeof message.url === "string" ? message.url : null;
}

/** <extension>/dist/syncGuide, for localResourceRoots. */
function syncGuideBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "syncGuide");
}

async function syncGuideHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = syncGuideBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "syncGuide.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "Sync guide", heading: "Sync guide bundle not built", file: "dist/syncGuide/syncGuide.js", reopen: "the sync guide" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: "Sync guide",
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "syncGuide.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
}

const MODULE = "library/syncGuide";

let current: vscode.WebviewPanel | undefined;

/** Reveals the open guide tab, or opens one. `logger` is absent before a library is open. */
async function openSyncGuide(extensionUri: vscode.Uri, logger: ILogger | undefined): Promise<void> {
  if (current) { current.reveal(); return; }
  const panel = vscode.window.createWebviewPanel("labshelfSyncGuide", "Sync guide", vscode.ViewColumn.Active, {
    enableScripts: true, localResourceRoots: [syncGuideBundleDirectory(extensionUri), webviewChunksDir(extensionUri)],
  });
  current = panel;
  panel.iconPath = createTabIcon(extensionUri);
  panel.onDidDispose(() => { current = undefined; });
  panel.webview.onDidReceiveMessage((raw: unknown) => { void openLink(raw, logger); });
  panel.webview.html = await syncGuideHtml(panel.webview, extensionUri);
}

async function openLink(raw: unknown, logger: ILogger | undefined): Promise<void> {
  const url = parseOpenUrl(raw);
  if (url === null) { return; }
  if (!isGuideUrl(url)) {
    await logger?.log("WARN", MODULE, "Ignored a link the guide does not list", { url });
    return;
  }
  try {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } catch (error) {
    if (logger) { await logger.error(MODULE, error, { url }); }
    else { void vscode.window.showErrorMessage(`Could not open ${url}: ${formatError(error)}`); }
  }
}

export function registerSyncGuideCommand(context: vscode.ExtensionContext, getLogger: () => ILogger | undefined): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.syncGuide", () => openSyncGuide(context.extensionUri, getLogger())),
  );
}
