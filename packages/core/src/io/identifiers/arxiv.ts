/** Reads modern arXiv ids from arxiv.org URLs, arXiv DOIs and typed text. */

// arXiv's own DOIs (10.48550/arXiv.2301.12345) name the preprint.
const ARXIV_DOI = /^10\.48550\/arxiv\.(\d{4}\.\d{4,5})(?:v\d+)?$/i;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/i;
const BARE_ARXIV_ID = /^\d{4}\.\d{4,5}$/;

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
 * @returns The id, or undefined when the text is not a bare modern arXiv id.
 */
export function normalizeArxivId(raw: string): string | undefined {
  const id = raw.trim().replace(/^arxiv:\s*/i, "").replace(/v\d+$/i, "");
  return BARE_ARXIV_ID.test(id) ? id : undefined;
}
