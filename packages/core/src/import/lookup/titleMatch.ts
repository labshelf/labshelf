/** Compares titles to accept or reject a registry hit against what the PDF itself says. */

// A search hit is accepted only when this much of its title also appears in the
// text we searched with, which keeps a plausible-but-wrong paper out.
export const TITLE_MATCH_THRESHOLD = 0.75;

// A title shorter than this proves nothing when found inside a page of text.
const MIN_TITLE_WORDS_IN_PAGE = 4;
// Up to this many significant words, every one must be printed: on a page about
// "non-equilibrium dynamics", the chapter "Non equilibrium critical dynamics"
// matches three words of four, and the missing one is what makes it another work.
const SHORT_TITLE_WORDS = 6;

/**
 * Measures how much of `candidate` appears in `source`, ignoring case,
 * punctuation and word order. Asymmetric on purpose: `source` may be a whole
 * page of front matter, of which the title is only a part.
 * @returns Fraction of the candidate's significant words found in the source.
 */
export function titleOverlap(candidate: string, source: string): number {
  const candidateWords = significantWords(candidate);
  if (candidateWords.size === 0) {
    return 0;
  }

  const sourceWords = significantWords(source);
  let shared = 0;
  for (const word of candidateWords) {
    if (sourceWords.has(word)) {
      shared += 1;
    }
  }
  return shared / candidateWords.size;
}

// Finds where in the query a title is printed: the first run of words, about as
// long as the title, holding most of its words. Returns 0 when the query is
// itself title-sized, and undefined when the title's words are only scattered
// across a page — or when the title is too short for that to mean anything.
export function titlePosition(title: string, queryWords: string[]): number | undefined {
  const titleWords = significantWords(title);
  if (queryWords.length <= titleWords.size * 3) {
    return 0;
  }
  if (titleWords.size < MIN_TITLE_WORDS_IN_PAGE) {
    return undefined;
  }

  const span = titleWords.size + Math.max(2, Math.floor(titleWords.size / 2));
  const needed = titleWords.size <= SHORT_TITLE_WORDS ? titleWords.size : Math.ceil(titleWords.size * TITLE_MATCH_THRESHOLD);
  for (let start = 0; start < queryWords.length; start += 1) {
    if (!titleWords.has(queryWords[start]!)) {
      continue;
    }
    const found = new Set(queryWords.slice(start, start + span).filter((word) => titleWords.has(word)));
    if (found.size >= needed) {
      return start;
    }
  }
  return undefined;
}

export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(value: string): Set<string> {
  return new Set(
    normalizeForMatch(value)
      .split(" ")
      .filter((word) => word.length > 2),
  );
}
