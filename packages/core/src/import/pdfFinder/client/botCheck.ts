/** Recognises the pages that bot-protection services answer instead of the publisher's content. */
import { hasImpervaHeader, hasWallSignature, type HeaderReader } from "./signatures.js";

// Generic words appear on ordinary pages too ("cloudflare" in a footer), so they count only with a challenge status.
const GENERIC_BOT_CHECK = /just a moment|attention required|checking your browser|cf-browser-verification|challenge-platform|cf_chl_|cloudflare|captcha|access denied|are you a robot|unusual traffic|problem providing the content/i;
const CHALLENGE_STATUSES = new Set([202, 403, 429, 503]);
// A rendered page has no status, so only a challenge's title or Cloudflare's own markup counts.
const CHALLENGE_PAGE = /<title>\s*(just a moment|attention required|checking your browser|um momento|access denied)|challenges\.cloudflare\.com|cf_chl_opt|cf-browser-verification|id="challenge-(form|stage|running|error-text)"/i;

/** What a response shows beyond its status and body. */
export interface BotCheckOptions {
  finalUrl?: string;
  headers?: HeaderReader;
}

/** True when a response is a bot check rather than the publisher's answer. */
export function isBotCheck(status: number, html: string, { finalUrl, headers }: BotCheckOptions = {}): boolean {
  if (hasWallSignature(html, finalUrl, headers)) return true;
  if (!CHALLENGE_STATUSES.has(status)) return false;
  if (hasImpervaHeader(headers)) return true;
  // Block pages inline whole font files first; the telling words come after.
  return GENERIC_BOT_CHECK.test(html.replace(/<style[\s\S]*?<\/style>/gi, ""));
}

/** True when a page a tab rendered (its markup and address) is still a bot check rather than the site's own page. */
export function isWallPage(html: string, url: string): boolean {
  return hasWallSignature(html, url, undefined) || CHALLENGE_PAGE.test(html);
}
