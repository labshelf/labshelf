/**
 * Pure text helpers for the popup: the one-line byline under the title, tag
 * parsing, and human labels for folders.
 */
import { formatAuthors, normalizeTags, venueLine } from "@labshelf/core";

import type { DraftView, FoldersData } from "../platform";

/** "Edelman et al. · SIAM J. Matrix Anal. Appl. · 1998" — surnames, et al. past two. */
export function metaLine(d: Pick<DraftView, "authors" | "venue" | "year">): string {
  return [formatAuthors(d.authors), venueLine({ journal: d.venue, year: d.year })].filter(Boolean).join(" · ");
}

/** "ml, #Thesis ch2 , ML" → ["ml", "Thesis ch2"]: split on , and ;, a leading # dropped, then normalised. */
export function parseTags(text: string): string[] {
  return normalizeTags(text.split(/[,;]/).map((raw) => raw.trim().replace(/^#/, "")));
}

/** "papers/Thesis/Chapter 2" → "Thesis / Chapter 2"; the root is "Library". */
export function folderPathLabel(path: string): string {
  const rel = path.replace(/^papers\/?/, "");
  return rel ? rel.split("/").join(" / ") : "Library";
}

/** The folder's display name: its path inside the library, "Library" for the root. */
export function folderName(path: string, folders: FoldersData): string {
  const known = folders.folders.find((f) => f.path === path);
  return known?.depth === 0 ? known.label : folderPathLabel(path);
}
