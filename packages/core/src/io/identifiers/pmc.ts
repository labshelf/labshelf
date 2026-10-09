/** Reads PubMed Central ids from typed text and from the many URLs that serve a PMC article. */

const PMC_URL = /(?:ncbi\.nlm\.nih\.gov\/pmc\/articles\/|pmc\.ncbi\.nlm\.nih\.gov\/articles\/|europepmc\.org\/(?:pmc\/)?articles\/)(?:PMC)?(\d+)/i;

/** The canonical "PMC1234567" from any PMCID spelling (with or without the prefix), or undefined when there are no digits. */
export function normalizePmcid(raw: string | undefined): string | undefined {
  const digits = raw ? /(\d{3,})/.exec(raw)?.[1] : undefined;
  return digits ? `PMC${digits}` : undefined;
}

/** The PMCID in a PubMed Central or Europe PMC article URL. */
export function pmcidFromUrl(url: string): string | undefined {
  const digits = PMC_URL.exec(url)?.[1];
  return digits ? `PMC${digits}` : undefined;
}
