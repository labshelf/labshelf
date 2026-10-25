// Opens the editor tab that shows the sync guide and opens the vendor pages its links point to.
import * as vscode from "vscode";
import { errorMessage, type ILogger } from "@labshelf/core";
import { labshelfTabIcon } from "../../ui/index.js";
import { isGuideLink, parseOpenLink } from "./syncGuideUrls.js";
import { syncGuideBundleDirectory, syncGuideHtml } from "./syncGuideHtml.js";

const MODULE = "library/syncGuide";

let current: vscode.WebviewPanel | undefined;

/** Reveals the open guide tab, or opens one. `logger` is absent before a library is open. */
export async function openSyncGuide(extensionUri: vscode.Uri, logger: ILogger | undefined): Promise<void> {
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
