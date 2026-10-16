/** Parses, formats and finds labshelf: links that point at a paper and optionally a page. */
// CONTRACT: documents/contracts/links.md#grammar

export interface LabshelfLink {
  readonly citeKey: string;
  /** 1-based page, absent when the link names only the paper. */
  readonly page?: number;
}

/** Where a link sits in a text, as UTF-16 offsets; `end` is exclusive. */
export interface LabshelfLinkMatch {
  readonly start: number;
  readonly end: number;
  readonly link: LabshelfLink;
}

const LINK = /(?<![A-Za-z0-9_+])(?:web\+)?labshelf:([A-Za-z0-9_:.-]+)(?:#p(\d+))?/g;
const TRAILING_PUNCTUATION = /[.:-]+$/;

export function formatLabshelfLink(link: LabshelfLink): string {
  return link.page === undefined ? `labshelf:${link.citeKey}` : `labshelf:${link.citeKey}#p${link.page}`;
}

/** Reads one whole link, also in its web+labshelf: form and percent-encoded, as a protocol handler receives it. */
export function parseLabshelfLink(text: string): LabshelfLink | undefined {
  const decoded = decodeOnce(text.trim());
  if (decoded === undefined) { return undefined; }
  const [match] = findLabshelfLinks(decoded);
  return match !== undefined && match.start === 0 && match.end === decoded.length ? match.link : undefined;
}

/** Finds every link in free text: a comment, a Markdown file, a commit message. */
export function findLabshelfLinks(text: string): LabshelfLinkMatch[] {
  if (!text.includes("labshelf:")) { return []; }
  const matches: LabshelfLinkMatch[] = [];
  for (const found of text.matchAll(LINK)) {
    const [whole, rawKey = "", rawPage] = found;
    // TRAP: a link that ends a sentence ("see labshelf:vaswani2017.") must not swallow the full stop.
    const citeKey = rawPage === undefined ? rawKey.replace(TRAILING_PUNCTUATION, "") : rawKey;
    if (citeKey === "") { continue; }
    const page = rawPage === undefined ? undefined : Number(rawPage);
    if (page !== undefined && !(Number.isSafeInteger(page) && page >= 1)) { continue; }
    const end = found.index + whole.length - (rawKey.length - citeKey.length);
    matches.push({ start: found.index, end, link: page === undefined ? { citeKey } : { citeKey, page } });
  }
  return matches;
}

function decodeOnce(text: string): string | undefined {
  if (!text.includes("%")) { return text; }
  try { return decodeURIComponent(text); } catch { return undefined; }
}
