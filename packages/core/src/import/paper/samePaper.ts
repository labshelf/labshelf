// Decides whether records describe the same work: two bibliographic records, a queried paper against the library, and a PDF against the library's papers without one.
import { deriveFamilyName, normalizeText, normalizeTitleForMatch } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import { countCommon } from "../../text/index.js";
import {
  extractArxivIdentifierFromDoi,
  extractArxivIdentifierFromUrl,
  extractDoi,
  normalizeArxivIdentifier,
  normalizePmcid,
  extractPmcidFromUrl,
} from "../identifiers/index.js";
import type { ResolvedMetadata } from "../registries/index.js";

// TRAP: aggregators and title searches often return a neighbouring paper (BWA for BWA-SW), so a copy that did not
// come from the DOI's own record must pass this check before it is downloaded.

/** A record thin enough for the comparison: whatever a source managed to supply. */
export interface WorkReference {
  title?: string | undefined;
  year?: number | undefined;
  authors?: string[] | undefined;
}

export interface SamePaperOptions {
  /** Allowed absolute difference in publication year. Default 1; pass 2 for a preprint against its version of record. */
  yearSlack?: number;
}

// Below this two titles are different works. 0.9 keeps genuine variants together ("U-Net" vs "U Net") while
// splitting near neighbours such as BWA and BWA-SW, which score about 0.78 on word bigrams.
const TITLE_DICE_MIN = 0.9;

/**
 * Titles must be equal after normalisation or close by Dice coefficient, years must agree within the slack, and
 * when both sides list authors they must share a surname.
 * @returns true when `a` and `b` plausibly describe the same paper; false when either has no title.
 */
export function isSameWork(a: WorkReference, b: WorkReference, opts: SamePaperOptions = {}): boolean {
  const ta = a.title ? normalizeTitleForMatch(a.title) : "";
  const tb = b.title ? normalizeTitleForMatch(b.title) : "";
  if (!ta || !tb) return false;
  if (ta !== tb && deriveWordBigramDice(ta, tb) < TITLE_DICE_MIN) return false;

  const yearSlack = opts.yearSlack ?? 1;
  if (a.year !== undefined && b.year !== undefined && Math.abs(a.year - b.year) > yearSlack) return false;

  if (a.authors?.length && b.authors?.length) {
    const surnamesA = new Set(a.authors.map(deriveSurname).filter(Boolean));
    return b.authors.map(deriveSurname).some((s) => s !== "" && surnamesA.has(s));
  }
  return true;
}

/**
 * Dice coefficient over the adjacent word pairs of two normalised titles. Word pairs, not characters or single
 * words, are what separate near neighbours: single words score BWA against BWA-SW at 0.9 and would accept it.
 */
export function deriveWordBigramDice(normA: string, normB: string): number {
  const a = wordBigrams(normA);
  const b = wordBigrams(normB);
  if (a.length === 0 || b.length === 0) return normA === normB ? 1 : 0;
  return (2 * countCommon(a, b)) / (a.length + b.length);
}

// A one-word title falls back to that word so short titles still compare instead of scoring 0.
function wordBigrams(norm: string): string[] {
  const words = norm.split(" ").filter((w) => w.length > 0);
  if (words.length < 2) return words;
  return words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`);
}

// A title search's hit must not contradict the page, by a surname rule.

/**
 * A title search hit is accepted only when it does not contradict the page: same year (±1, for online-first vs
 * issue dates) and a shared author surname.
 */
export function checkTitleAgreement(found: ResolvedMetadata, page: ResolvedMetadata): boolean {
  if (found.year && page.year && Math.abs(found.year - page.year) > 1) return false;
  if (found.authors?.length && page.authors?.length) {
    const surnames = new Set(found.authors.map(deriveSurname));
    return page.authors.some((a) => surnames.has(deriveSurname(a)));
  }
  return true;
}

/** The author's family name, accent-folded and lower-cased; truncation marks ("Shor…") are dropped. */
export function deriveSurname(name: string): string {
  const folded = normalizeText(deriveFamilyName(name));
  return folded.replace(/[^a-z\s-]/g, " ").trim().split(/\s+/).pop() ?? "";
}

// Library lookup: a DOI or arXiv id settles it; otherwise the normalised title must match and the years must not disagree.


export interface PaperQuery {
  doi?: string | undefined;
  arxivId?: string | undefined;
  title?: string | undefined;
  year?: number | undefined;
}

// Shorter titles ("Introduction", "Editorial") are too common to identify a paper.
const MIN_TITLE_CHARS = 20;

/** @returns the library record describing the queried paper, if any */
export function findInLibrary(records: PaperRecord[], query: PaperQuery): PaperRecord | undefined {
  const doi = query.doi?.toLowerCase();
  if (doi) {
    const hit = records.find((r) => r.doi?.toLowerCase() === doi);
    if (hit) return hit;
  }
  const arxiv = query.arxivId?.toLowerCase().replace(/v\d+$/, "");
  if (arxiv) {
    const hit = records.find((r) =>
      r.doi?.toLowerCase() === `10.48550/arxiv.${arxiv}` || (r.url ?? "").toLowerCase().includes(`arxiv.org/abs/${arxiv}`));
    if (hit) return hit;
  }
  const title = query.title ? normalizeTitleForMatch(query.title) : "";
  if (title.length < MIN_TITLE_CHARS) return undefined;
  return records.find((r) =>
    normalizeTitleForMatch(r.title) === title && !(query.year && r.year && Math.abs(query.year - r.year) > 1));
}

// PDF matching: an id found in the PDF's URL or referrer settles it, else the page-1 title.

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
    keys.push(...doiKey(doi), ...arxivKey(extractArxivIdentifierFromUrl(url) ?? extractArxivIdentifierFromDoi(doi)), ...pmcKey(extractPmcidFromUrl(url)));
  }
  return new Set(keys);
}

/** The ids a library paper carries: its own fields plus those readable from its DOI and saved-from URL. */
function idKeysFromPaper(paper: PaperIdFields): Set<string> {
  const doi = paper.doi ? (extractDoi(paper.doi) ?? paper.doi) : undefined;
  const fromUrl = paper.url ? idKeysFromUrls([paper.url]) : new Set<string>();
  const arxiv = paper.arxivId ? normalizeArxivIdentifier(paper.arxivId) : undefined;
  return new Set([
    ...fromUrl,
    ...doiKey(doi),
    ...arxivKey(arxiv ?? extractArxivIdentifierFromDoi(doi)),
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
    if (normalizeTitleForMatch(paper.title).length < MIN_TITLE_KEY_CHARS) continue;
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
    const length = normalizeTitleForMatch(candidate).length;
    if (length > longest && isSameWork({ title }, { title: candidate })) longest = length;
  }
  return longest;
}
