/** Looks up arXiv, PubMed, Europe PMC and DBLP records, and reads arXiv Atom answers and PubMed author affiliations. */
import { extractYear, parseString } from "./metadata.js";
import { fetchJson, fetchText, findFirstNonEmpty, matchTag, normalizeArray, parseXmlText, type RegistryEntry, type RegistryEnv } from "./http.js";

// arXiv

/**
 * Looks up an arXiv preprint by its identifier.
 * @returns Preprint metadata, or undefined when the id is unknown.
 */
export async function fetchArxivByIdentifier(env: RegistryEnv, arxivId: string): Promise<RegistryEntry | undefined> {
  const xml = await fetchText(
    env,
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
  );
  return xml ? parseArxivFeed(xml)[0] : undefined;
}

/**
 * Reads the preprints of an arXiv Atom answer.
 * @returns One record per entry, `url` being the abstract page; none for an error entry.
 */
export function parseArxivFeed(xml: string): RegistryEntry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match) => match[1] ?? "")
    .filter((entry) => !/<title>\s*Error/i.test(entry))
    .map(mapArxivEntry);
}

function mapArxivEntry(entry: string): RegistryEntry {
  // A preprint has no DOI until it is published; `<id>` is its abstract page.
  return {
    title: parseXmlText(matchTag(entry, "title")),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
      .map((match) => parseXmlText(match[1] ?? ""))
      .filter((name): name is string => Boolean(name)),
    year: extractYear(matchTag(entry, "published") ?? matchTag(entry, "updated")),
    journal: parseXmlText(matchTag(entry, "arxiv:journal_ref")) ?? "arXiv preprint",
    doi: parseXmlText(matchTag(entry, "arxiv:doi")),
    url: parseXmlText(matchTag(entry, "id")),
    summary: parseXmlText(matchTag(entry, "summary")),
  };
}

// PubMed

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
export async function fetchPubmedByPmid(env: RegistryEnv, pmid: string): Promise<RegistryEntry | undefined> {
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
    title: parseXmlText(record.title),
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
export async function resolvePmidFromPmcid(env: RegistryEnv, pmcid: string): Promise<string | undefined> {
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
export async function fetchPubmedAuthorsByDoi(env: RegistryEnv, doi: string): Promise<PubMedAuthor[]> {
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
    const name = [parseXmlText(matchTag(block, "ForeName")), parseXmlText(matchTag(block, "LastName"))].filter(Boolean).join(" ");
    const affiliations = [...block.matchAll(/<Affiliation>([\s\S]*?)<\/Affiliation>/g)]
      .map(([, text]) => parseXmlText(text))
      .filter((text): text is string => text !== undefined);
    return { ...(name ? { name } : {}), affiliations };
  });
}

// Europe PMC

interface EuropePmcResult {
  id?: string;
  source?: string;
  title?: string;
  authorString?: string;
  pubYear?: string;
  journalTitle?: string;
  journalVolume?: string;
  issue?: string;
  pageInfo?: string;
  doi?: string;
  journalIssn?: string;
}

/**
 * Searches Europe PMC, which covers preprint servers and European journals that
 * PubMed omits, and accepts free-text queries.
 * @returns Up to `rows` candidate articles, best match first.
 */
export async function searchEuropePmc(env: RegistryEnv, query: string, rows = 3): Promise<RegistryEntry[]> {
  const payload = await fetchJson<{ resultList?: { result?: EuropePmcResult[] } }>(
    env,
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${rows}&query=${encodeURIComponent(query)}`,
  );
  return (payload?.resultList?.result ?? []).map(mapEuropePmcResult);
}

function mapEuropePmcResult(result: EuropePmcResult): RegistryEntry {
  // Europe PMC's default `lite` result set carries no abstract, so summaries
  // have to come from another source.
  return {
    title: parseString(result.title),
    // `authorString` is a display sentence: "Doe J, Roe R." — the final stop is
    // punctuation, not part of the last author's initials.
    authors: (parseString(result.authorString)?.replace(/\.$/, "") ?? "")
      .split(", ")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    year: extractYear(result.pubYear),
    journal: parseString(result.journalTitle),
    volume: parseString(result.journalVolume),
    issue: parseString(result.issue),
    pages: parseString(result.pageInfo),
    doi: parseString(result.doi),
    issn: parseString(result.journalIssn),
    url:
      result.source && result.id
        ? `https://europepmc.org/article/${encodeURIComponent(result.source)}/${encodeURIComponent(result.id)}`
        : undefined,
  };
}

// DBLP

interface DblpAuthor {
  text?: string;
}

interface DblpInfo {
  title?: string;
  // DBLP collapses single-element lists into the element itself, so any of
  // these repeatable fields arrives as either one value or an array.
  authors?: { author?: DblpAuthor | DblpAuthor[] };
  year?: string;
  venue?: string | string[];
  volume?: string;
  pages?: string;
  doi?: string;
  ee?: string | string[];
  url?: string;
}

interface DblpHit {
  info?: DblpInfo;
}

/**
 * Searches DBLP. Computer-science work is overwhelmingly published at
 * conferences, which CrossRef indexes patchily, so DBLP is the only reliable
 * source for a large part of the field.
 * @returns Up to `rows` candidate publications, best match first.
 */
export async function searchDblp(env: RegistryEnv, query: string, rows = 3): Promise<RegistryEntry[]> {
  const payload = await fetchJson<{ result?: { hits?: { hit?: DblpHit[] } } }>(
    env,
    `https://dblp.org/search/publ/api?format=json&h=${rows}&q=${encodeURIComponent(query)}`,
  );
  // DBLP drops `hit` entirely when the query matches nothing.
  return (payload?.result?.hits?.hit ?? [])
    .map((hit) => hit.info)
    .filter((info): info is DblpInfo => Boolean(info?.title))
    .map(mapDblpInfo);
}

function mapDblpInfo(info: DblpInfo): RegistryEntry {
  return {
    title: parseString(info.title),
    authors: normalizeArray(info.authors?.author)
      .map((author) => parseString(author.text))
      .filter((name): name is string => Boolean(name)),
    year: extractYear(info.year),
    journal: findFirstNonEmpty(normalizeArray(info.venue)),
    volume: parseString(info.volume),
    pages: parseString(info.pages),
    doi: parseString(info.doi),
    url: findFirstNonEmpty(normalizeArray(info.ee)) ?? parseString(info.url),
  };
}
