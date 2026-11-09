// Builds the page of a chat webview view in the LabShelf Details side bar and wires its ready handshake; Research chat and Project chat share it.
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { hasBundleFile, renderBundleMissingHtml, webviewChunksDir } from "./bundleMissing.js";
import { cspImageSource } from "./cspImages.js";

/** A chat bundle in dist/: its folder, its script and stylesheet names, and the title its page and missing-bundle page show. */
export interface SideChatBundle {
  readonly dir: vscode.Uri;
  readonly script: string;
  readonly style: string;
  readonly title: string;
  /** The script path relative to the extension, shown when the bundle is not built. */
  readonly file: string;
}

async function sideChatHtml(webview: vscode.Webview, bundle: SideChatBundle): Promise<string> {
  const script = vscode.Uri.joinPath(bundle.dir, bundle.script);
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: bundle.title, heading: `${bundle.title} bundle not built`, file: bundle.file, reopen: bundle.title });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource};${cspImageSource(webview.cspSource, "qmd")} font-src ${webview.cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${bundle.title}</title><link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(bundle.dir, bundle.style))}"/>
</head><body><div id="root"></div><script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script)}"></script></body></html>`;
}

/** Loads the chat page into the view, calls onReady on each "ready" from the page and onGone once when the view is disposed. */
export async function resolveSideChatView(
  view: vscode.WebviewView, extensionUri: vscode.Uri, bundle: SideChatBundle, onReady: () => void, onGone: () => void,
): Promise<void> {
  view.webview.options = { enableScripts: true, localResourceRoots: [bundle.dir, webviewChunksDir(extensionUri)] };
  const messages = view.webview.onDidReceiveMessage((raw: unknown) => {
    if (raw && typeof raw === "object" && "type" in raw && raw.type === "ready") { onReady(); }
  });
  const disposed = view.onDidDispose(() => {
    messages.dispose();
    disposed.dispose();
    onGone();
  });
  view.webview.html = await sideChatHtml(view.webview, bundle);
}

/** Hides the side bar when the view shows, else focuses the view. */
export async function toggleSideChatView(view: vscode.WebviewView | undefined, viewId: string): Promise<void> {
  if (view?.visible) { await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar"); }
  else { await vscode.commands.executeCommand(`${viewId}.focus`); }
}
