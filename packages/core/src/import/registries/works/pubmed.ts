/** Looks up PubMed records by PMID and converts PMC ids to PMIDs. */
import { extractYear } from "../../metadata/index.js";
import { fetchJson } from "../http.js";
import { stripHtml } from "../text.js";
import type { RegistryRecord } from "../types.js";

interface PubMedSummary {
  title?: string;
  authors?: Array<{ name: string }>;
  pubdate?: string;
  fulljournalname?: string;
  source?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  issn?: string;
  articleids?: Array<{ idtype?: string; value?: string }>;
}

/**
 * Looks up a PubMed record by PMID via the E-utilities summary endpoint.
 * @returns Article metadata, or undefined when the PMID is unknown.
 */
export async function pubMedByPmid(pmid: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ result?: Record<string, PubMedSummary> }>(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmid)}`,
  );
  const record = payload?.result?.[pmid];
  if (!record?.title) {
    return undefined;
  }

  const doi = record.articleids?.find((id) => id.idtype === "doi")?.value;
  return {
    title: stripHtml(record.title),
    authors: (record.authors ?? []).map((author) => author.name).filter(Boolean),
    year: extractYear(record.pubdate),
    journal: record.fulljournalname ?? record.source,
    volume: record.volume,
    issue: record.issue,
    pages: record.pages,
    issn: record.issn,
    doi,
    url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };
}

/**
 * Resolves a PMC identifier to its PMID so the PubMed record can be fetched.
 * @returns The matching PMID, or undefined.
 */
export async function pmidFromPmcid(pmcid: string): Promise<string | undefined> {
  const payload = await fetchJson<{ records?: Array<{ pmid?: string }> }>(
    `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?format=json&ids=${encodeURIComponent(pmcid)}`,
  );
  return payload?.records?.[0]?.pmid;
}
