/** Reads PubMed ids from PubMed URLs. */

const PUBMED_URL = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})\b|ncbi\.nlm\.nih\.gov\/pubmed\/(\d{6,9})\b/i;

/** The PMID in a PubMed URL, in either of its two forms. */
export function pmidFromUrl(url: string): string | undefined {
  return PUBMED_URL.exec(url)?.slice(1).find(Boolean);
}
