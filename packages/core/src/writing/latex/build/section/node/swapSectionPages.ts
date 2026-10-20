/** Replaces a section's page range in a full PDF with the pages of that section typeset alone. */
import { PDFDocument } from "pdf-lib";

import type { PageRange } from "../assembly/index.js";

function indices(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset);
}

// INVARIANT: no metadata update, so the same inputs give the same bytes and unchanged pages keep their hashes.
export async function swapSectionPages(full: Uint8Array, section: Uint8Array, range: PageRange): Promise<Uint8Array | undefined> {
  const base = await PDFDocument.load(full, { updateMetadata: false });
  const part = await PDFDocument.load(section, { updateMetadata: false });
  if (part.getPageCount() !== range.end - range.start + 1) return undefined;
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = [
    ...await out.copyPages(base, indices(0, range.start)),
    ...await out.copyPages(part, part.getPageIndices()),
    ...await out.copyPages(base, indices(range.end + 1, base.getPageCount())),
  ];
  for (const page of pages) { out.addPage(page); }
  return out.save();
}
