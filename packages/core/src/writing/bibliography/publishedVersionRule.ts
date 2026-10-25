/** Warns about preprint entries whose published version is recorded, with a fix that replaces the entry. */
import { crossRefByDoi, publishedDoiOf, type PreprintIds, type RegistryEnv, type RegistryRecord } from "../../import/index.js";
import type { BibEntry } from "./bibEntries.js";
import type { BibFinding } from "./bibliographyReport.js";
import { preprintIdsOf } from "./preprintIds.js";
import { publishedEntry } from "./publishedEntry.js";

export interface PublishedVersion {
  doi: string;
  /** The published work's metadata; undefined when CrossRef has no record for the DOI. */
  record: RegistryRecord | undefined;
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
  const doi = await publishedDoiOf(env, preprint);
  if (!doi) { return undefined; }
  const record = await crossRefByDoi(env, doi);
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
