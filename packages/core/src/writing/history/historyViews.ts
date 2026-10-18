// Builds what a history page shows: one row per entry with its changes, and the line diff of one file in one entry.
import type { ILogger } from "../../ports/index.js";
import { entryChanges, type FileChange } from "./historyChanges.js";
import type { HistoryKind } from "./historyEntry.js";
import type { HistoryStorage } from "./historyStorage.js";
import { lineDiff, type DiffLine } from "./lineDiff.js";
import { readHistory } from "./projectHistory.js";

export interface HistoryRow {
  id: string;
  at: string;
  kind: HistoryKind;
  label?: string;
  changes: FileChange[];
}

/** A NUL byte in the first 8 KiB marks a file as binary, as git does. */
const isBinary = (content: Uint8Array): boolean => content.subarray(0, 8192).includes(0);

/** @returns the rows, newest first */
export async function historyRows(storage: HistoryStorage, logger: ILogger): Promise<HistoryRow[]> {
  const entries = await readHistory(storage, logger);
  return entries.map((entry, index) => ({
    id: entry.id, at: entry.at, kind: entry.kind, ...(entry.label !== undefined && { label: entry.label }), changes: entryChanges(entries[index - 1], entry),
  })).reverse();
}

/** @returns the diff against the entry before, [] for an unknown entry, null when either side is binary */
export async function historyDiff(storage: HistoryStorage, id: string, file: string, logger: ILogger): Promise<DiffLine[] | null> {
  const entries = await readHistory(storage, logger);
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) { return []; }
  const read = async (hash: string | undefined): Promise<Uint8Array> => (hash ? storage.readObject(hash) : new Uint8Array());
  const [before, after] = await Promise.all([read(entries[index - 1]?.files[file]), read(entries[index]!.files[file])]);
  if (isBinary(before) || isBinary(after)) { return null; }
  const decoder = new TextDecoder();
  return lineDiff(decoder.decode(before), decoder.decode(after));
}
