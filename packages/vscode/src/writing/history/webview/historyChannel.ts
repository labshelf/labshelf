// Connects the project history page to the VS Code webview messaging API.
import type { HistoryToHost, HistoryTransport, HostToHistory } from "@labshelf/core";

import { webviewTransport } from "../../../webviewMessaging/index.js";

export function createHistoryChannel(): HistoryTransport {
  return webviewTransport<HistoryToHost, HostToHistory>(acquireVsCodeApi());
}
