/** Finds a DOI in a URL or field, and cleans every DOI candidate the same way whatever source it came from. */

// DOI: starts with 10. then a registrant prefix, slash, and suffix. Stops at
// characters that end a DOI inside a URL, a query string or markup.
const DOI_SCAN = /\b(10\.\d{4,}(?:\.\d+)*\/[^\s"',<>[\]{}|^`#?]+)/;
const DOI_SHAPE = /^10\.\d{4,}(?:\.\d+)*\/\S/;

// Path segments publishers append after the DOI in article URLs.
const URL_TAIL = /\/(?:abstract|full|fulltext|pdf|epdf|pdfdirect|html|meta|references|figures|citedby|summary)$/i;

/**
 * Decodes percent-escapes, keeping the text as it is when it is not valid
 * escaped text (a bare `%` in a DOI).
 * @returns The decoded text.
 */
export function decodeUrlEscapes(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Cleans a DOI candidate: decodes escapes, drops a `?query`, a `#fragment`, a
 * `.pdf` extension, publisher path tails and trailing punctuation. Brackets that
 * the DOI itself opens stay, so `10.1016/j.x.2020(1).` keeps its `(1)`.
 * @returns The bare DOI, or undefined when nothing DOI-shaped is left.
 */
export function normalizeDoiCandidate(raw: string): string | undefined {
  let doi = decodeUrlEscapes(raw).replace(/[?#].*$/s, "");
  doi = doi.replace(/[.,;:]+$/, "").replace(/\.pdf$/i, "");
  while (/[)\]]$/.test(doi) && openers(doi) < closers(doi)) {
    doi = doi.slice(0, -1).replace(/[.,;:]+$/, "");
  }
  while (URL_TAIL.test(doi)) {
    doi = doi.replace(URL_TAIL, "");
  }
  return DOI_SHAPE.test(doi) ? doi : undefined;
}

/**
 * Finds the first DOI in a URL, field or sentence.
 * @returns The cleaned DOI, or undefined when the text holds none.
 */
export function extractDoi(raw: string | undefined): string | undefined {
  const found = raw ? DOI_SCAN.exec(decodeUrlEscapes(raw))?.[1] : undefined;
  return found ? normalizeDoiCandidate(found) : undefined;
}

/**
 * Expands a DOI into the forms worth trying against a registry. Publishers mint
 * per-component DOIs (`10.7554/eLife.28383.001` for an abstract), so the parent
 * DOI must also be attempted to reach the article record itself.
 * @returns The DOI plus any parent form, in the order they should be tried.
 */
export function deriveDoiVariants(doi: string): string[] {
  const variants = [doi];
  const parent = doi.replace(/\.\d{3}$/, "");
  if (parent !== doi) {
    variants.push(parent);
  }
  return variants;
}

/**
 * Percent-encodes a DOI for use inside a URL path. The slash stays literal,
 * because Semantic Scholar routes on the `DOI:10.x/y` segment and answers a
 * `%2F` in its place with a rate-limit error instead of the record.
 */
export function encodeDoiPathSegment(doi: string): string {
  return encodeURIComponent(doi).replace(/%2F/gi, "/");
}

function openers(text: string): number {
  return countOf(text, "(") + countOf(text, "[");
}

function closers(text: string): number {
  return countOf(text, ")") + countOf(text, "]");
}

function countOf(text: string, char: string): number {
  return text.split(char).length - 1;
}
