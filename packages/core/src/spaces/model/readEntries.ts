// Splits a synced JSON array into its valid entries and the raw entries it cannot read.
// CONTRACT: documents/contracts/spaces.md#reading-and-writing
import { isNonEmptyString, isRecord } from "../../guards/index.js";

/** An entry, or the reason it is invalid. */
export type EntryParse<T> = (raw: unknown) => T | string;

export interface ReadEntries<T> {
  readonly valid: T[];
  /** Invalid entries, unchanged, so a write puts them back after the valid ones. */
  readonly raw: unknown[];
}

/** Valid entries in file order; a repeated id keeps its first entry and the repeats are dropped. */
export function readEntries<T extends { id: string }>(
  list: unknown, label: string, parse: EntryParse<T>, warnings: string[],
): ReadEntries<T> {
  const result: ReadEntries<T> = { valid: [], raw: [] };
  // INVARIANT: a list that is not an array makes the file read-only, so reading it as empty never erases it.
  if (!Array.isArray(list)) { return result; }
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    const parsed = parse(entry);
    if (typeof parsed === "string") { warnings.push(`${label}[${index}] kept unread: ${parsed}`); result.raw.push(entry); return; }
    if (seen.has(parsed.id)) { warnings.push(`${label}[${index}] dropped: repeats id ${parsed.id}`); return; }
    seen.add(parsed.id);
    result.valid.push(parsed);
  });
  return result;
}

/** The ids that raw entries still claim, so a new entry never reuses one. */
export function parseEntryIds(raw: readonly unknown[]): string[] {
  return raw.flatMap((entry) => (isRecord(entry) && isNonEmptyString(entry["id"]) ? [entry["id"]] : []));
}
