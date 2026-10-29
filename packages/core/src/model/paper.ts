/**
 * Declares a paper's metadata as the library, the databases and the apps exchange it: the record, the bibliographic
 * fields it shares with registry answers and parsed PDFs, and the venue derived for display and sorting.
 */
import type { ReadingStatus } from "../library/index.js";
import type { TextLayerDetails } from "./annotation.js";
import type { PdfVersion } from "./pdf.js";

export interface BibliographicFields {
  authors?: string[] | undefined;
  year?: number | undefined;
  summary?: string | undefined;
  journal?: string | undefined;
  publisher?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  pages?: string | undefined;
  doi?: string | undefined;
  url?: string | undefined;
  issn?: string | undefined;
  language?: string | undefined;
  /** Author or publisher supplied subject terms, when the PDF or a registry states them. */
  keywords?: string[] | undefined;
}

export const BIBLIOGRAPHIC_STRING_FIELDS = [
  "summary", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language",
] as const satisfies ReadonlyArray<keyof BibliographicFields>;

export const BIBLIOGRAPHIC_FIELDS = ["authors", "year", ...BIBLIOGRAPHIC_STRING_FIELDS, "keywords"] as const satisfies ReadonlyArray<keyof BibliographicFields>;

export interface PaperRecord extends BibliographicFields {
  id: string;
  title: string;
  path: string;
  citeKey: string;
  status: ReadingStatus;
  // Absent until the PDF has been checked (papers imported before this existed).
  textLayer?: TextLayerDetails;
  // The user's own labels, set when saving from the browser.
  // Undefined means "not known here": a rewrite keeps whatever the sidecar has.
  tags?: string[];
  // Which version paper.pdf is, set when a PDF is attached. Undefined means "not known here": a rewrite keeps the
  // file's key. Null means the attached PDF's version is unknown, and the key is removed.
  // CONTRACT: documents/contracts/library-format.md#metadatayaml
  pdfVersion?: PdfVersion | null;
  // The day (YYYY-MM-DD) the user asked the author for a copy. Undefined means "not known here": a rewrite keeps the
  // file's key. Null removes the key.
  // CONTRACT: documents/contracts/library-format.md#metadatayaml
  pdfRequestedAt?: string | null;
  // When `status` last changed (ISO timestamp); undefined means unknown, and a rewrite keeps the file's key.
  // CONTRACT: documents/contracts/library-format.md#metadatayaml
  statusChangedAt?: string;
  // The user's descriptions of the files in the paper folder, by entry name. Undefined means "not known here": a rewrite
  // keeps the file's key. An empty object removes the key.
  // CONTRACT: documents/contracts/library-format.md#metadatayaml
  files?: Record<string, string>;
  // True when <folder>/paper.pdf exists on this device. Derived by each surface
  // (VS Code indexer, browser file keys), never written to metadata.yaml.
  // Undefined = unknown, treated as present.
  hasPdf?: boolean;
}

/** The journal, else the publisher, else an empty string. */
export function deriveVenue(record: { journal?: string | undefined; publisher?: string | undefined }): string {
  return record.journal || record.publisher || "";
}
