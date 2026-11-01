// Exports the webview side of the extension's message channel, its state-backed prefs and its sharing client.
export { createWebviewNoteViewStore } from "./noteViewStore.js";
export { createWebviewChannel, createWebviewPrefs, createWebviewShareClient, createWebviewTransport } from "./transport.js";
