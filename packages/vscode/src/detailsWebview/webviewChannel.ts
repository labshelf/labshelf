// Connects the Details pane's channel and prefs to the VS Code webview API.
import type { DetailsToHost, HostToDetails, MessageEnd, PrefsPort } from "@labshelf/core";

import { webviewPrefs, webviewTransport } from "../webviewMessaging/index.js";

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
export function createDetailsChannel(): { transport: MessageEnd<DetailsToHost, HostToDetails>; prefs: PrefsPort } {
  const api = acquireVsCodeApi();
  return { transport: webviewTransport<DetailsToHost, HostToDetails>(api), prefs: webviewPrefs(api) };
}
