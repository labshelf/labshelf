/** Builds rules for platforms whose pages and PDFs both sit under /doi/<doi> on the same host (Atypon, Wiley). */
import type { PublisherRule } from "./publisherRule.js";

// The landing views carry the DOI after /doi/ or /doi/<view>/; "pdf" and "pdfdirect" are not views, so a PDF URL never matches.
const DOI_LANDING = /^\/doi\/(?:(?:abs|full|epdf|epub|reader|book)\/)?(10\.\d{4,9}\/[^?#]+)/i;

interface DoiPathPlatform {
  platform: string;
  /** Canonical host for PDFs built from a bare DOI. */
  host: string;
  /** Hosts that serve the platform's pages; defaults to `host` alone. */
  hosts?: RegExp;
  prefixes: readonly string[];
  /** A real DOI on the platform; its landing example is the DOI's /doi/abs/ page on `host`. */
  example: string;
  /** Path segment before the DOI in the PDF URL, "pdf" unless the platform needs another. */
  pdfPath?: string;
  /** Query the PDF URL needs ("?download=true" on some sites). */
  query?: string;
}

export function createDoiPathRule(p: DoiPathPlatform): PublisherRule {
  const pdfAt = (host: string, doi: string): string => `https://${host}/doi/${p.pdfPath ?? "pdf"}/${doi}${p.query ?? ""}`;
  return {
    platform: p.platform,
    hosts: p.hosts ?? new RegExp(`^${p.host.replace(/\./g, "\\.")}$`, "i"),
    doi: { prefixes: p.prefixes, pdfUrls: (doi) => [pdfAt(p.host, doi)] },
    landing: { path: DOI_LANDING, pdfUrls: (m, page) => [pdfAt(page.host, decodeURIComponent(m[1]!))] },
    examples: [
      { from: p.example, pdf: pdfAt(p.host, p.example) },
      { from: `https://${p.host}/doi/abs/${p.example}`, pdf: pdfAt(p.host, p.example) },
    ],
  };
}
