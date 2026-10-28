/** Reads the title and authors from a paper's first page: font-grouped blocks, plain OCR lines, PDF metadata and author strings. */
import { normalizeWhitespace } from "../registries/index.js";
import type { TextBlock } from "./pdfDocument.js";

// Splits raw author strings into individual author names.

/**
 * Splits an author string (or passes through an array) into individual trimmed author names.
 * @returns Array of non-empty author name strings.
 */
export function normalizeAuthors(rawValue: string | string[] | undefined): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => value.trim()).filter(Boolean);
  }

  if (!rawValue) {
    return [];
  }

  const parts = rawValue
    .split(/\s+and\s+|;\s*|\s*&\s*/i)
    .map((value) => value.trim())
    .filter(Boolean);

  // Info.Author often holds "Ann Lee, Bo Chen, Cy Diaz" — one entry to the
  // split above. Commas are only safe to break on when every piece still looks
  // like a full name, since "Lee, Ann" is one author written surname-first.
  if (parts.length === 1 && parts[0]) {
    const commaSeparated = parts[0]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (commaSeparated.length > 2 && commaSeparated.every(looksLikeFullName)) {
      return commaSeparated;
    }
  }

  return parts;
}

// A full name carries at least a forename (or initial) and a surname.
function looksLikeFullName(value: string): boolean {
  return value.split(/\s+/).filter((word) => word.length > 0).length >= 2 && value.length <= 80;
}

// Infers the title and authors from the font-grouped text blocks of page 1.

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

// Guesses the title from plain front-matter lines, for OCR text that carries no font sizes.

// Lines a masthead prints above the title: article-type labels, the journal's
// own branding, access badges, identifiers and submission dates.
const MASTHEAD_NOISE = /\b(research article|original (article|research|paper)|review article|short communication|open access|artigo original|artigo de revis[aã]o|journal|revista|proceedings|anais|issn|doi|vol(ume)?\.?\s*\d|received|accepted|published|recebido|aceito|publicado|citation|copyright|licen[sc]e|editor|correspond)/i;
const TITLE_MAX_LINES = 4;
const TITLE_MAX_CHARS = 300;

/**
 * Guesses the title from plain front-matter lines, for text that came from OCR
 * and so carries no font sizes to rank by. Deliberately strict: a wrong title
 * is worse than none, since none sends the record to review. Line shape alone
 * also fits a licence notice or a lead sentence, so a run of lines only counts
 * as the title when the byline comes directly after it.
 * @returns The joined title lines, or undefined when no run qualifies.
 */
export function extractTitleFromPlainText(text: string): string | undefined {
  const lines = text
    .split("\n")
    // A stamp running up the margin leaves a stray symbol or digit at the start
    // of each line it crosses ("= EFFICIENT ALGORITHMS", "5 GRAPH SEARCH").
    .map((line) => line.trim().replace(/^[^A-Za-zÀ-ÿ\s]{1,2}\s+(?=\S{3,})/, ""))
    // OCR turns rules, logos and margin stamps into one- or two-letter specks,
    // or into symbol soup ("[| | [_] [| -") that would split a title in two.
    .filter((line) => line.length >= 4 && mostlyLetters(line))
    .slice(0, 30);

  for (let start = 0; start < lines.length; start += 1) {
    const picked: string[] = [];
    let next = start;
    while (next < lines.length && picked.length < TITLE_MAX_LINES && looksLikeTitleLine(lines[next]!)) {
      picked.push(lines[next]!);
      next += 1;
      // A full stop closes a sentence, and a title does not run past one.
      if (/[.!?]$/.test(picked[picked.length - 1]!)) {
        break;
      }
    }

    const title = picked.join(" ");
    const followedByByline = next < lines.length && looksLikeByline(lines[next]!);
    if (followedByByline && title.split(/\s+/).length >= 3 && title.length <= TITLE_MAX_CHARS) {
      return normalizeWhitespace(title);
    }
  }
  return undefined;
}

