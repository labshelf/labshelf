// Builds the Spaces webview shell with its initial view and a nonce-based script policy.
import * as vscode from "vscode";
import { createNonce, type SpaceTab } from "@labshelf/core";
import { bundleExists, bundleMissingHtml } from "../../ui/bundleMissing/index.js";

export interface SpacesView { view: "catalog" | "space"; id?: string; tab?: SpaceTab }
export const spacesBundleDirectory = (extension: vscode.Uri): vscode.Uri => vscode.Uri.joinPath(extension, "dist", "spaces");

export async function spacesHtml(webview: vscode.Webview, extension: vscode.Uri, view: SpacesView): Promise<string> {
  const dir = spacesBundleDirectory(extension);
  const script = vscode.Uri.joinPath(dir, "spaces.js");
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "Spaces", heading: "Spaces bundle not built", file: "dist/spaces/spaces.js", reopen: "Spaces" });
  }
  const nonce = createNonce();
  const config = JSON.stringify(view).replace(/</g, "\\u003c");
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Spaces</title><link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "spaces.css"))}"/>
</head><body><div id="root"></div><script nonce="${nonce}" type="application/json" id="spaces-config">${config}</script>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script)}"></script></body></html>`;
}
