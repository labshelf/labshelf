// Builds the Project Search view's HTML shell: a strict CSP (the bundle's script by nonce, styles and fonts only from the extension) and the mount point.
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { hasBundleFile, renderBundleMissingHtml, renderHtmlShell } from "../../ui/index.js";

/** <extension>/dist/search, for localResourceRoots. */
export function readSearchBundleDir(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "search");
}

export async function searchHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = readSearchBundleDir(extensionUri);
  const script = vscode.Uri.joinPath(dir, "search.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "Project Search", heading: "Project Search bundle not built", file: "dist/search/search.js", reopen: "the panel" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: "Project Search",
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "search.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
}
