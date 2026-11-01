/**
 * Starts the shared reader over the VS Code webview messaging API (entry of dist/reader/reader.js), using the boot
 * block the extension host wrote into the HTML shell.
 */
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/reader.css";
import "@labshelf/core/styles/arc-mark.css";
import "@labshelf/core/styles/preview.css";
import type { ReaderStartupParams } from "@labshelf/core";
import { PerfMarks, findElement, startReader, type ReaderTransport } from "@labshelf/core/dom";
import { createWebviewNoteViewStore } from "../../webview/index.js";

const perf = new PerfMarks();
const boot = JSON.parse(findElement("labshelf-boot").textContent ?? "{}") as ReaderStartupParams;
// acquireVsCodeApi() may be called once per webview document, so one api serves the transport and the note view state.
const api = acquireVsCodeApi();
const transport: ReaderTransport = {
  post: (msg) => api.postMessage(msg),
  listen: (sink) => window.addEventListener("message", (ev: MessageEvent<unknown>) => sink(ev.data)),
};
startReader({ boot, transport, perf, viewState: createWebviewNoteViewStore(api) }).catch(() => { /* already shown in #error-msg */ });
