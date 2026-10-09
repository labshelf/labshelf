/** Recognises the pages that bot-protection services answer instead of the publisher's content. */

const BOT_CHECK = /just a moment|attention required|checking your browser|cf-browser-verification|challenge-platform|cf_chl_|cloudflare|captcha|access denied|are you a robot|unusual traffic|problem providing the content/i;
const CHALLENGE_STATUSES = new Set([202, 403, 429, 503]);

/** True when a response is a bot check rather than the publisher's answer. */
export function isBotCheck(status: number, html: string): boolean {
  if (!CHALLENGE_STATUSES.has(status)) return false;
  // Block pages inline whole font files first; the telling words come after.
  return BOT_CHECK.test(html.replace(/<style[\s\S]*?<\/style>/gi, ""));
}
