// Registers the command that opens the sync guide.
import * as vscode from "vscode";
import { type ILogger, errorMessage, createNonce, syncGuide } from "@labshelf/core";
import { labshelfTabIcon, bundleExists, bundleMissingHtml } from "../../ui/index.js";

const GUIDE_URLS: ReadonlySet<string> = new Set([...syncGuide.tools, syncGuide.noCloud.tool].map((tool) => tool.url));

export function isGuideLink(url: unknown): url is string {
  return typeof url === "string" && GUIDE_URLS.has(url);
}

/** @returns the URL of an `openLink` message, or null for any other message. */
export function parseOpenLink(raw: unknown): string | null {
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
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "Sync guide", heading: "Sync guide bundle not built", file: "dist/syncGuide/syncGuide.js", reopen: "the sync guide" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Sync guide</title>
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "syncGuide.css")).toString()}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}

const MODULE = "library/syncGuide";

let current: vscode.WebviewPanel | undefined;

/** Reveals the open guide tab, or opens one. `logger` is absent before a library is open. */
async function openSyncGuide(extensionUri: vscode.Uri, logger: ILogger | undefined): Promise<void> {
  if (current) { current.reveal(); return; }
  const panel = vscode.window.createWebviewPanel("labshelfSyncGuide", "Sync guide", vscode.ViewColumn.Active, {
    enableScripts: true, localResourceRoots: [syncGuideBundleDirectory(extensionUri)],
  });
  current = panel;
  panel.iconPath = labshelfTabIcon(extensionUri);
  panel.onDidDispose(() => { current = undefined; });
  panel.webview.onDidReceiveMessage((raw: unknown) => { void openLink(raw, logger); });
  panel.webview.html = await syncGuideHtml(panel.webview, extensionUri);
}

async function openLink(raw: unknown, logger: ILogger | undefined): Promise<void> {
  const url = parseOpenLink(raw);
  if (url === null) { return; }
  if (!isGuideLink(url)) {
    await logger?.log("WARN", MODULE, "Ignored a link the guide does not list", { url });
    return;
  }
  try {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } catch (error) {
    if (logger) { await logger.error(MODULE, error, { url }); }
    else { void vscode.window.showErrorMessage(`Could not open ${url}: ${errorMessage(error)}`); }
  }
}

export function registerSyncGuideCommand(context: vscode.ExtensionContext, getLogger: () => ILogger | undefined): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.syncGuide", () => openSyncGuide(context.extensionUri, getLogger())),
  );
}
