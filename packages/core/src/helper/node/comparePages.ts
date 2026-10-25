// Splits a PDF into one-page PDFs and reports the pages whose content differs from earlier hashes.
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";

export interface PageDiff {
  pageCount: number;
  hashes: string[];
  changed: { index: number; bytes: Uint8Array }[];
}

// INVARIANT: no metadata and no dates are written, so the same page content always yields the same bytes.
async function singlePage(source: PDFDocument, index: number): Promise<Uint8Array> {
  const page = await PDFDocument.create({ updateMetadata: false });
  const [copy] = await page.copyPages(source, [index]);
  page.addPage(copy);
  return page.save({ useObjectStreams: false, updateFieldAppearances: false });
}

export async function comparePages(previousHashes: readonly string[], pdf: Uint8Array): Promise<PageDiff> {
  const source = await PDFDocument.load(pdf, { updateMetadata: false });
  const pageCount = source.getPageCount();
  const hashes: string[] = [];
  const changed: PageDiff["changed"] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const bytes = await singlePage(source, index);
    const hash = createHash("sha256").update(bytes).digest("hex");
    hashes.push(hash);
    if (previousHashes[index] !== hash) { changed.push({ index, bytes }); }
  }
  return { pageCount, hashes, changed };
}
