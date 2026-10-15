/** Reads the origin and site of an absolute http(s) URL. */

function httpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** "https://host:port" in lower case, or undefined when `url` is not an absolute http(s) URL. */
export function originOf(url: string): string | undefined {
  return httpUrl(url)?.origin;
}

/** The registrable part of the host ("www.nature.com" gives "nature.com"), or undefined when `url` has no host. */
export function siteOf(url: string): string | undefined {
  return httpUrl(url)?.hostname.split(".").slice(-2).join(".");
}
