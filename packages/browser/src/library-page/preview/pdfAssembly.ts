// Merges the changed one-page PDFs of a helper build into the previous whole PDF of the preview.
import { PDFDocument } from "pdf-lib";
import type { HelperPageBytes } from "@labshelf/core/helper";

export interface ChangedPages {
  pageCount: number;
  changed: HelperPageBytes[];
}

/**
 * @param previous the last assembled PDF, or undefined before the first build.
 * @returns a PDF of `pageCount` pages: each changed page, else the previous PDF's page at that index.
 */
export async function assemblePdf(previous: Uint8Array | undefined, pages: ChangedPages): Promise<Uint8Array> {
  const { pageCount, changed } = pages;
  const byIndex = new Map(changed.map((page) => [page.index, page.bytes]));
  const out = await PDFDocument.create();
  const needsPrevious = Array.from({ length: pageCount }, (_, i) => i).some((i) => !byIndex.has(i));
  const base = needsPrevious && previous ? await PDFDocument.load(previous) : undefined;
  for (let index = 0; index < pageCount; index++) {
    const bytes = byIndex.get(index);
    if (bytes) {
      const single = await PDFDocument.load(bytes);
      const [page] = await out.copyPages(single, [0]);
      out.addPage(page);
    } else if (base && index < base.getPageCount()) {
      const [page] = await out.copyPages(base, [index]);
      out.addPage(page);
    } else {
      throw new Error(`The build sent no bytes for page ${index + 1} of ${pageCount}, and the previous PDF does not have it.`);
    }
  }
  return out.save();
}
