/** Tells whether a URL's host serves papers: a platform of the publisher rule table or a scholarly index or repository. */
import { PUBLISHER_RULES } from "./platforms/index.js";

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
