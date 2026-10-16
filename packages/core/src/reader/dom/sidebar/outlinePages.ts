// Resolves each outline entry's destination to a 1-based page number.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OutlineRow } from "../../logic/index.js";

/**
 * @returns one page per row in order; an entry whose destination cannot be resolved stays null and never becomes active.
 */
export async function resolveOutlinePages(
  doc: Pick<PDFDocumentProxy, "getDestination" | "getPageIndex">,
  rows: OutlineRow[],
  isCurrent: () => boolean = () => true,
): Promise<Array<number | null>> {
  const pages: Array<number | null> = rows.map(() => null);
  for (const row of rows) {
    if (!isCurrent()) { return pages; }
    try {
      const explicit = typeof row.dest === "string" ? await doc.getDestination(row.dest) : row.dest;
      const ref = Array.isArray(explicit) ? (explicit[0] as unknown) : null;
      if (ref && typeof ref === "object") {
        pages[row.id] = (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1;
      } else if (typeof ref === "number" && Number.isInteger(ref)) {
        pages[row.id] = ref + 1;
      }
    } catch {
      // An unresolvable entry simply never becomes active.
    }
  }
  return pages;
}
