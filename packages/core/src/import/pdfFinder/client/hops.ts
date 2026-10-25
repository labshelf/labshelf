/** Reads an HTML answer to a PDF request for where the PDF actually is. */
import { derivePageFacts, parseHtmlPage, findRedirectUrls } from "../../landing/index.js";
import { listPdfUrlsForLanding } from "../rules/index.js";
import { isSupplementaryUrl } from "./supplementary.js";

const MAX_HOPS_PER_PAGE = 4;

/**
 * Where an HTML answer points next (meta refresh, scripted redirect, the publisher rule for the page, viewer and PDF
 * links), best guess first. The rule applies to every landing page a hop reaches: a doi.org redirect, an aggregator's link.
 */
export function extractNextHopsFromHtml(html: string, url: string): string[] {
  const facts = derivePageFacts(parseHtmlPage(html, url));
  const hops = [...findRedirectUrls(html, url), ...listPdfUrlsForLanding(url), ...facts.pdfCandidates.map((c) => c.url)];
  // A paywalled article page still links its supplements; one would download fine and be the wrong document.
  return [...new Set(hops)].filter((u) => u !== url && !isSupplementaryUrl(u)).slice(0, MAX_HOPS_PER_PAGE);
}
