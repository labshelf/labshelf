// Builds the project history page's HTML shell: a strict CSP (the bundle's script by nonce, styles and fonts only from the extension) and the mount point.
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { bundleExists, bundleMissingHtml } from "../../ui/index.js";

/** <extension>/dist/history, for localResourceRoots. */
export function historyBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "history");
}

export async function historyHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = historyBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "history.js");
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "History", heading: "History bundle not built", file: "dist/history/history.js", reopen: "the history" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>History</title>
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "history.css")).toString()}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}
