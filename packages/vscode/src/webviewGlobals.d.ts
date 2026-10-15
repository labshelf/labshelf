/**
 * Declares what the webview bundles get from their host: the VS Code webview API and CSS imports, which esbuild
 * turns into dist/<bundle>/<bundle>.css.
 */
declare module "*.css";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/** Callable once per webview document. */
declare function acquireVsCodeApi(): VsCodeApi;
