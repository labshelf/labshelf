// Picks which library paper a downloaded or opened PDF belongs to, by id first and by page-1 title otherwise.
import { titleKey } from "../../library/index.js";
import { sameWork } from "../resolution/index.js";
import { idKeysFromPaper, idKeysFromUrls, type PaperIdFields } from "./idKeys.js";
import { titleCandidates } from "./titleCandidates.js";

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
