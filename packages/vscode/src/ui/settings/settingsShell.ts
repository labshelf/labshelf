/**
 * The settings webview's HTML shell: a strict CSP (scripts and styles only from the bundle folder, the script also
 * by nonce), the bundled stylesheet and script, and the mount point. The page arrives with the bundle.
 */
import * as fs from "node:fs";
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { bundleMissingHtml } from "../bundleMissing/index.js";

/** <extension>/dist/settings, for localResourceRoots. */
export function settingsBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "settings");
}

export function settingsShellHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const dir = settingsBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "settings.js");
  if (!fs.existsSync(script.fsPath)) {
    return bundleMissingHtml({ title: "LabShelf Settings", heading: "Settings bundle not built", file: "dist/settings/settings.js", reopen: "the settings" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource};`;
  const uri = (file: string): string => webview.asWebviewUri(vscode.Uri.joinPath(dir, file)).toString();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>LabShelf Settings</title>
<link rel="stylesheet" href="${uri("settings.css")}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${uri("settings.js")}"></script>
</body>
</html>`;
}
