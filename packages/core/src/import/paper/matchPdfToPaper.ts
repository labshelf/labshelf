// Picks which library paper a downloaded or opened PDF belongs to, by id first and by page-1 title otherwise.
import { titleKey } from "../../library/index.js";
import { sameWork } from "./index.js";
import {
  arxivIdFromDoi,
  arxivIdFromUrl,
  extractDoi,
  normalizeArxivId,
  normalizePmcid,
  pmcidFromUrl,
} from "../identifiers/index.js";

// Journal banners, dates and author lines surround the title, so only the opening of the page is read.
const EARLY_LINES = 30;
// A title wraps over at most this many lines.
const MAX_WRAPPED_LINES = 3;
// A line this long is body text, never a title.
const MAX_TITLE_CHARS = 300;

/** Every early line of the page, and every run of up to three adjacent early lines joined with a space. */
function titleCandidates(firstPageText: string): string[] {
  const lines = firstPageText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .slice(0, EARLY_LINES);
  const out: string[] = [];
  for (let start = 0; start < lines.length; start++) {
    for (let count = 1; count <= MAX_WRAPPED_LINES && start + count <= lines.length; count++) {
      const joined = lines.slice(start, start + count).join(" ");
      if (joined.length <= MAX_TITLE_CHARS) out.push(joined);
    }
  }
  return out;
}

/** What identifies a library paper beyond its title; `url` is the page it was saved from. */
interface PaperIdFields {
  doi?: string | undefined;
  arxivId?: string | undefined;
  pmcid?: string | undefined;
  url?: string | undefined;
}

// Keys are "doi:…", "arxiv:…" or "pmc:…", lower-cased, versions dropped, so one Set compares all three kinds.
const doiKey = (doi: string | undefined): string[] => (doi ? [`doi:${doi.toLowerCase()}`] : []);
const arxivKey = (id: string | undefined): string[] => (id ? [`arxiv:${id.toLowerCase()}`] : []);
const pmcKey = (id: string | undefined): string[] => (id ? [`pmc:${id.toLowerCase()}`] : []);

/** The ids a PDF's address or its referring page names. */
function idKeysFromUrls(urls: readonly (string | undefined)[]): Set<string> {
  const keys: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    const doi = extractDoi(url);
    keys.push(...doiKey(doi), ...arxivKey(arxivIdFromUrl(url) ?? arxivIdFromDoi(doi)), ...pmcKey(pmcidFromUrl(url)));
  }
  return new Set(keys);
}

/** The ids a library paper carries: its own fields plus those readable from its DOI and saved-from URL. */
function idKeysFromPaper(paper: PaperIdFields): Set<string> {
  const doi = paper.doi ? (extractDoi(paper.doi) ?? paper.doi) : undefined;
  const fromUrl = paper.url ? idKeysFromUrls([paper.url]) : new Set<string>();
  const arxiv = paper.arxivId ? normalizeArxivId(paper.arxivId) : undefined;
  return new Set([
    ...fromUrl,
    ...doiKey(doi),
    ...arxivKey(arxiv ?? arxivIdFromDoi(doi)),
    ...pmcKey(normalizePmcid(paper.pmcid)),
  ]);
}

/** A library paper without a PDF, as far as the matcher needs to know it. */
export interface MatchablePaper extends PaperIdFields {
  title: string;
}

export interface PdfToMatch {
  url: string;
  /** The page the download started from. */
  referrer?: string | undefined;
  /** Text of the PDF's first page, one line per line of the page. */
  firstPageText?: string | undefined;
}

// Shorter titles ("Introduction", "Editorial") equal too many lines of unrelated PDFs.
const MIN_TITLE_KEY_CHARS = 15;

/**
 * An id found in the PDF's URL or referrer settles the match; otherwise the paper whose title best matches an early
 * line of page 1 wins. Ids from the URL and the referrer count alike.
 * @returns the one matching paper; undefined when nothing matches or several papers match equally well.
 */
export function matchPdfToPaper<T extends MatchablePaper>(pdf: PdfToMatch, papers: readonly T[]): T | undefined {
  const pdfIds = idKeysFromUrls([pdf.url, pdf.referrer]);
  const byId = pdfIds.size > 0 ? papers.filter((p) => [...idKeysFromPaper(p)].some((k) => pdfIds.has(k))) : [];
  if (byId.length > 0) return byId.length === 1 ? byId[0] : undefined;
  return pdf.firstPageText ? matchByTitle(pdf.firstPageText, papers) : undefined;
}

function matchByTitle<T extends MatchablePaper>(firstPageText: string, papers: readonly T[]): T | undefined {
  const candidates = titleCandidates(firstPageText);
  let best: T[] = [];
  let bestLength = 0;
  for (const paper of papers) {
    if (titleKey(paper.title).length < MIN_TITLE_KEY_CHARS) continue;
    const length = longestMatch(paper.title, candidates);
    if (length === 0 || length < bestLength) continue;
    if (length > bestLength) best = [];
    best.push(paper);
    bestLength = length;
  }
  return best.length === 1 ? best[0] : undefined;
}

/** @returns the normalised length of the longest candidate that is the same title, or 0. */
function longestMatch(title: string, candidates: readonly string[]): number {
  let longest = 0;
  for (const candidate of candidates) {
    const length = titleKey(candidate).length;
    if (length > longest && sameWork({ title }, { title: candidate })) longest = length;
  }
  return longest;
}
