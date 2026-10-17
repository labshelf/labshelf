// Builds the sync guide page's HTML shell: a strict CSP (the bundle's script by nonce, styles and fonts only from the extension) and the mount point.
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { bundleExists, bundleMissingHtml } from "../../ui/bundleMissing/index.js";

/** <extension>/dist/syncGuide, for localResourceRoots. */
export function syncGuideBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "syncGuide");
}

export async function syncGuideHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
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
