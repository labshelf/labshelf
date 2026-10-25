/** Rewrites a preprint's .bib entry as its published version, keeping its key and the user's own fields. */
import type { RegistryRecord } from "../../import/index.js";
import type { BibEntry } from "./bibEntries.js";

// Fields that only describe the preprint; the published record replaces or drops them.
const PREPRINT_FIELDS = ["eprint", "archiveprefix", "eprinttype", "eprintclass", "primaryclass", "howpublished", "doi", "url"];
// `journal = {arXiv preprint arXiv:…}` and `note = {bioRxiv}` name the server, not a venue.
const PREPRINT_VENUE = /arxiv|biorxiv|medrxiv/i;
// CrossRef lists every member of a collaboration (ATLAS: about 3000 names); the user's `{ATLAS Collaboration}` is what they cite.
const MAX_LISTED_AUTHORS = 50;

/** The replacement text: an `@article` with the record's fields first, then the entry's other fields in their order. */
export function publishedEntry(entry: BibEntry, record: RegistryRecord, doi: string): string {
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
