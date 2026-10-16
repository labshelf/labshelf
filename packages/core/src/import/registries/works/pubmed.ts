/** Looks up PubMed records by PMID, converts PMC ids to PMIDs, and reads an article's author affiliations. */
import { extractYear } from "../../metadata/index.js";
import { fetchJson, fetchText, type RegistryEnv } from "../http.js";
import { matchTag, xmlText } from "../text.js";
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
export async function pubMedByPmid(env: RegistryEnv, pmid: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ result?: Record<string, PubMedSummary> }>(
    env,
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmid)}`,
  );
  const record = payload?.result?.[pmid];
  if (!record?.title) {
    return undefined;
  }

  const doi = record.articleids?.find((id) => id.idtype === "doi")?.value;
  return {
    title: xmlText(record.title),
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
export async function pmidFromPmcid(env: RegistryEnv, pmcid: string): Promise<string | undefined> {
  const payload = await fetchJson<{ records?: Array<{ pmid?: string }> }>(
    env,
    `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?format=json&ids=${encodeURIComponent(pmcid)}`,
  );
  return payload?.records?.[0]?.pmid;
}

/** One author of a PubMed article with the affiliation lines PubMed prints for them. */
interface PubMedAuthor {
  name?: string;
  affiliations: string[];
}

/**
 * Finds the PubMed article of a DOI and lists its authors' affiliations, where PubMed appends the corresponding
 * author's "Electronic address:".
 * @returns the authors in order, or [] when PubMed has no article for the DOI
 */
export async function pubMedAuthorsByDoi(env: RegistryEnv, doi: string): Promise<PubMedAuthor[]> {
  const search = await fetchJson<{ esearchresult?: { idlist?: string[] } }>(
    env,
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(`${doi}[doi]`)}`,
  );
  const pmid = search?.esearchresult?.idlist?.[0];
  if (!pmid) return [];
  const xml = await fetchText(env, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${encodeURIComponent(pmid)}`);
  return xml ? parsePubMedAuthors(xml) : [];
}

function parsePubMedAuthors(xml: string): PubMedAuthor[] {
  return [...xml.matchAll(/<Author\b[^>]*>([\s\S]*?)<\/Author>/g)].map(([, block = ""]) => {
    const name = [xmlText(matchTag(block, "ForeName")), xmlText(matchTag(block, "LastName"))].filter(Boolean).join(" ");
    const affiliations = [...block.matchAll(/<Affiliation>([\s\S]*?)<\/Affiliation>/g)]
      .map(([, text]) => xmlText(text))
      .filter((text): text is string => text !== undefined);
    return { ...(name ? { name } : {}), affiliations };
  });
}
