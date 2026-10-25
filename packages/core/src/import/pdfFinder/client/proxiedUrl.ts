/** Rewrites a URL to go through a library proxy, in the three shapes libraries use: a prefix, a hostname suffix or OpenAthens. */
import { httpUrl } from "../urlParts.js";

/**
 * - `prefix`: the template holds `$@` where the URL goes ("https://login.ezproxy.uni.edu/login?url=$@").
 * - `hostname`: the template is the proxy's domain (".ezproxy.uni.edu"), and the publisher's host is folded into it.
 * - `openathens`: the template is the library's OpenAthens redirector ("https://go.openathens.net/redirector/uni.edu").
 */
export type ProxyKind = "prefix" | "hostname" | "openathens";

const OPENATHENS = /^https:\/\/go\.openathens\.net\/redirector\/([a-z0-9.-]+)\/?(?:\?url=(?:\$@)?)?$/i;
const HOSTNAME_SUFFIX = /^\.?((?:[a-z0-9-]+\.)+[a-z]{2,})$/i;

/** How `template` rewrites URLs, or undefined when it is none of the three shapes. */
export function proxyKind(template: string): ProxyKind | undefined {
  const t = template.trim();
  if (OPENATHENS.test(t)) return "openathens";
  if (t.includes("$@")) return httpUrl(t.replace("$@", "x")) ? "prefix" : undefined;
  return HOSTNAME_SUFFIX.test(t) ? "hostname" : undefined;
}

/** `url` as fetched through the proxy, or undefined when the template or the URL cannot be read. */
export function proxiedUrl(template: string, url: string): string | undefined {
  const t = template.trim();
  const target = httpUrl(url);
  if (!target) return undefined;
  switch (proxyKind(t)) {
    case "openathens":
      return `https://go.openathens.net/redirector/${OPENATHENS.exec(t)![1]}?url=${encodeURIComponent(url)}`;
    case "prefix":
      return t.replace("$@", url);
    case "hostname":
      return `${target.protocol}//${foldHost(target.hostname)}.${HOSTNAME_SUFFIX.exec(t)![1]}${target.pathname}${target.search}`;
    default:
      return undefined;
  }
}

// TRAP: EZproxy's proxy-by-hostname doubles the hyphens a host already has before it turns the dots into hyphens, so
// "www.ams-journal.org" is "www-ams--journal-org"; a single hyphen would name another host.
function foldHost(hostname: string): string {
  return hostname.replace(/-/g, "--").replace(/\./g, "-");
}
