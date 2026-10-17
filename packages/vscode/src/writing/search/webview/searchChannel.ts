// Connects the Project Search page to the VS Code webview messaging API.
import type { HostToSearch, SearchToHost, SearchTransport } from "@labshelf/core";

import { webviewTransport } from "../../../webviewMessaging/index.js";

export function createSearchChannel(): SearchTransport {
  return webviewTransport<SearchToHost, HostToSearch>(acquireVsCodeApi());
}
