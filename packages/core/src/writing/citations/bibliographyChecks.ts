/** Lints the text of a user's .bib file: the findings and their fixes, duplicates, missing DOIs, and preprints with a published version. */

import { extractDoi, fetchCrossrefByDoi, findPublishedDoi, searchCrossref, type PreprintIds, type RegistryEntry, type RegistryEnv } from "../../import/index.js";
import { normalizeTitleForMatch } from "../../library/index.js";
import { BIBLIOGRAPHY_HEADER, extractPlainField, extractPreprintIdentifiers, parseBibEntries, type BibEntry } from "./bibliography.js";

// --- Linter types ---

export type BibliographyCheckRule = "duplicate" | "missing-doi" | "published-version";

/** One text replacement in the linted file: offsets `start`–`end` become `text`. */
export interface BibliographyFix {
  title: string;
  start: number;
  end: number;
  text: string;
}

export interface BibliographyProblem {
  rule: BibliographyCheckRule;
  severity: "warning" | "information";
  message: string;
  /** The entry the finding is about. */
  key: string;
  /** Character offsets of that entry in the file. */
  start: number;
  end: number;
  /** Absent when no safe edit exists, or when the fix needs a network lookup (see `deriveMissingDoiFix`). */
  fix?: BibliographyFix;
}

// --- Linting ---

// Types whose works usually have a DOI; a missing one on a book, thesis or web page is normal.
const DOI_TYPES = new Set(["article", "inproceedings", "incollection", "conference"]);

/** Each repeated entry after the first gets a warning: same key, same DOI, or same title. */
function duplicateFindings(text: string, entries: readonly BibEntry[]): BibliographyProblem[] {
  const byKey = new Map<string, BibEntry>();
  const byDoi = new Map<string, BibEntry>();
  const byTitle = new Map<string, BibEntry>();
  const findings: BibliographyProblem[] = [];
  for (const entry of entries) {
    const doi = extractDoi(extractPlainField(entry.fields.get("doi")))?.toLowerCase();
    const title = normalizeTitleForMatch(extractPlainField(entry.fields.get("title")));
    const sameKey = byKey.get(entry.key);
    const first = sameKey ?? (doi ? byDoi.get(doi) : undefined) ?? (title ? byTitle.get(title) : undefined);
    if (sameKey) {
      findings.push(duplicate(entry, `${entry.key} is defined twice; BibTeX uses the first one.`, removal(text, entry)));
    } else if (first) {
      const reason = doi && byDoi.get(doi) ? "the same DOI" : "the same title";
      findings.push(duplicate(entry, `${entry.key} has ${reason} as ${first.key}.`));
    }
    if (!byKey.has(entry.key)) { byKey.set(entry.key, entry); }
    if (doi && !byDoi.has(doi)) { byDoi.set(doi, entry); }
    if (title && !byTitle.has(title)) { byTitle.set(title, entry); }
  }
  return findings;
}

/** Articles and proceedings papers without a DOI; preprints are left to the published-version rule. */
function missingDoiFindings(entries: readonly BibEntry[]): BibliographyProblem[] {
  return entries
    .filter((entry) => DOI_TYPES.has(entry.type) && !entry.fields.has("doi") && !extractPreprintIdentifiers(entry))
    .map((entry) => ({
      rule: "missing-doi", severity: "information", key: entry.key, start: entry.start, end: entry.end,
      message: `${entry.key} has no DOI.`,
    }));
}

function duplicate(entry: BibEntry, message: string, fix?: BibliographyProblem["fix"]): BibliographyProblem {
  const finding: BibliographyProblem = { rule: "duplicate", severity: "warning", key: entry.key, start: entry.start, end: entry.end, message };
  if (fix) { finding.fix = fix; }
  return finding;
}

// A second entry with the same key is dead text, so removing it changes nothing BibTeX reads.
function removal(text: string, entry: BibEntry): BibliographyProblem["fix"] {
  const lineStart = text.lastIndexOf("\n", entry.start - 1) + 1;
  const start = text.slice(lineStart, entry.start).trim() === "" ? lineStart : entry.start;
  const end = text[entry.end] === "\n" ? entry.end + 1 : entry.end;
  return { title: `Remove the second ${entry.key}`, start, end, text: "" };
}

/** Lints the text of a user's .bib file for duplicates, missing DOIs and preprints with a published version. Findings in file order; LabShelf's generated labshelf.bib gets none, because the library rewrites it on every change. */
export async function checkBibliography(text: string, lookup: PublishedVersionFinder): Promise<BibliographyProblem[]> {
  if (text.startsWith(BIBLIOGRAPHY_HEADER)) { return []; }
  const entries = parseBibEntries(text);
  const findings = [
    ...duplicateFindings(text, entries),
    ...missingDoiFindings(entries),
    ...await derivePublishedVersionProblems(entries, lookup),
  ];
  return findings.sort((a, b) => a.start - b.start);
}

// --- Missing DOI fix ---

/**
 * Asks CrossRef by title and authors; a candidate counts only with the same title key and, when both have one, the same year,
 * because a near title is often a different paper of the same group.
 * @returns the insertion after the entry's key, or undefined when no candidate matches
 */
