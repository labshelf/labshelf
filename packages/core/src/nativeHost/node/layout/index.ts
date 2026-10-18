/** Exports where native-host files and browser manifests live, which browsers are present, and the manifest shape. */
export { hostLayout, type BrowserTarget, type HostLayout } from "./hostLayout.js";
export { isBrowserPresent, sandboxWarnings } from "./browserDetection.js";
export { buildHostManifest } from "./hostManifest.js";
