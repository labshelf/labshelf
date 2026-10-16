/** Attaches a found PDF to a paper already in the IndexedDB library, at the paper's current folder. */
import type { PaperRecord, PdfVersion } from "@labshelf/core";
import { PDF_FILE } from "@labshelf/core";
import { IndexedDbFileSystem, listAllRecords, type LibraryMutations } from "../storage";

/**
 * Attaches a PDF to a paper already in the library (the "Find PDF" / "Attach
 * PDF…" surfaces). The record is re-read by id from the live cache so a paper
 * moved during a long search is written at its CURRENT path — writing to a
 * stale path would leave an orphan folder the tree treats as a bogus paper. A
 * PDF that arrived meanwhile (e.g. by sync) is never overwritten, unless `replace`
 * says the user asked for a better version of it.
 * @returns The current record, and whether paper.pdf was written now.
 */
export async function attachPdfToPaper(
  mutations: LibraryMutations,
  paperId: string,
  bytes: Uint8Array,
  options: { version?: PdfVersion | undefined; replace?: boolean } = {},
): Promise<{ record: PaperRecord; written: boolean }> {
  const record = (await listAllRecords()).find((r) => r.id === paperId);
  if (!record) {
    throw new Error(`Paper "${paperId}" is no longer in the library.`);
  }
  const idb = new IndexedDbFileSystem();
  const pdfPath = `${record.path}/${PDF_FILE}`;
  if (!options.replace && (await idb.stat(pdfPath))) {
    return { record, written: false };
  }
  await idb.writeFile(pdfPath, bytes);
  return { record: await mutations.recordPdfAttached(record, options.version), written: true };
}
