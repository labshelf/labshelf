// Content-Security-Policy of the sandboxed deck frame (D7): closed by default, open only to the origins its resolved assets come from.

/** The http(s) origins of the given URLs, each once, in first-seen order; blob:, data: and unparsable URLs add none. */
export function assetOrigins(urls: Iterable<string>): string[] {
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") origins.add(parsed.origin);
    } catch {
      // not an absolute URL: it has no origin to allow
    }
  }
  return [...origins];
}

/** The D7 frame policy; the asset origin is left out when absent or empty, and resolved origins also open fonts and media. */
export function deckFrameCsp(assetOrigin?: string, resolvedOrigins: readonly string[] = []): string {
  const all = [...new Set([...(assetOrigin ? [assetOrigin] : []), ...resolvedOrigins])];
  const style = assetOrigin ? ` ${assetOrigin}` : "";
  const origins = all.map((origin) => ` ${origin}`).join("");
  const media = resolvedOrigins.length > 0 ? `; media-src${origins} data: blob:` : "";
  return `default-src 'none'; style-src 'unsafe-inline'${style}; img-src${origins} data: blob:; font-src${origins} data:${media}`;
}
