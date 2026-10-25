// Builds paper records, entries and line text shared by the preview tests.
import type { PaperEntry, PaperRecord } from "@labshelf/core";

import type { Line } from "../../src/libraryUi/preview";

export const text = (lines: Line[]): string[] => lines.map((line) => line.map((segment) => segment.text).join(""));

export function record(extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "vaswani2017attention", title: "Attention Is All You Need", path: "/lib/papers/vaswani2017attention", citeKey: "vaswani2017attention", status: "unread", hasPdf: true, ...extra };
}

export function entry(extra: Partial<PaperRecord> = {}, collection = "", pdfBytes?: number): PaperEntry {
  return { record: record(extra), collection, modifiedMs: 1, ...(pdfBytes !== undefined ? { pdfBytes } : {}) };
}
