// Lists the markers that bot-protection services leave in their challenge answers.

/** Reads one response header by name, as `Headers.get` does. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Markers specific enough to mean a wall on any status, even a 200:
 * F5/Fastly (Springer, eLife, JSTOR), AWS WAF (IEEE, De Gruyter, figshare), Anubis (HAL, DBLP),
 * the PMC proof-of-work, Imperva (Project Euclid, SPIE), HighWire's script check and MDPI's interstitial.
 */
const WALL_BODY = new RegExp(
  [
    "<title>\\s*Client Challenge\\s*</title>",
    "/_fs-ch-",
    "token\\.awswaf\\.com",
    "anubis_challenge",
    "POW_CHALLENGE",
    "cloudpmc-viewer-pow",
    "_Incapsula_Resource",
    "function leastFactor\\(",
    "/_sec/verify\\?provider=interstitial",
  ].join("|"),
  "i",
);

const RADWARE_HOST = "validate.perfdrive.com";

/** True when the page text, the final URL or a header names a wall. */
export function hasWallSignature(html: string, finalUrl: string | undefined, headers: HeaderReader | undefined): boolean {
  if (WALL_BODY.test(html)) return true;
  if (finalUrl && hostOf(finalUrl) === RADWARE_HOST) return true;
  const waf = headers?.get("x-amzn-waf-action")?.toLowerCase();
  return waf === "challenge" || waf === "captcha" || headers?.get("cf-mitigated")?.toLowerCase() === "challenge";
}

/**
 * True for Imperva's `x-iinfo` header. TRAP: Imperva adds it to every answer of a protected site, so it only
 * means a wall together with a challenge status.
 */
export function hasImpervaHeader(headers: HeaderReader | undefined): boolean {
  return headers?.get("x-iinfo") != null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
