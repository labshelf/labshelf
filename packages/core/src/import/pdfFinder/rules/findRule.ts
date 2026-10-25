/** Reads the publisher rule table for the PDF URLs a DOI or a landing page gives. */
import { PUBLISHER_RULES } from "./platforms/index.js";
import type { PublisherRule } from "./publisherRule.js";

/** The rules' PDF URLs for a DOI, or [] when no rule owns its prefix. */
export function listPdfUrlsForDoi(doi: string): string[] {
  const prefix = doi.slice(0, doi.indexOf("/"));
  return PUBLISHER_RULES.flatMap((r) => (r.doi?.prefixes.includes(prefix) ? r.doi.pdfUrls(doi) : []));
}

/** The rules' PDF URLs for a landing page, or [] when its host and path match no rule. */
export function listPdfUrlsForLanding(url: string): string[] {
  const page = parseUrl(url);
  if (!page) return [];
  return rulesOn(page).flatMap((r) => {
    const m = r.landing?.path.exec(page.pathname + page.search);
    return m && r.landing ? r.landing.pdfUrls(m, page) : [];
  });
}

/** Whether `hostname` is a platform in the table that gives its papers away or sells access, or undefined when no rule knows it. */
export function deriveHostAccess(hostname: string): "open" | "paywalled" | undefined {
  const rule = PUBLISHER_RULES.find((r) => r.hosts.test(hostname));
  if (!rule) return undefined;
  return rule.openAccess ? "open" : "paywalled";
}

function rulesOn(page: URL): PublisherRule[] {
  return PUBLISHER_RULES.filter((r) => r.hosts.test(page.hostname));
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
