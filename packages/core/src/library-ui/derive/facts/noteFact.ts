// Derives the one-line preview of a paper's note for its tray row.
import type { PaperRecord } from "../../../model/index.js";

const MAX_LENGTH = 120;

export function noteFact(record: PaperRecord): string {
  const flat = (record.note ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "Empty";
  return flat.length > MAX_LENGTH ? `${flat.slice(0, MAX_LENGTH).trimEnd()}…` : flat;
}