export async function deriveMissingDoiFix(env: RegistryEnv, text: string, entry: BibEntry): Promise<BibliographyFix | undefined> {
  const title = extractPlainField(entry.fields.get("title"));
  if (!normalizeTitleForMatch(title)) { return undefined; }
  const year = Number.parseInt(extractPlainField(entry.fields.get("year")), 10);
  const query = `${title} ${extractPlainField(entry.fields.get("author"))}`;
  const match = (await searchCrossref(env, query)).find((record) =>
    !record.isComponent && record.doi && normalizeTitleForMatch(record.title ?? "") === normalizeTitleForMatch(title)
    && (!record.year || Number.isNaN(year) || record.year === year));
  if (!match?.doi) { return undefined; }
  // INVARIANT: the parser accepted the entry, so a comma follows its key.
  const afterKey = text.indexOf(",", entry.start) + 1;
  return { title: `Add doi:${match.doi}`, start: afterKey, end: afterKey, text: `\n  doi = {${match.doi}},` };
}

// --- Published-version rule ---

// Fields that only describe the preprint; the published record replaces or drops them.
const PREPRINT_FIELDS = ["eprint", "archiveprefix", "eprinttype", "eprintclass", "primaryclass", "howpublished", "doi", "url"];
// `journal = {arXiv preprint arXiv:…}` and `note = {bioRxiv}` name the server, not a venue.
const PREPRINT_VENUE = /arxiv|biorxiv|medrxiv/i;
// CrossRef lists every member of a collaboration (ATLAS: about 3000 names); the user's `{ATLAS Collaboration}` is what they cite.
const MAX_LISTED_AUTHORS = 50;

/** The replacement text: an `@article` with the record's fields first, then the entry's other fields in their order. */
function publishedEntry(entry: BibEntry, record: RegistryEntry, doi: string): string {
  const published: Array<[string, string | undefined]> = [
    ["title", record.title], ["author", record.authors?.join(" and ")], ["journal", record.journal],
    ["year", record.year?.toString()], ["volume", record.volume], ["number", record.issue], ["pages", record.pages],
    ["publisher", record.publisher], ["doi", doi],
  ];
  const fields = new Map<string, string>();
  for (const [name, value] of published) {
    // INVARIANT: record values are plain text, so a brace in them would end the field early.
    if (value) { fields.set(name, value.replace(/[{}]/g, "")); }
  }
  const ownAuthors = entry.fields.get("author");
  if (ownAuthors && (record.authors?.length ?? 0) > MAX_LISTED_AUTHORS) { fields.set("author", ownAuthors); }
  for (const [name, value] of entry.fields) {
    const namesPreprint = (name === "note" || name === "journal") && PREPRINT_VENUE.test(value);
    if (!fields.has(name) && !PREPRINT_FIELDS.includes(name) && !namesPreprint) {
      fields.set(name, value);
    }
  }
  return formatBibEntry("article", entry.key, fields);
}

// One field per line, values in braces, no trailing comma.
function formatBibEntry(type: string, key: string, fields: ReadonlyMap<string, string>): string {
  const lines = [...fields].map(([name, value]) => `  ${name} = {${value}}`);
  return `@${type}{${key},\n${lines.join(",\n")}\n}`;
}

export interface PublishedVersion {
  doi: string;
  /** The published work's metadata; undefined when CrossRef has no record for the DOI. */
  record: RegistryEntry | undefined;
}

export type PublishedVersionFinder = (preprint: PreprintIds) => Promise<PublishedVersion | undefined>;

/**
 * Looks each preprint up once per lookup instance, because the linter runs on every save.
 * TRAP: a network failure reads as "no published version" and is remembered too; a fresh lookup asks again.
 */
export function createPublishedVersionFinder(env: RegistryEnv): PublishedVersionFinder {
  const known = new Map<string, Promise<PublishedVersion | undefined>>();
  return (preprint) => {
    const id = `${preprint.arxivId ?? ""}|${preprint.doi?.toLowerCase() ?? ""}`;
    let found = known.get(id);
    if (!found) {
      found = find(env, preprint);
      known.set(id, found);
    }
    return found;
  };
}

async function find(env: RegistryEnv, preprint: PreprintIds): Promise<PublishedVersion | undefined> {
  const doi = await findPublishedDoi(env, preprint);
  if (!doi) { return undefined; }
  const record = await fetchCrossrefByDoi(env, doi);
  return { doi, record: record?.isComponent ? undefined : record };
}

/** One warning per preprint entry with a published version; no relation recorded means no warning, never a title guess. */
async function derivePublishedVersionProblems(entries: readonly BibEntry[], lookup: PublishedVersionFinder): Promise<BibliographyProblem[]> {
  const checked = await Promise.all(entries.map(async (entry) => {
    const ids = extractPreprintIdentifiers(entry);
    return { entry, version: ids ? await lookup(ids) : undefined };
  }));
  return checked.flatMap(({ entry, version }) => (version ? [finding(entry, version)] : []));
}

function finding(entry: BibEntry, version: PublishedVersion): BibliographyProblem {
  const venue = version.record?.journal ? ` in ${version.record.journal}` : "";
  const result: BibliographyProblem = {
    rule: "published-version", severity: "warning", key: entry.key, start: entry.start, end: entry.end,
    message: `${entry.key} cites a preprint that was published${venue} (doi:${version.doi}).`,
  };
  if (version.record) {
    result.fix = { title: "Replace with the published version", start: entry.start, end: entry.end, text: publishedEntry(entry, version.record, version.doi) };
  }
  return result;
}
