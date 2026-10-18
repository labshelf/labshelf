/** Verifies that a section's pages replace their range in the full PDF and leave every other page byte-identical. */
import { PDFDocument, StandardFonts } from "pdf-lib";

import { swapSectionPages } from "../../../../../../src/writing/latex/build/section/node/index";
import { diffPages } from "../../../../../../src/writing/helper/node/pages/index";

async function pdfOf(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) { doc.addPage([200, 200]).drawText(label, { x: 20, y: 100, font }); }
  return doc.save();
}

describe("swapSectionPages", () => {
  it("replaces the range and keeps the untouched pages identical one-page PDFs", async () => {
    const full = await pdfOf(["p1", "p2", "p3", "p4", "p5"]);
    const before = await diffPages([], full);
    const swapped = await swapSectionPages(full, await pdfOf(["s2", "s3"]), { start: 1, end: 2 });
    const after = await diffPages(before.hashes, swapped);
    expect(after.pageCount).toBe(5);
    expect(after.changed.map((page) => page.index)).toEqual([1, 2]);
  });

  it("shifts the pages after the range when the section's page count changes", async () => {
    const full = await pdfOf(["p1", "p2", "p3", "p4"]);
    const before = await diffPages([], full);
    const swapped = await swapSectionPages(full, await pdfOf(["s2", "s2b", "s3"]), { start: 1, end: 1 });
    const after = await diffPages(before.hashes, swapped);
    expect(after.pageCount).toBe(5);
    expect(after.hashes[0]).toBe(before.hashes[0]);
    expect(after.hashes.slice(4)).toEqual(before.hashes.slice(3));
  });
});
