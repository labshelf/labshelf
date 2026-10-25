/** Judges whether the text extracted from a PDF is readable natural language. */

// Function words across the languages LabShelf papers are most often written
// in. Natural prose is densely populated with them; text recovered from a PDF
// whose fonts lack a usable ToUnicode map is not.
const FUNCTION_WORDS = new Set([
  "the", "of", "and", "in", "to", "for", "with", "that", "this", "are", "was", "were", "from", "not",
  "we", "our", "have", "has", "been", "which", "these", "their", "between", "than", "also", "such", "here",
  "de", "da", "do", "das", "dos", "que", "para", "com", "uma", "como", "por", "mais", "foi", "ser", "nos",
  "la", "el", "los", "las", "una", "por", "para", "con", "del", "les", "des", "une", "dans", "sur", "est",
  "und", "der", "die", "das", "den", "von", "mit", "ist", "auf", "ein", "eine", "nicht", "auch", "dem",
]);

/**
 * Reports whether extracted PDF text reads as natural language. Returns true
 * when there is too little text to judge, so short documents are not rejected.
 * @returns false only when the text is confidently unreadable (broken encoding).
 */
export function isNaturalText(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zà-ÿ]{2,}/g) ?? [];
  if (words.length < 40) {
    return true;
  }

  let hits = 0;
  for (const word of words) {
    if (FUNCTION_WORDS.has(word)) {
      hits += 1;
    }
  }
  return hits / words.length >= 0.04;
}

// A paper's first page holds hundreds of words. Fewer than this on every page
// means the text layer is a print header or a download stamp laid over pages
// that are stored as images or outlines.
const MIN_PAGE_WORDS = 40;

/**
 * Reports whether the text layer is too thin to describe the paper — a scan,
 * or a page re-printed from a browser, which draws its glyphs as vector paths.
 * Judged per page: the same stamp on three pages is still only a stamp.
 * @returns true when no page holds as many words as a real page of a paper.
 */
export function isSparseText(pageTexts: string[]): boolean {
  return pageTexts.every((text) => (text.match(/[a-zà-ÿ]{2,}/gi) ?? []).length < MIN_PAGE_WORDS);
}
