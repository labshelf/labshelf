// Connects the Details pane's channel and prefs to the VS Code webview API.
import type { DetailsToHost, HostToDetails, MessageEnd, PrefsPort } from "@labshelf/core";

import { createWebviewPrefs, createWebviewTransport } from "../../../webview/index.js";

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
export function createDetailsChannel(): { transport: MessageEnd<DetailsToHost, HostToDetails>; prefs: PrefsPort } {
  const api = acquireVsCodeApi();
  return { transport: createWebviewTransport<DetailsToHost, HostToDetails>(api), prefs: createWebviewPrefs(api) };
}
