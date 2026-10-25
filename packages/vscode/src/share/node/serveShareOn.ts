// Serves the sharing channel of one webview from the desktop sharing host.
import * as vscode from "vscode";

import { serveSharing, type ILogger, type SharingHost } from "@labshelf/core";

export function serveSharingOn(webview: vscode.Webview, host: SharingHost, logger: ILogger): vscode.Disposable {
  const stop = serveSharing(host, {
    post: (reply) => { void webview.postMessage(reply); },
    subscribe: (handler) => {
      const listener = webview.onDidReceiveMessage(handler);
      return () => listener.dispose();
    },
  }, logger);
  return new vscode.Disposable(stop);
}
