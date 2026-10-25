// Mounts the shared project history page over the webview messaging API (entry of dist/history/history.js); the extension host answers in writing/history.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/project-history.css";
import { $, mountProjectHistory } from "@labshelf/core/dom";
import type { HistoryToHost, HistoryTransport, HostToHistory } from "@labshelf/core";
import { webviewTransport } from "../../../webview/index.js";

function createHistoryChannel(): HistoryTransport {
  return webviewTransport<HistoryToHost, HostToHistory>(acquireVsCodeApi());
}

mountProjectHistory($("root"), createHistoryChannel());
