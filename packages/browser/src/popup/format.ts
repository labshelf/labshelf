/**
 * Formats popup text: the one-line byline under the title, tag
 * parsing, the folder name, and the one-line PDF status.
 */
import { PAPERS_DIR, formatFolderPathLabel, formatAuthors, normalizeTags, formatVenueLine, formatPdfSourceLabel } from "@labshelf/core";

import type { DraftView, FindPdfReply } from "../platform";

/** "Edelman et al. · SIAM J. Matrix Anal. Appl. · 1998" — surnames, et al. past two. */
export function formatMetaLine(d: Pick<DraftView, "authors" | "venue" | "year">): string {
  return [formatAuthors(d.authors), formatVenueLine({ journal: d.venue, year: d.year })].filter(Boolean).join(" · ");
}

/** "ml, #Thesis ch2 , ML" → ["ml", "Thesis ch2"]: split on , and ;, a leading # dropped, then normalised. */
export function parseTags(text: string): string[] {
  return normalizeTags(text.split(/[,;]/).map((raw) => raw.trim().replace(/^#/, "")));
}

/** The folder's display name: its path inside the library ("Thesis / Chapter 2"), "All papers" for the root. */
export function formatFolderName(path: string): string {
  return formatFolderPathLabel(PAPERS_DIR, path, "/");
}

/** The status line while searching, when found, and when the search ended empty (the user is asked before saving). */
export function describePdfLine(status: FindPdfReply | "searching"): string {
  if (status === "searching") return "Looking for the PDF…";
  if (status.found) return `PDF found · ${formatPdfSourceLabel(status.source)}`;
  const tried = status.miss?.tried ?? 0;
  if (tried > 0) {
    const links = tried === 1 ? "link" : "links";
    return `No PDF found (tried ${tried} ${links}) — you'll be asked before saving`;
  }
  return "No PDF found — you'll be asked before saving";
}
