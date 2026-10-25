// Builds the template gallery webview's HTML shell: a strict CSP (the bundle's script by nonce, styles and images only from the extension or inline data) and the mount point.
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { bundleExists, bundleMissingHtml } from "../../ui/index.js";

/** <extension>/dist/templates, for localResourceRoots. */
export function galleryBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "templates");
}

export async function galleryHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = galleryBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "templates.js");
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "Templates", heading: "Template gallery bundle not built", file: "dist/templates/templates.js", reopen: "the gallery" });
  }
  const nonce = createNonce();
  // Thumbnails arrive as data: URIs, so images allow data: next to the extension's own resources.
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Templates</title>
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "templates.css")).toString()}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}
