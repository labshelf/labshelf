/**
 * Starts the shared reader over the VS Code webview messaging API (entry of dist/reader/reader.js), using the boot
 * block the extension host wrote into the HTML shell.
 */
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/reader.css";
import "@labshelf/core/styles/arc-mark.css";
import "@labshelf/core/styles/preview.css";
import type { ReaderBootParams } from "@labshelf/core";
import { PerfMarks, $, startReader } from "@labshelf/core/dom";
import { createVsCodeTransport } from "./index.js";

const perf = new PerfMarks();
const boot = JSON.parse($("labshelf-boot").textContent ?? "{}") as ReaderBootParams;
startReader({ boot, transport: createVsCodeTransport(), perf }).catch(() => { /* already shown in #error-msg */ });
