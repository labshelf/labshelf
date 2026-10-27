/** Publisher rules: the rule shape, the lookups by DOI or landing page, and the scholarly-host test; the table itself is in platforms.ts. */
import { parseUrl } from "../../url/index.js";
import { PUBLISHER_RULES } from "./platforms.js";

// Rule shape: where a platform serves its PDFs, from a DOI or from its landing page.

/** A DOI or landing page URL, and one PDF URL the rule must give for it. */
interface RuleExample {
  from: string;
  pdf: string;
}

/** One publisher platform's PDF addresses, as a function of the DOI or of the landing page URL. */
export interface PublisherRule {
  /** Platform name, unique in the table. */
  platform: string;
  /** Hostnames the platform serves pages from; landing shapes apply only there. */
  hosts: RegExp;
  /** Set when every paper on the platform is free to read, so a sign-in there never needs a library's access. */
  openAccess?: true;
  /** DOI prefixes the platform owns outright, and the PDF URLs a DOI gives. */
  doi?: {
    prefixes: readonly string[];
    pdfUrls(doi: string): string[];
  };
  /** Landing page shape, tested on the path and query, and the PDF URLs its match gives. */
  landing?: {
    path: RegExp;
    pdfUrls(match: RegExpExecArray, page: URL): string[];
  };
  /**
   * Real inputs checked against the live platform, each with the PDF URL it must give: a DOI for the `doi` part, a
   * landing URL for the `landing` part. Every part has at least one; the rule table's test runs them all.
   */
  examples: readonly RuleExample[];
}

// Reads the publisher rule table for the PDF URLs a DOI or a landing page gives.

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

// Tells whether a URL's host serves papers: a platform of the publisher rule table or a scholarly index or repository.

// Hosts outside the rule table that serve paper records: they give no PDF URL from a DOI, so no rule names them.
const INDEX_HOSTS =
  /(^|\.)(pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov|europepmc\.org|arxiv\.org|semanticscholar\.org|openalex\.org|doi\.org)$/i;
const NCBI_PMC = /^\/pmc\//i;

/** Whether `url` sits on a scholarly host; false for anything that is not an http(s) URL. */
export function isScholarlyHost(url: string): boolean {
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return false;
  }
  if (page.protocol !== "https:" && page.protocol !== "http:") return false;
  const host = page.hostname;
  if (INDEX_HOSTS.test(host)) return true;
  if (/^www\.ncbi\.nlm\.nih\.gov$/i.test(host)) return NCBI_PMC.test(page.pathname);
  return PUBLISHER_RULES.some((r) => r.hosts.test(host));
}
