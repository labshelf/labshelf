/**
 * Declares the metadata of one paper as the library, the databases and the apps exchange it.
 */
import type { BibliographicFields } from "./bibliographicFields.js";
import type { PaperStatus } from "./paperStatus.js";
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
  // True when <folder>/paper.pdf exists on this device. Derived by each surface
  // (VS Code indexer, browser file keys), never written to metadata.yaml.
  // Undefined = unknown, treated as present.
  hasPdf?: boolean;
}
