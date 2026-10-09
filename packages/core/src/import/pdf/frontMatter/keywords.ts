/** Reads the author-supplied keyword list printed below the abstract. */
import { collapseWhitespace } from "../../metadata/index.js";
import { KEYWORDS_STOP, stopIndex } from "./headings.js";

// Groups: the character before the label, and the delimiter after it — the
// label only counts as a label when one of the two proves it is a heading.
const KEYWORDS_LABEL = /(^|\n|\s)(?:keywords?|key\s+words|index\s+terms|palavras[-\s]?chave|palabras\s+clave)\b\s*([.:–—-]*)\s*/gi;

const KEYWORDS_MAX_CHARS = 400;
const KEYWORDS_MAX_COUNT = 15;

/**
 * Reads the author-supplied keyword list printed below the abstract.
 * @returns Up to 15 deduplicated keywords, or an empty array when absent.
 */
export function keywordsFromText(text: string): string[] {
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
    const run = collapseWhitespace(window.slice(0, stopIndex(window, KEYWORDS_STOP))) ?? "";
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
