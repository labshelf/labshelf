// Saves a shared PDF, or every PDF and BibTeX entry of the share as one .zip built in the page.
import type { LoadPdfError, OpenedShare, SharedPaper } from "@labshelf/core";
import { zipSync, type Zippable } from "fflate";

import { pdfFileName, zipEntryNames, zipFileName } from "./downloadNames.js";

const REVOKE_AFTER_MS = 60_000;

export function saveFile(name: string, data: Uint8Array | string, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // PLATFORM: revoking the URL in the same task can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export class PdfLoadError extends Error {
  constructor(readonly paperId: string, readonly reason: LoadPdfError, readonly detail?: string) {
    super(`PDF of ${paperId} could not be read: ${reason}${detail ? ` (${detail})` : ""}`);
  }
}

async function loadPdfBytes(share: OpenedShare, paper: SharedPaper): Promise<Uint8Array> {
  const result = await share.loadPdf(paper);
  if (!result.ok) throw new PdfLoadError(paper.metadata.id, result.error, result.detail);
  return result.bytes;
}

export async function downloadPdf(share: OpenedShare, paper: SharedPaper): Promise<void> {
  saveFile(pdfFileName(paper.metadata), await loadPdfBytes(share, paper), "application/pdf");
}

/** Zips what could be read and saves it. @returns the papers whose PDF could not be read and were left out. */
export async function downloadZip(share: OpenedShare, folder: string, papers: readonly SharedPaper[]): Promise<PdfLoadError[]> {
  const names: string[] = [];
  const contents: Uint8Array[] = [];
  const failed: PdfLoadError[] = [];
  for (const paper of papers) {
    if (!paper.pdf) continue;
    try {
      contents.push(await loadPdfBytes(share, paper));
      names.push(pdfFileName(paper.metadata));
    } catch (err) {
      if (!(err instanceof PdfLoadError)) throw err;
      failed.push(err);
    }
  }
  const bib = papers.flatMap((p) => (p.bib ? [p.bib.trim()] : [])).join("\n\n");
  if (bib) { names.push("references.bib"); contents.push(new TextEncoder().encode(`${bib}\n`)); }
  const files: Zippable = {};
  zipEntryNames(names).forEach((name, i) => { files[name] = contents[i]!; });
  // PDFs are compressed already, so the entries are stored.
  saveFile(zipFileName(folder), zipSync(files, { level: 0 }), "application/zip");
  return failed;
}
