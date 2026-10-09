/** Reads arXiv ids, new-style (1706.03762) and old-style (hep-th/9711200, math.GT/0309136), from arxiv.org URLs, arXiv DOIs and typed text. */

const NEW_STYLE = String.raw`\d{4}\.\d{4,5}`;
// Archive, optional subject class, then the seven-digit number.
const OLD_STYLE = String.raw`[a-z]+(?:-[a-z]+)*(?:\.[a-z]{2})?\/\d{7}`;
const ARXIV_ID = `(?:${NEW_STYLE}|${OLD_STYLE})`;

// arXiv's own DOIs (10.48550/arXiv.2301.12345) name the preprint.
const ARXIV_DOI = new RegExp(`^10\\.48550\\/arxiv\\.(${ARXIV_ID})(?:v\\d+)?$`, "i");
const ARXIV_URL = new RegExp(`arxiv\\.org\\/(?:abs|pdf|html)\\/(${ARXIV_ID})(?:v\\d+)?`, "i");
const BARE_ARXIV_ID = new RegExp(`^${ARXIV_ID}$`, "i");

/** The arXiv id named by an arXiv DOI, if `doi` is one. */
export function arxivIdFromDoi(doi: string | undefined): string | undefined {
  return doi ? ARXIV_DOI.exec(doi)?.[1] : undefined;
}

/** The arXiv id in an arxiv.org `/abs/`, `/pdf/` or `/html/` URL. */
export function arxivIdFromUrl(url: string): string | undefined {
  return ARXIV_URL.exec(url)?.[1];
}

/**
 * Reduces a typed arXiv id to its bare form: no `arXiv:` prefix, no version.
 * @returns The id, or undefined when the text is not a bare arXiv id.
 */
export function normalizeArxivId(raw: string): string | undefined {
  const id = raw.trim().replace(/^arxiv:\s*/i, "").replace(/v\d+$/i, "");
  return BARE_ARXIV_ID.test(id) ? id : undefined;
}
