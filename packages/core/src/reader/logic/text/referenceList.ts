/**
 * Finds the References section and looks entries up in it so a citation hover can show the cited work.
 * Deliberately conservative: when nothing matches reliably it returns nothing, and the hover falls back to a cropped image of the destination rather than showing the wrong reference.
 */
import { foldText } from "./inTextRefs.js";
import type { TextLine } from "./textLines.js";

// Compared after folding case and accents: OCR run with English language data turns "REFERÊNCIAS" into "REFERENCIAS".
const HEADINGS = new Set([
  "references", "reference list", "references and notes", "references cited", "cited references", "literature cited",
  "works cited", "bibliography", "literature",
  "referencias", "referencias bibliograficas", "referencias citadas", "bibliografia", "obras citadas", "literatura citada",
  "references bibliographiques", "bibliographie", "literatur", "literaturverzeichnis", "riferimenti bibliografici",
]);

/**
 * @returns true when a line is the heading of the reference list, in any of the supported languages.
 */
export function isReferencesHeading(raw: string): boolean {
  let text = raw.trim();
  if (text.length === 0 || text.length > 48) { return false; }
  // Letter-spaced display headings: "R E F E R E N C E S".
  if (/^(?:\p{L}\s){3,}\p{L}$/u.test(text)) { text = text.replace(/\s+/g, ""); }
  const folded = foldText(text)
    .replace(/^(?:\d{1,2}|[ivxl]{1,5})\s*[.)\-–]?\s+/, "")
    .replace(/[\s.:;\-–—]+$/, "")
    .replace(/\s+/g, " ");
  return HEADINGS.has(folded);
}

/**
 * @returns the index of the heading line, or -1.
 */
export function findReferencesStart(lines: readonly TextLine[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (isReferencesHeading(lines[i]!.text)) { return i; }
  }
  return -1;
}

export interface ReferenceEntry {
  text: string;
  /** Number from a leading "[12]", "12." or "(12)" marker, when present. */
  number: number | null;
  column: number;
  x: number;
  /** Baseline of the entry's first and last lines, PDF space (first > last). */
  yFirst: number;
  yLast: number;
  lineHeight: number;
}

export interface EntryQuery {
  /** Destination y in PDF space; link destinations sit at or slightly above the entry's first line. */
  y: number;
  x?: number | null;
  /** Column split x from `detectColumns`, when the page has two columns. */
  columnSplit?: number | null;
}

/**
 * @returns the entry whose first line is the nearest at or below the destination, or null if none is plausibly close.
 */
export function entryAtY(entries: readonly ReferenceEntry[], q: EntryQuery): ReferenceEntry | null {
  let pool = [...entries];
  if (q.columnSplit != null && q.x != null) {
    const column = q.x > q.columnSplit ? 1 : 0;
    const inColumn = pool.filter((e) => e.column === column);
    if (inColumn.length > 0) { pool = inColumn; }
  }
  let best: ReferenceEntry | null = null;
  let bestDistance = Infinity;
  for (const e of pool) {
    // Distance from the destination down to the first baseline; tolerate a destination that lands inside the first line.
    const d = q.y - e.yFirst;
    if (d < -e.lineHeight * 0.75) { continue; }
    if (d < bestDistance) { best = e; bestDistance = d; }
  }
  if (!best || bestDistance > best.lineHeight * 4) { return null; }
  return best;
}

export interface AuthorYearQuery {
  surname: string;
  coauthors?: readonly string[];
  /** "2020" or "2020a". */
  years: readonly string[];
}

const MAX_AUTHOR_YEAR_MATCHES = 3;
const CO_AUTHOR_AREA_CHARS = 200;
// Author–year styles (APA, Harvard, ABNT, Chicago) open every entry with the first author's surname, which is also the
// name an in-text citation uses. A surname found later in the entry is a co-author or someone named in the title.
const LEADING_MARKER = /^(?:[[(]?\s*[0-9lI|Oo]{1,3}\s*[\]).]\s*)?/;
const PARTICLES = /^(?:(?:de|da|do|dos|das|del|della|di|du|van|von|der|den|ten|la|le|el|al)\s+)*/;
// Corporate authors are cited by acronym — "(IBGE, 2020)" — while the entry may spell the name out first.
const ACRONYM_AREA_CHARS = 90;

/**
 * Resolves an author–year citation such as "(SILVA; COSTA, 2020)" or "Souza et al. (2019a)" against the reference list.
 * @returns the matching entries (at most three); several are returned when the list genuinely has several candidates.
 */
export function matchAuthorYear(entries: readonly ReferenceEntry[], q: AuthorYearQuery): ReferenceEntry[] {
  const surname = foldText(q.surname);
  if (surname.length < 2) { return []; }
  const escaped = surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opens = new RegExp(`^${escaped}(?:$|[^\\p{L}])`, "u");
  const word = new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, "u");
  const isAcronym = /^\p{Lu}{2,10}$/u.test(q.surname);
  const matches = entries.filter((e) => {
    const folded = foldText(e.text);
    const authors = folded.replace(LEADING_MARKER, "").replace(PARTICLES, "");
    if (!opens.test(authors) && !(isAcronym && word.test(authors.slice(0, ACRONYM_AREA_CHARS)))) { return false; }
    return q.years.some((year) => {
      // "2020" also accepts "2020a"; "2020a" must match exactly.
      const y = year.toLowerCase();
      return new RegExp(/[a-z]$/.test(y) ? `\\b${y}\\b` : `\\b${y}[a-z]?\\b`).test(folded);
    });
  });
  if (matches.length <= 1) { return matches; }
  const co = (q.coauthors ?? []).map(foldText).filter((c) => c.length >= 2);
  const narrowed = co.length > 0
    ? matches.filter((e) => co.every((c) => foldText(e.text).slice(0, CO_AUTHOR_AREA_CHARS).includes(c)))
    : [];
  return (narrowed.length > 0 ? narrowed : matches).slice(0, MAX_AUTHOR_YEAR_MATCHES);
}

/**
 * Lookup for plain-text markers such as "[12]", where there is no link destination to measure against.
 * @returns the entry whose leading marker carries that number, or null.
 */
export function entryByNumber(entries: readonly ReferenceEntry[], n: number): ReferenceEntry | null {
  return entries.find((e) => e.number === n) ?? null;
}
