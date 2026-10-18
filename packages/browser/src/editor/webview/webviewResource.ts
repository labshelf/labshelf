// Tells where a webview resource URL is served from in the editor page: the extension's copy next to the page, or the workbench host.

// CONTRACT: VS Code's asWebviewUri names a resource https://<scheme>+<encoded authority>.vscode-resource.vscode-cdn.net/<path>.
const RESOURCE_HOST = ".vscode-resource.vscode-cdn.net";
// The page registers each bundled extension at /<folder>, so an extension file's path starts with its folder under extensions/.
const EXTENSION_SCHEME = "extension-file";

/** What the workbench host's `load-resource` message carries, as VS Code's webview service worker sends it. */
export interface HostResourceRequest {
  scheme: string;
  authority: string;
  path: string;
  query: string;
}

export type WebviewResource = { kind: "page"; url: string } | { kind: "host"; request: HostResourceRequest };

/** `extensionsBase` is the URL of the page's extensions/ folder, ending in "/". */
export function webviewResource(url: string, extensionsBase: string): WebviewResource | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(RESOURCE_HOST)) return undefined;
  const prefix = parsed.hostname.slice(0, -RESOURCE_HOST.length);
  const plus = prefix.indexOf("+");
  const scheme = plus < 0 ? prefix : prefix.slice(0, plus);
  if (scheme === EXTENSION_SCHEME) return { kind: "page", url: new URL(`${parsed.pathname.slice(1)}${parsed.search}`, extensionsBase).href };
  return { kind: "host", request: { scheme, authority: plus < 0 ? "" : prefix.slice(plus + 1), path: parsed.pathname, query: parsed.search.slice(1) } };
}
