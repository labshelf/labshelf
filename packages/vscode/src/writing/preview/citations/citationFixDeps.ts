// Declares what the citation-card fixes need from the extension.
import type { AddBibliographyDeps } from "./addBibliographyToLibrary.js";
import type { ReplaceCiteKeyDeps } from "./replaceCiteKey.js";
import type { UpdateBibliographyDeps } from "./updateBibEntry.js";

export type CitationFixDeps = UpdateBibliographyDeps & AddBibliographyDeps & ReplaceCiteKeyDeps & {
  /** Keys of the library papers, with the authors and year that rank look-alikes. */
  shelfKeys: () => Promise<{ key: string; authors: string[]; year?: string }[]>;
};
