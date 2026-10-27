/** Infers the journal name from the header or footer repeated across pages. */
import { normalizeWhitespace } from "../registries/index.js";

/**
 * Infers the journal name from the running header/footer, which is the only
 * place many scanned or DOI-less PDFs name their venue.
 * @returns The line repeated on the most pages, or undefined when none repeats.
 */
export function extractJournalFromRunningHead(pageTexts: string[]): string | undefined {
  // Counted per page, not per occurrence: a line printed twice on one page is
  // still a single piece of evidence.
  const pageCounts = new Map<string, number>();
  for (const pageText of pageTexts) {
    const seenHere = new Set<string>();
    for (const line of pageText.split(/\r?\n/)) {
      const candidate = runningHeadCandidate(line);
      if (candidate) {
        seenHere.add(candidate);
      }
    }
    for (const candidate of seenHere) {
      pageCounts.set(candidate, (pageCounts.get(candidate) ?? 0) + 1);
    }
  }

  let best: string | undefined;
  // Starts at 1 so a line seen on a single page is never accepted.
  let bestCount = 1;
  for (const [candidate, count] of pageCounts) {
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function runningHeadCandidate(rawLine: string): string | undefined {
  const line = normalizeWhitespace(rawLine);
  if (!line || line.length > 120) {
    return undefined;
  }
  if (/^(page\s*)?\d+(\s*of\s*\d+)?$/i.test(line)) {
    return undefined;
  }

  // Pagination travels with the running head and changes on every page, so it
  // is stripped before candidates are compared.
  const stripped = line
    .replace(/\s*[|·]?\s*\d+\s+of\s+\d+\s*$/i, "")
    .replace(/^\d{1,4}\s+/, "")
    .replace(/\s+\d{1,4}$/, "")
    .replace(/^[|·•–—-]+|[|·•–—-]+$/g, "")
    .trim();

  if (stripped.length < 6 || stripped.length > 120) {
    return undefined;
  }
  // Mostly digits: a page range, a date line, or an internal article number.
  const digits = (stripped.match(/\d/g) ?? []).length;
  if (digits > stripped.length * 0.4) {
    return undefined;
  }
  return stripped;
}
