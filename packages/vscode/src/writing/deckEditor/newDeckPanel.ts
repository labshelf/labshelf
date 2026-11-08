// The New talk or poster panel: shows the core template gallery (dist/newDeck/newDeck.js) in an editor tab and resolves with the
// choice the user creates, or null when they cancel or close the tab. The page posts ready, create and cancel; the host answers ready with init.
import * as vscode from "vscode";

import { createNonce, parseDeckTemplateChoice, type DeckTemplateChoice, type DeckTemplateGalleryInit } from "@labshelf/core";
import { createTabIcon, hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";

const VIEW_TYPE = "labshelf.newDeck";
const TITLE = "New talk or poster";

/** <extension>/dist/newDeck, for localResourceRoots. */
function bundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "newDeck");
}

async function panelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = bundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "newDeck.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: TITLE, heading: "New talk or poster bundle not built", file: "dist/newDeck/newDeck.js", reopen: "New talk or poster" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: TITLE,
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "newDeck.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
    // Kit logos and previews may arrive as data: URIs.
    images: "data",
  });
}

/** Opens the gallery with the kind, formats and Kits of init; resolves once, with the first valid choice or null on cancel or close. */
export function openNewDeckPanel(extensionUri: vscode.Uri, init: DeckTemplateGalleryInit): Promise<DeckTemplateChoice | null> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [bundleDirectory(extensionUri), webviewChunksDir(extensionUri)],
    });
    panel.iconPath = createTabIcon(extensionUri);
    const disposables: vscode.Disposable[] = [];
    let done = false;
    const finish = (choice: DeckTemplateChoice | null): void => {
      if (done) return;
      done = true;
      resolve(choice);
      while (disposables.length) disposables.pop()?.dispose();
      panel.dispose();
    };
    void panelHtml(panel.webview, extensionUri).then((html) => { if (!done) panel.webview.html = html; });
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (done) return;
      const message = raw as { type?: unknown; choice?: unknown } | null;
      switch (message?.type) {
        case "ready":
          void panel.webview.postMessage({ type: "init", init });
          return;
        case "create": {
          const choice = parseDeckTemplateChoice(message.choice);
          if (choice) finish(choice);
          else console.warn("[labshelf] New talk or poster: ignored an invalid template choice", message.choice);
          return;
        }
        case "cancel":
          finish(null);
          return;
      }
    }, null, disposables);
    panel.onDidDispose(() => finish(null), null, disposables);
  });
}
