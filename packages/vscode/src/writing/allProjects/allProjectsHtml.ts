// Builds the All projects page's HTML shell: a strict CSP (the bundle's script by nonce, styles and fonts only from the extension) and the mount point.
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { bundleExists, bundleMissingHtml } from "../../ui/index.js";

/** <extension>/dist/projects, for localResourceRoots. */
export function allProjectsBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "projects");
}

export async function allProjectsHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = allProjectsBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "projects.js");
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "All projects", heading: "All projects bundle not built", file: "dist/projects/projects.js", reopen: "All projects" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>All projects</title>
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "projects.css")).toString()}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}
