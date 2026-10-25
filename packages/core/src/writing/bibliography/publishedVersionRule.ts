/** Warns about preprint entries whose published version is recorded, with a fix that replaces the entry. */
import {
  fetchCrossrefByDoi,
  findPublishedDoi,
  type PreprintIds,
  type RegistryEnv,
  type RegistryEntry,
} from "../../import/index.js";
import type { BibEntry } from "./bibEntries.js";
import type { BibFinding } from "./bibliographyReport.js";
import { preprintIdsOf } from "./preprintIds.js";

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

export type PublishedVersionLookup = (preprint: PreprintIds) => Promise<PublishedVersion | undefined>;

/**
 * Looks each preprint up once per lookup instance, because the linter runs on every save.
 * TRAP: a network failure reads as "no published version" and is remembered too; a fresh lookup asks again.
 */
export function publishedVersionLookup(env: RegistryEnv): PublishedVersionLookup {
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
export async function publishedVersionFindings(entries: readonly BibEntry[], lookup: PublishedVersionLookup): Promise<BibFinding[]> {
  const checked = await Promise.all(entries.map(async (entry) => {
    const ids = preprintIdsOf(entry);
    return { entry, version: ids ? await lookup(ids) : undefined };
  }));
  return checked.flatMap(({ entry, version }) => (version ? [finding(entry, version)] : []));
}

function finding(entry: BibEntry, version: PublishedVersion): BibFinding {
  const venue = version.record?.journal ? ` in ${version.record.journal}` : "";
  const result: BibFinding = {
    rule: "published-version", severity: "warning", key: entry.key, start: entry.start, end: entry.end,
    message: `${entry.key} cites a preprint that was published${venue} (doi:${version.doi}).`,
  };
  if (version.record) {
    result.fix = { title: "Replace with the published version", start: entry.start, end: entry.end, text: publishedEntry(entry, version.record, version.doi) };
  }
  return result;
}
