/** Picks the attempts the access stage retries: publisher pages that asked for a sign-in. */
import { hostAccess } from "../rules/index.js";
import type { PdfAttempt } from "../pdfResolver.js";
import { httpUrl, siteOf } from "../urlParts.js";

/**
 * The `login` attempts on the article's own site or on a paywalled platform of the rule table, best-ranked first and
 * each URL once. A repository or an open-access platform that refuses a page is not one a library can open.
 */
export function signInPages(attempts: readonly PdfAttempt[], landingUrl: string | undefined): PdfAttempt[] {
  const articleSite = landingUrl ? siteOf(landingUrl) : undefined;
  const seen = new Set<string>();
  return attempts.filter((a) => {
    const host = httpUrl(a.url)?.hostname;
    if (a.outcome !== "login" || a.proxy !== undefined || !host || seen.has(a.url)) return false;
    seen.add(a.url);
    const access = hostAccess(host);
    return access === "paywalled" || (access === undefined && articleSite !== undefined && siteOf(a.url) === articleSite);
  });
}
