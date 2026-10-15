/**
 * The list webview's HTML shell: a strict CSP (the bundle's script by nonce, styles and assets only from the
 * extension), the bundled stylesheet and script, and the mount point. The UI arrives with the bundle.
 */
import * as vscode from 'vscode';
import { createNonce } from '@labshelf/core';
import { bundleExists, bundleMissingHtml } from '../bundleMissing/index.js';

/** <extension>/dist/library, for localResourceRoots. */
export function libraryBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'library');
}

export async function listPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = libraryBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, 'library.js');
  if (!(await bundleExists(script))) { return bundleMissingHtml({ title: 'LabShelf', heading: 'Library bundle not built', file: 'dist/library/library.js', reopen: 'the list' }); }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>LabShelf</title>
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, 'library.css')).toString()}"/>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}
