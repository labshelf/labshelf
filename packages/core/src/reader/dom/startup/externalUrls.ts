/**
 * Routes clicks on external links through the host's scheme allow-list instead of the webview's default navigation.
 */
import type { HostBridge } from "../session/index.js";

/**
 * Intercepts http(s) and mailto link clicks inside `viewer` in the capture phase.
 */
export function interceptExternalLinks(viewer: HTMLElement, host: HostBridge): void {
  viewer.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a[href]");
    const href = a?.getAttribute("href") ?? "";
    if (!/^(https?:|mailto:)/i.test(href)) { return; }
    e.preventDefault();
    e.stopPropagation();
    host.post({ command: "openExternalLink", url: href });
  }, true);
}
