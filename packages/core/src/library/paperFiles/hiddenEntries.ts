// Decides which entries of a paper folder the file tray never shows.
import { BIB_FILE, METADATA_FILE } from "../layout.js";

/** metadata.yaml, bib.bib and every dot entry (`.keep` included) belong to the library, not to the user's files. */
export function isHiddenPaperEntry(name: string): boolean {
  return name === METADATA_FILE || name === BIB_FILE || name.startsWith(".");
}
