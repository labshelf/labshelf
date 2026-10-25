// Decides which URLs the sync guide page may ask the host to open: only the vendor pages the guide itself lists.
// A webview is a trust boundary, so the host never opens a URL just because the page sent it.
import { syncGuide } from "@labshelf/core";

const GUIDE_URLS: ReadonlySet<string> = new Set([...syncGuide.tools, syncGuide.noCloud.tool].map((tool) => tool.url));

export function isGuideLink(url: unknown): url is string {
  return typeof url === "string" && GUIDE_URLS.has(url);
}

/** @returns the URL of an `openLink` message, or null for any other message. */
export function parseOpenLink(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) { return null; }
  const message = raw as { type?: unknown; url?: unknown };
  return message.type === "openLink" && typeof message.url === "string" ? message.url : null;
}
