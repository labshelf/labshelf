// Builds the Research chat webview shell with extension-only assets.
import * as vscode from "vscode";
import { createNonce } from "@labshelf/core";
import { bundleExists, bundleMissingHtml } from "../ui/index.js";

export function researchChatBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "spaces");
}

export async function researchChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = researchChatBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "chat.js");
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "Research chat", heading: "Research chat bundle not built", file: "dist/spaces/chat.js", reopen: "Research chat" });
  }
  const nonce = createNonce();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Research chat</title><link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "chat.css"))}"/>
</head><body><div id="root"></div><script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script)}"></script></body></html>`;
}
