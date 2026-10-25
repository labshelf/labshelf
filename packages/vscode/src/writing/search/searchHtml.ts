// Builds the Project Search view's HTML shell: a strict CSP (the bundle's script by nonce, styles and fonts only from the extension) and the mount point.
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { bundleExists, bundleMissingHtml } from "../../ui/index.js";

/** <extension>/dist/search, for localResourceRoots. */
export function searchBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "search");
}

export async function searchHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = searchBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "search.js");
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "Project Search", heading: "Project Search bundle not built", file: "dist/search/search.js", reopen: "the panel" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Project Search</title>
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "search.css")).toString()}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}
