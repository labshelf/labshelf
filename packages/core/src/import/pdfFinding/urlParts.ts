/** The origin and hostname of an absolute http(s) URL, read without the URL class so the module stays runtime-neutral. */

const ORIGIN = /^(https?:\/\/[^/?#]+)/i;

/** "https://host:port" in lower case, or undefined when `url` is not an absolute http(s) URL. */
export function originOf(url: string): string | undefined {
  return ORIGIN.exec(url)?.[1]?.toLowerCase();
}

/** The registrable part of the host ("www.nature.com" gives "nature.com"), or undefined when `url` has no host. */
export function siteOf(url: string): string | undefined {
  const host = originOf(url)?.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  return host?.split(".").slice(-2).join(".");
}
