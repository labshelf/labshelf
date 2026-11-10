// Opens the reader's cite popup for a code listing (entry of dist/codeInsert/codeInsert.js): the host sends the label and the
// remembered project, answers the popup's cite requests, copies the listing and closes the panel when the popup closes.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/cite-dialog.css";
import { HostBridge, openCiteDialog, readerCiteClient, type CiteChoiceMemory } from "@labshelf/core/dom";

interface Boot { type: "codeInsert.boot"; label: string; memory: CiteChoiceMemory }

const api = acquireVsCodeApi();
const bridge = new HostBridge({
  post: (message) => api.postMessage(message),
  listen: (sink) => window.addEventListener("message", (event: MessageEvent<unknown>) => sink(event.data)),
});
let opened = false;

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const boot = event.data as Partial<Boot> | null;
  if (opened || boot?.type !== "codeInsert.boot" || typeof boot.label !== "string") { return; }
  opened = true;
  const memory: CiteChoiceMemory = { ...boot.memory };
  openCiteDialog({
    client: readerCiteClient(bridge),
    memory,
    notify: (message) => api.postMessage({ command: "notice", message }),
    onClose: () => api.postMessage({ command: "close", ...memory }),
    code: { label: boot.label, copy: (text) => api.postMessage({ command: "copyText", text }) },
  });
});
api.postMessage({ command: "ready" });
