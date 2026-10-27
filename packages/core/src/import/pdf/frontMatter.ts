/** Reads the abstract, keywords, publication year and running-head journal from a paper's front matter. */
import { normalizeWhitespace } from "../registries/index.js";

// Declares the section-heading patterns that bound the abstract and keyword runs in front matter.

// Headings that end the abstract. Matched case-sensitively — "since the
// introduction of the method" is prose, not a new section — and allowing the
// numbering styles journals print ("1 Introduction", "1. Introduction").
const SECTION_HEADINGS = ["Introduction", "Introdução", "Introducción", "Background", "Antecedentes"];
const KEYWORD_HEADINGS = ["Keywords", "Keyword", "Key words", "Index Terms", "Palavras-chave", "Palabras clave"];

const ABSTRACT_STOP = headingPattern([...SECTION_HEADINGS, ...KEYWORD_HEADINGS]);
const KEYWORDS_STOP = headingPattern([...SECTION_HEADINGS, "Abstract", "Resumo", "Resumen"]);

// Headings are printed either in title case or all caps; both spellings are
// listed so the pattern can stay case-sensitive and ignore running prose.
function headingPattern(words: string[]): RegExp {
  const alternatives = words.flatMap((word) => [word, word.toUpperCase()]).join("|");
  return new RegExp(`(?:^|\\n|\\s)(?:\\d{1,2}\\s*[.)]?\\s*)?(?:${alternatives})\\b`);
}

// Where the extracted run ends: at the next heading, or at the window's end.
function findStopOffset(window: string, stop: RegExp): number {
  const match = window.match(stop);
  return match?.index !== undefined ? match.index : window.length;
}

// Reads the abstract printed in a paper's front matter.

// The separator after the heading is unpredictable ("Abstract", "Abstract.",
// "Abstract:", "Abstract—") and the text layer sometimes swallows the space
// that followed it, so every delimiter is optional.
const ABSTRACT_HEADING = /(?:^|\n|\s)(?:abstract|summary|resumo|resumen)\b\s*[.:–—-]*\s*/gi;
// An abstract runs a few hundred words; anything shorter than the floor is a
// cross-reference ("see abstract") rather than the abstract itself.
const ABSTRACT_MAX_CHARS = 2500;
const ABSTRACT_MIN_CHARS = 120;
/**
 * Reads the abstract printed in a paper's front matter, for use as the summary
 * when no registry returned one.
 * @returns The abstract with whitespace collapsed, or undefined when absent.
 */
export function extractAbstract(text: string): string | undefined {
  if (!text) {
    return undefined;
  }

  // The word "abstract" also occurs in prose, so every occurrence is tried and
  // the first one followed by enough text to be an abstract wins.
  const heading = new RegExp(ABSTRACT_HEADING.source, ABSTRACT_HEADING.flags);
  let match: RegExpExecArray | null;
  while ((match = heading.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const window = text.slice(start, start + ABSTRACT_MAX_CHARS);
    const body = normalizeWhitespace(window.slice(0, findStopOffset(window, ABSTRACT_STOP)));
    if (body && body.length >= ABSTRACT_MIN_CHARS) {
      return body;
    }
  }
  return undefined;
}

// Reads the author-supplied keyword list printed below the abstract.

// Groups: the character before the label, and the delimiter after it — the
// label only counts as a label when one of the two proves it is a heading.
const KEYWORDS_LABEL = /(^|\n|\s)(?:keywords?|key\s+words|index\s+terms|palavras[-\s]?chave|palabras\s+clave)\b\s*([.:–—-]*)\s*/gi;

const KEYWORDS_MAX_CHARS = 400;
const KEYWORDS_MAX_COUNT = 15;

/**
 * Reads the author-supplied keyword list printed below the abstract.
 * @returns Up to 15 deduplicated keywords, or an empty array when absent.
 */
export function extractKeywords(text: string): string[] {
  if (!text) {
    return [];
  }

  const label = new RegExp(KEYWORDS_LABEL.source, KEYWORDS_LABEL.flags);
  let match: RegExpExecArray | null;
  while ((match = label.exec(text)) !== null) {
    // "keyword" also occurs mid-sentence, so the word is only treated as a
    // label when it opens a line or is followed by a delimiter.
    const isHeading = match.index === 0 || match[1] === "\n" || Boolean(match[2]);
    if (!isHeading) {
      continue;
    }

    const start = match.index + match[0].length;
    const window = text.slice(start, start + KEYWORDS_MAX_CHARS);
    const run = normalizeWhitespace(window.slice(0, findStopOffset(window, KEYWORDS_STOP))) ?? "";
    const keywords = splitKeywords(run);
    if (keywords.length > 0) {
      return keywords;
    }
  }
  return [];
}

function splitKeywords(run: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const part of run.split(/[,;·]/)) {
    const keyword = part.trim().replace(/[.;:,]+$/, "").trim();
    if (keyword.length < 2 || keyword.length > 60) {
      continue;
    }
    const fingerprint = keyword.toLowerCase();
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    keywords.push(keyword);
    if (keywords.length === KEYWORDS_MAX_COUNT) {
      break;
    }
  }
  return keywords;
}

// Finds the publication year stated in the front matter of a paper.

/**
 * Finds the publication year in the front matter of a paper (copyright line,
 * "Published/Received/Accepted" dates), which beats the PDF's file timestamp.
 * @returns A four-digit year, or undefined when none is stated.
 */
export function extractYearFromText(text: string): number | undefined {
  const patterns = [
    /(?:©|\(c\)|copyright)\s*(?:the author[s]?[,\s]*)?((?:19|20)\d{2})/i,
    /\b(?:published|accepted|received|issued|revised)\b[^\n]{0,40}?\b((?:19|20)\d{2})\b/i,
    /\b(?:19|20)\d{2}\b(?=[^\n]{0,20}\b(?:vol|volume|issue|no\.)\b)/i,
  ];

  const currentYear = new Date().getFullYear();
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const year = Number(match?.[1] ?? match?.[0]);
    if (year >= 1900 && year <= currentYear + 1) {
      return year;
    }
  }
  return undefined;
}

// Infers the journal name from the header or footer repeated across pages.

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
