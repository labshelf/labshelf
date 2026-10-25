/** Exports where native-host files and browser manifests live, which browsers are present, and the manifest shape. */
export { resolveHostLayout, type BrowserHostSite, type HostLayout } from "./resolveHostLayout.js";
export { isBrowserPresent, detectSandboxWarnings } from "./browserDetection.js";
export { buildHostManifest } from "./hostManifest.js";
