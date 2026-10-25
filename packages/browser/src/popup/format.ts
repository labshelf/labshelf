/**
 * Formats popup text: the one-line byline under the title, tag
 * parsing, and the folder name.
 */
import { PAPERS_DIR, formatFolderPathLabel, formatAuthors, normalizeTags, formatVenueLine } from "@labshelf/core";

import type { DraftView } from "../platform";

/** "Edelman et al. · SIAM J. Matrix Anal. Appl. · 1998" — surnames, et al. past two. */
export function metaLine(d: Pick<DraftView, "authors" | "venue" | "year">): string {
  return [formatAuthors(d.authors), formatVenueLine({ journal: d.venue, year: d.year })].filter(Boolean).join(" · ");
}

/** "ml, #Thesis ch2 , ML" → ["ml", "Thesis ch2"]: split on , and ;, a leading # dropped, then normalised. */
export function parseTags(text: string): string[] {
  return normalizeTags(text.split(/[,;]/).map((raw) => raw.trim().replace(/^#/, "")));
}

/** The folder's display name: its path inside the library ("Thesis / Chapter 2"), "All papers" for the root. */
export function folderName(path: string): string {
  return formatFolderPathLabel(PAPERS_DIR, path, "/");
}
