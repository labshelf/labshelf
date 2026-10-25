// Serves the sharing channel of one webview from the desktop sharing host.
import * as vscode from "vscode";

import { serveShare, type ILogger, type ShareHost } from "@labshelf/core";

export function serveShareOn(webview: vscode.Webview, host: ShareHost, logger: ILogger): vscode.Disposable {
  const stop = serveShare(host, {
    post: (reply) => { void webview.postMessage(reply); },
    subscribe: (handler) => {
      const listener = webview.onDidReceiveMessage(handler);
      return () => listener.dispose();
    },
  }, logger);
  return new vscode.Disposable(stop);
}
