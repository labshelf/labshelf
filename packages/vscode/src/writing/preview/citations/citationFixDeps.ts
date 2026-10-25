// Declares what the citation-card fixes need from the extension.
import type { AddBibDeps } from "./addBibliographyToLibrary.js";
import type { ReplaceKeyDeps } from "./replaceCiteKey.js";
import type { UpdateBibDeps } from "./updateBibEntry.js";

export type CitationFixDeps = UpdateBibDeps & AddBibDeps & ReplaceKeyDeps & {
  /** Keys of the library papers, with the authors and year that rank look-alikes. */
  shelfKeys: () => Promise<{ key: string; authors: string[]; year?: string }[]>;
};
