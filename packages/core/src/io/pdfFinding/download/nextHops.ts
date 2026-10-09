/** Reads an HTML answer to a PDF request for where the PDF actually is. */
import { interpretPage, parseHtmlPage, redirectTargets } from "../../landing/index.js";

const MAX_HOPS_PER_PAGE = 4;

/** Where an HTML answer points next (meta refresh, scripted redirect, viewer, PDF links), best guess first. */
export function nextHopsFromHtml(html: string, url: string): string[] {
  const facts = interpretPage(parseHtmlPage(html, url));
  const hops = [...redirectTargets(html, url), ...facts.pdfCandidates.map((c) => c.url)];
  return [...new Set(hops)].filter((u) => u !== url).slice(0, MAX_HOPS_PER_PAGE);
}
