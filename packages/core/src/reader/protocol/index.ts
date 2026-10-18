/** Exports the reader protocol: boot parameters, both message directions and the guards that validate them. */
export * from "./bootParams.js";
export * from "./hostToWebview.js";
export * from "./webviewToHost.js";
export { isSafeExternalUrl, isWebviewMessage } from "./webviewGuard.js";
