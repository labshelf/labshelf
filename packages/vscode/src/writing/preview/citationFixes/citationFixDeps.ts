// Declares what the citation-card fixes need from the extension.
import type { AddBibDeps } from "./addBibToLibrary.js";
import type { ReplaceKeyDeps } from "./replaceCitedKey.js";
import type { UpdateBibDeps } from "./updateBibEntry.js";

export type CitationFixDeps = UpdateBibDeps & AddBibDeps & ReplaceKeyDeps & {
  /** Keys of the library papers, with the authors and year that rank look-alikes. */
  shelfKeys: () => Promise<{ key: string; authors: string[]; year?: string }[]>;
};
