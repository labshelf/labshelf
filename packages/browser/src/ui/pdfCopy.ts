/**
 * The popup's one-line PDF status, which the shared core PDF copy builds on: searching, found, or not found.
 */
import { pdfSourceLabel } from "@labshelf/core";
import type { PdfStatusData } from "../platform/runtimeMessages";

/** The status line while searching, when found, and when the search ended empty (the user is asked before saving). */
export function pdfLineText(status: PdfStatusData | "searching"): string {
  if (status === "searching") return "Looking for the PDF…";
  if (status.found) return `PDF found · ${pdfSourceLabel(status.source)}`;
  const tried = status.miss?.tried ?? 0;
  if (tried > 0) {
    const links = tried === 1 ? "link" : "links";
    return `No PDF found (tried ${tried} ${links}) — you'll be asked before saving`;
  }
  return "No PDF found — you'll be asked before saving";
}
