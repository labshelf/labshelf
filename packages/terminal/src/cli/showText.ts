// Formats a paper's details (title, authors, venue, fields, notes) as the plain text `show` prints.
import * as path from "node:path";

import { formatBytes, paperFiles, venueLine, type PaperEntry } from "@labshelf/core";

import { STATUS_GLYPH } from "../libraryUi/index.js";

export function showText(entry: PaperEntry, highlights: number, page: number | undefined): string {
  const r = entry.record;
  const lines = [r.title];
  if (r.authors?.length) { lines.push(r.authors.join(", ")); }
  const venue = venueLine(r);
  if (venue) { lines.push(venue); }
  lines.push("");
  const rows: Array<[string, string | undefined]> = [
    ["id", r.id],
    ["status", `${STATUS_GLYPH[r.status]} ${r.status}`],
    ["tags", r.tags?.join(", ")],
    ["doi", r.doi],
    ["url", r.url],
    ["in", entry.collection || "(library root)"],
    ["pdf", r.hasPdf === false ? "not on this device" : `${paperFiles(r.path, path.join).pdf} (${formatBytes(entry.pdfBytes ?? 0)})`],
    ["notes", highlights ? `${highlights} highlight(s)` : undefined],
    ["read", page ? `stopped at page ${page}` : undefined],
  ];
  for (const [label, value] of rows) { if (value) { lines.push(`${label.padEnd(7)}${value}`); } }
  if (r.note?.trim()) { lines.push("", "note:", r.note.trim()); }
  if (r.summary?.trim()) { lines.push("", r.summary.trim()); }
  return lines.join("\n");
}
