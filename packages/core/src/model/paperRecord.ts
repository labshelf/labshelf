/**
 * Declares the metadata of one paper as the library, the databases and the apps exchange it.
 */
import type { BibliographicFields } from "./bibliographicFields.js";
import type { PaperStatus } from "./paperStatus.js";
import type { PdfVersion } from "./pdfVersion.js";
import type { TextLayerInfo } from "./textLayer.js";

export interface PaperRecord extends BibliographicFields {
  id: string;
  title: string;
  path: string;
  citeKey: string;
  status: PaperStatus;
  // Absent until the PDF has been checked (papers imported before this existed).
  textLayer?: TextLayerInfo;
  // The user's own labels and comment, set when saving from the browser.
  // Undefined means "not known here": a rewrite keeps whatever the sidecar has.
  tags?: string[];
  note?: string;
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
  // True when <folder>/paper.pdf exists on this device. Derived by each surface
  // (VS Code indexer, browser file keys), never written to metadata.yaml.
  // Undefined = unknown, treated as present.
  hasPdf?: boolean;
}
