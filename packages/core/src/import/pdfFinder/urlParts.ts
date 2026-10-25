/** Reads the origin and site of an absolute http(s) URL. */

/** `url` parsed, or undefined when it is not an absolute http(s) URL. */
export function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** "https://host:port" in lower case, or undefined when `url` is not an absolute http(s) URL. */
export function deriveOrigin(url: string): string | undefined {
  return parseHttpUrl(url)?.origin;
}

/** The registrable part of the host ("www.nature.com" gives "nature.com"), or undefined when `url` has no host. */
export function deriveSite(url: string): string | undefined {
  return parseHttpUrl(url)?.hostname.split(".").slice(-2).join(".");
}
