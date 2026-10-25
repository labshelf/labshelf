/** Reads arXiv ids, new-style (1706.03762) and old-style (hep-th/9711200, math.GT/0309136), from arxiv.org URLs, arXiv DOIs and typed text. */

const NEW_STYLE = String.raw`\d{4}\.\d{4,5}`;
// Archive, optional subject class, then the seven-digit number.
const OLD_STYLE = String.raw`[a-z]+(?:-[a-z]+)*(?:\.[a-z]{2})?\/\d{7}`;
/** The regex source of one arXiv id, new- or old-style, for patterns that find ids in running text. */
export const ARXIV_ID_SOURCE = `(?:${NEW_STYLE}|${OLD_STYLE})`;

// arXiv's own DOIs (10.48550/arXiv.2301.12345) name the preprint.
const ARXIV_DOI = new RegExp(`^10\\.48550\\/arxiv\\.(${ARXIV_ID_SOURCE})(?:v\\d+)?$`, "i");
// doi.org links of arXiv DOIs count too: aggregators list them as the preprint's landing page.
const ARXIV_URL = new RegExp(`(?:arxiv\\.org\\/(?:abs|pdf|html)\\/|doi\\.org\\/10\\.48550\\/arxiv\\.)(${ARXIV_ID_SOURCE})(?:v\\d+)?`, "i");
const BARE_ARXIV_ID = new RegExp(`^${ARXIV_ID_SOURCE}$`, "i");

/** The arXiv id named by an arXiv DOI, if `doi` is one. */
export function extractArxivIdentifierFromDoi(doi: string | undefined): string | undefined {
  return doi ? ARXIV_DOI.exec(doi)?.[1] : undefined;
}

/** The arXiv id in an arxiv.org `/abs/`, `/pdf/` or `/html/` URL, or in the doi.org link of an arXiv DOI. */
export function extractArxivIdentifierFromUrl(url: string): string | undefined {
  return ARXIV_URL.exec(url)?.[1];
}

/**
 * Reduces a typed arXiv id to its bare form: no `arXiv:` prefix, no version.
 * @returns The id, or undefined when the text is not a bare arXiv id.
 */
export function normalizeArxivIdentifier(raw: string): string | undefined {
  const id = raw.trim().replace(/^arxiv:\s*/i, "").replace(/v\d+$/i, "");
  return BARE_ARXIV_ID.test(id) ? id : undefined;
}
