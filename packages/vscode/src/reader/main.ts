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
const { workerUrl } = boot.assets;
// PLATFORM: in VS Code the worker URL is cross-origin, so the reader boots it from a Blob; a host that serves the extension's
// files from the webview's own origin (the browser editor page) refuses Blob workers under its CSP and runs this one directly.
const sameOriginWorker = workerUrl !== "" && new URL(workerUrl, location.href).origin === location.origin;
const pdf = sameOriginWorker ? { createWorker: (url: string) => new Worker(url, { type: "module" }) } : undefined;
startReader({ boot, transport: createVsCodeTransport(), perf, ...(pdf && { pdf }) }).catch(() => { /* already shown in #error-msg */ });