function looksLikeTitleLine(line: string): boolean {
  if (line.length < 12 || line.length > 200 || MASTHEAD_NOISE.test(line) || looksLikeByline(line)) {
    return false;
  }
  if (/https?:|www\.|@|©/i.test(line) || /^(abstract|resumo|resumen|summary|keywords?|palavras)/i.test(line)) {
    return false;
  }
  // OCR of logos and rules yields symbol soup; a title is almost all letters.
  const letters = (line.match(/[a-zà-ÿ]/gi) ?? []).length;
  return letters >= line.replace(/\s/g, "").length * 0.8;
}

function mostlyLetters(line: string): boolean {
  const visible = line.replace(/\s/g, "").length;
  return (line.match(/[a-zà-ÿ]/gi) ?? []).length >= visible * 0.5;
}

// Names separated by commas, or carrying affiliation markers.
function looksLikeByline(line: string): boolean {
  const commas = (line.match(/,/g) ?? []).length;
  const capitalized = (line.match(/\b[A-ZÀ-Þ][a-zà-ÿ]+/g) ?? []).length;
  const words = line.split(/\s+/).length;
  if (commas >= 2 && capitalized >= words * 0.6) {
    return true;
  }
  if (/[*†‡§¹²³]|\b[A-Z]\.\s?[A-Z][a-z]+/.test(line) && capitalized >= words * 0.6) {
    return true;
  }
  return namesJoinedByAnd(line);
}

const NAME_WORD = /^[A-ZÀ-Þ][a-zà-ÿ'’-]+[*†‡§¹²³0-9,]*$/;
const INITIAL = /^[A-ZÀ-Þ]\.?[*†‡§¹²³0-9,]*$/;
const CONNECTIVE = /^(and|&|e|y|und|et)$/i;

// "Ville Mustonen and Michael Lassig": nothing but capitalised names and
// initials around a connective. Title-cased titles keep their lowercase
// function words ("for", "of"), so they do not pass for one.
function namesJoinedByAnd(line: string): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length < 3 || words.length > 14 || !words.some((word) => CONNECTIVE.test(word))) {
    return false;
  }
  const names = words.filter((word) => !CONNECTIVE.test(word));
  return names.length >= 2 && names.every((word) => NAME_WORD.test(word) || INITIAL.test(word));
}

// Tells real titles from filenames, print-job names and placeholders in PDF metadata.

/**
 * Normalizes a raw title string by collapsing underscores, hyphens, and whitespace.
 * @returns The cleaned title string.
 */
export function normalizeTitle(rawValue: string): string {
  return rawValue
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Producers routinely dump the source filename or a print-job name into
// Info.Title ("15200863156991 1..46 - 28383.pdf", "Microsoft Word - ms.doc").
const FILENAME_TITLE = /\.(pdf|docx?|rtf|tex|ps|eps|indd|qxd|pages|odt)$/i;
const PLACEHOLDER_TITLE = /^(untitled|unknown|document\d*|no job name|microsoft word|print(out)?|paper|manuscript|main|ms|final|draft|template|layout|article)[\s\d.\-_]*$/i;

// A page printed from a viewer inherits the viewer's window title, not the
// paper's: Firefox stamps "PDF.js viewer" on everything printed from its reader.
const VIEWER_TITLE = /^(pdf\.?js viewer|pdf viewer|adobe (acrobat|reader)\b.*|preview|google (docs|drive)\b.*|(mozilla )?firefox|google chrome|safari|microsoft edge|about:blank|new tab)$/i;

/**
 * Reports whether a title from PDF metadata is a real title rather than a
 * filename, a print-job name, or a numeric identifier.
 * @returns The cleaned title when usable, otherwise undefined.
 */
export function deriveUsableTitle(rawValue: string | undefined): string | undefined {
  const value = rawValue?.trim();
  if (!value || value.length < 6 || value.length > 400) {
    return undefined;
  }
  if (FILENAME_TITLE.test(value) || PLACEHOLDER_TITLE.test(value) || VIEWER_TITLE.test(value)) {
    return undefined;
  }

  const letters = (value.match(/[a-zà-ÿ]/gi) ?? []).length;
  // Mostly digits and separators — an internal article or job number.
  if (letters < value.length * 0.5) {
    return undefined;
  }
  // A single long unbroken token is a slug or an identifier, not a title.
  if (!/\s/.test(value) && value.length > 40) {
    return undefined;
  }
  return value;
}
