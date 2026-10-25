/** Infers the title and authors from the font-grouped text blocks of page 1. */
import { normalizeAuthors } from "./authors.js";
import type { TextBlock } from "./pdfDocument.js";

// A publisher's access stamp ("Downloaded 12/25/12 to 134.76.1.1. Redistribution subject to SIAM license…") can be set
// in a larger font than the title, so it must not compete for it.
const ACCESS_STAMP = /^(downloaded|accessed)\b|redistribution subject to/i;

/**
 * Returns the title by picking the largest-font text run from the first eight blocks of page 1, skipping access stamps.
 * @returns The inferred title string, or undefined if no suitable block is found.
 */
export function extractTitleFromBlocks(blocks: TextBlock[]): string | undefined {
  const head = blocks.filter((block) => !ACCESS_STAMP.test(block.text)).slice(0, 8);
  if (head.length === 0) {
    return undefined;
  }

  let best = head[0]!;
  for (const block of head) {
    if (block.size > best.size) {
      best = block;
    }
  }

  const bodySize = medianSize(blocks);
  if (best.size <= bodySize * 1.15) {
    return undefined;
  }
  if (best.text.length < 6 || best.text.length > 400) {
    return undefined;
  }
  return best.text;
}

/**
 * Scans the blocks immediately below the title block and returns parsed author names.
 * @returns Array of author name strings, or empty array if no author line is detected.
 */
export function extractAuthorsFromBlocks(blocks: TextBlock[], title: string | undefined): string[] {
  if (!title) {
    return [];
  }
  const titleIndex = blocks.findIndex((block) => block.text === title);
  if (titleIndex < 0) {
    return [];
  }

  for (let i = titleIndex + 1; i < Math.min(blocks.length, titleIndex + 4); i += 1) {
    const candidate = blocks[i]!;
    if (looksLikeAuthorLine(candidate.text)) {
      const authors = normalizeAuthors(candidate.text);
      return isAllCapsByline(candidate.text) ? authors.map(titleCaseName) : authors;
    }
  }
  return [];
}

function looksLikeAuthorLine(text: string): boolean {
  if (text.length < 4 || text.length > 200) {
    return false;
  }
  if (/\.\s+[a-z]/.test(text)) {
    return false;
  }
  if (/\b(abstract|introduction|university|department|institut|faculty|laborat)/i.test(text)) {
    return false;
  }
  return /[A-ZÀ-Þ][a-zà-ÿ]+/.test(text) || isAllCapsByline(text);
}

// Journals such as SIAM set the byline in capitals; digits and punctuation other than name marks rule out stamps and running heads.
function isAllCapsByline(text: string): boolean {
  return /^[A-ZÀ-Þ][A-ZÀ-Þ'’.\-]*(?:[\s,]+[A-ZÀ-Þ][A-ZÀ-Þ'’.\-]*)+$/.test(text);
}

function titleCaseName(name: string): string {
  return name.toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

function medianSize(blocks: TextBlock[]): number {
  if (blocks.length === 0) {
    return 0;
  }
  const sizes = blocks.map((block) => block.size).sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 0;
}
