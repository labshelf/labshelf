/**
 * Starts the shared reader over the VS Code webview messaging API (entry of dist/reader/reader.js), using the boot
 * block the extension host wrote into the HTML shell.
 */
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/reader.css";
import "@labshelf/core/styles/arc-mark.css";
import "@labshelf/core/styles/preview.css";
// The consult windows' chooser, floating windows and footer share reader.css's overlays; the code view's toolbar styles come from the source editor's sheet.
import "@labshelf/core/styles/source-editor-toolbar.css";
import type { ReaderStartupParams } from "@labshelf/core";
import { PerfMarks, findElement, startReader, type ReaderTransport } from "@labshelf/core/dom";
import { createWebviewNoteViewStore } from "../../webview/index.js";
import { createReaderWebviewConsult } from "./readerConsult.js";

const perf = new PerfMarks();
const boot = JSON.parse(findElement("labshelf-boot").textContent ?? "{}") as ReaderStartupParams;
// acquireVsCodeApi() may be called once per webview document, so one api serves the transport and the note view state.
const api = acquireVsCodeApi();
// The consult sees every host message too: it answers its own envelopes and reads init's hasConsult.
const readerConsult = createReaderWebviewConsult({ post: (msg) => api.postMessage(msg) }, boot.assets);
const transport: ReaderTransport = {
  post: (msg) => api.postMessage(msg),
  listen: (sink) => window.addEventListener("message", (ev: MessageEvent<unknown>) => { readerConsult.receive(ev.data); sink(ev.data); }),
};
startReader({ boot, transport, perf, viewState: createWebviewNoteViewStore(api), consult: () => readerConsult.setup() }).catch(() => { /* already shown in #error-msg */ });
