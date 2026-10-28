// Handles a webview bundle that is not in dist/: tells whether the file is on disk, and builds the page shown when it is not.
import * as vscode from "vscode";
import { escapeHtml } from "@labshelf/core";

/** Reports whether a built webview bundle file is on disk, through the VS Code file system so it works in any host. */
export async function hasBundleFile(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Directory of the code chunks every webview entry imports (shared modules and the editor's lazy math chunk).
 * Each webview lists it in `localResourceRoots`, next to its own bundle directory.
 * @returns <extension>/dist/chunks
 */
export function webviewChunksDir(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "chunks");
}

/**
 * Builds the page a webview shows when its bundle is not in dist/. Text only, with no style or script, so the
 * strictest CSP holds; it tells a dev checkout compiled without the webview build, instead of a blank panel.
 */
export function renderBundleMissingHtml(options: { title: string; heading: string; file: string; reopen: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none';"/>
<title>${escapeHtml(options.title)}</title>
</head>
<body>
<h3>${escapeHtml(options.heading)}</h3>
<p>${escapeHtml(options.file)} is missing. Run <code>pnpm --filter @labshelf/vscode build</code> and reopen ${escapeHtml(options.reopen)}.</p>
</body>
</html>`;
}
