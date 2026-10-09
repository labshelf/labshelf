/** Guesses the title from plain front-matter lines, for OCR text that carries no font sizes. */
import { collapseWhitespace } from "../../metadata/index.js";

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
export function titleFromPlainText(text: string): string | undefined {
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
      return collapseWhitespace(title);
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
