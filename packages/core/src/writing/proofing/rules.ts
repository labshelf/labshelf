/**
 * The words of the prose and the simple rules every language shares: a repeated word,
 * a double space between words and a space before punctuation, each with its quick fix.
 */
import type { ProseRange } from "./prose.js";

export interface ProseWord {
  from: number;
  to: number;
  word: string;
}

type SimpleRule = "repeatedWord" | "doubleSpace" | "spaceBeforePunctuation";

export interface RuleFinding {
  from: number;
  to: number;
  rule: SimpleRule;
  message: string;
  /** Replacing `from..to` of the document with `insert` fixes the finding. */
  fix: { from: number; to: number; insert: string };
}

const WORD = /\p{L}\p{M}*(?:[\p{L}\p{M}'’-]*\p{L}\p{M}*)?/gu;
const TOKEN_CHAR = /[\p{L}\p{M}\p{N}_'’-]/u;
const ACCENT_BEFORE = /(?:\\(?:['"`^~=.]|[uvHckrbdt](?![A-Za-z]))\{?|\\(?:['"`^~=.]|[uvHckrbdt])\{\p{L}\})$/u;
const ACCENT_AFTER = /^\{?\\(?:['"`^~=.]|[uvHckrbdt](?![A-Za-z]))/;

/** The prose words that spelling and rules check: letters only, no acronyms, no digits, no LaTeX accent commands. */
export function proseWords(text: string, ranges: readonly ProseRange[]): ProseWord[] {
  const words: ProseWord[] = [];
  for (const range of ranges) {
    for (const match of text.slice(range.from, range.to).matchAll(WORD)) {
      const from = range.from + (match.index ?? 0);
      const to = from + match[0].length;
      if (isCheckedWord(text, range, from, to, match[0])) words.push({ from, to, word: match[0] });
    }
  }
  return words;
}

function isCheckedWord(text: string, range: ProseRange, from: number, to: number, word: string): boolean {
  let tokenFrom = from;
  let tokenTo = to;
  while (tokenFrom > range.from && TOKEN_CHAR.test(text[tokenFrom - 1] ?? "")) tokenFrom--;
  while (tokenTo < range.to && TOKEN_CHAR.test(text[tokenTo] ?? "")) tokenTo++;
  if (/[\p{N}_]/u.test(text.slice(tokenFrom, tokenTo))) return false;
  if (word.length >= 2 && word === word.toUpperCase() && word !== word.toLowerCase()) return false;
  if (ACCENT_BEFORE.test(text.slice(Math.max(0, from - 6), from))) return false;
  return !ACCENT_AFTER.test(text.slice(to, to + 4));
}

/** Runs the simple rules on the prose; `tag` is the BCP-47 language of the text (French keeps its space before ; : ! ?). */
export function checkSimpleRules(text: string, ranges: readonly ProseRange[], tag: string): RuleFinding[] {
  const findings = [
    ...repeatedWords(text, ranges),
    ...doubleSpaces(text, ranges),
    ...spacesBeforePunctuation(text, ranges, tag.toLowerCase().startsWith("fr")),
  ];
  return findings.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Two equal words, case-insensitive, with only spaces and at most one line break between them. */
function repeatedWords(text: string, ranges: readonly ProseRange[]): RuleFinding[] {
  const words = proseWords(text, ranges);
  const findings: RuleFinding[] = [];
  for (let k = 1; k < words.length; k++) {
    const first = words[k - 1];
    const second = words[k];
    if (first === undefined || second === undefined) continue;
    if (first.word.toLocaleLowerCase() !== second.word.toLocaleLowerCase()) continue;
    if (!/^[ \t]*(?:\r?\n[ \t]*)?$/.test(text.slice(first.to, second.from)) || first.to === second.from) continue;
    if (!inside(ranges, first.to, second.from)) continue;
    findings.push({
      from: first.from,
      to: second.to,
      rule: "repeatedWord",
      message: `Repeated word "${second.word}".`,
      fix: { from: first.to, to: second.to, insert: "" },
    });
  }
  return findings;
}

/** Two or more spaces between two non-space prose characters of the same line. */
function doubleSpaces(text: string, ranges: readonly ProseRange[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const range of ranges) {
    for (const match of text.slice(range.from, range.to).matchAll(/(?<=[^\s])  +(?=[^\s])/gu)) {
      const from = range.from + (match.index ?? 0);
      const to = from + match[0].length;
      findings.push({
        from,
        to,
        rule: "doubleSpace",
        message: "Double space between words.",
        fix: { from, to, insert: " " },
      });
    }
  }
  return findings;
}

/** Spaces after a word and before , . ; : ! ? that ends there; French keeps them before ; : ! ?. */
function spacesBeforePunctuation(text: string, ranges: readonly ProseRange[], french: boolean): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const marks = french ? "[,.]" : "[,.;:!?]";
  const pattern = new RegExp(`(?<=[\\p{L}\\p{N}\\p{M})"'’”»])[ \\t\\u00a0]+(${marks})(?![\\p{L}\\p{N}.])`, "gu");
  for (const range of ranges) {
    for (const match of text.slice(range.from, range.to).matchAll(pattern)) {
      const from = range.from + (match.index ?? 0);
      const mark = from + match[0].length - 1;
      findings.push({
        from,
        to: mark + 1,
        rule: "spaceBeforePunctuation",
        message: `Space before "${match[1] ?? ""}".`,
        fix: { from, to: mark, insert: "" },
      });
    }
  }
  return findings;
}

function inside(ranges: readonly ProseRange[], from: number, to: number): boolean {
  return ranges.some((range) => range.from <= from && to <= range.to);
}
