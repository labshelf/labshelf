// Defines the per-paper sidecar (data.json: annotations, theme, reading position) every app reads and writes.
// INVARIANT: every app reads and writes the same data.json, so the format must not drift.
import { isPdfTheme, type Annotation, type PdfTheme } from "../../model/index.js";
import { normalizeReadingState, type ReadingState } from "./readingState.js";

export interface PaperData {
  annotations: Annotation[];
  theme: PdfTheme;
  /** Last reading position; absent until the paper has been opened in the reader. */
  reading?: ReadingState;
}

/**
 * @returns the sidecar of a paper that has never been opened.
 */
export function emptyPaperData(): PaperData {
  return { annotations: [], theme: "auto" };
}

/**
 * Defensive normalization so a corrupt or hand-edited sidecar never throws and never half-applies.
 * @returns clean PaperData; unknown or malformed fields fall back to their defaults.
 */
export function normalizePaperData(parsed: unknown): PaperData {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { return emptyPaperData(); }
  const obj = parsed as Record<string, unknown>;
  const annotations = Array.isArray(obj["annotations"])
    ? (obj["annotations"].filter(
        (a) => a && typeof a === "object" && typeof (a as Annotation).id === "string",
      ) as Annotation[])
    : [];
  const theme = isPdfTheme(obj["theme"]) ? obj["theme"] : "auto";
  const data: PaperData = { annotations, theme };
  const reading = normalizeReadingState(obj["reading"]);
  if (reading) { data.reading = reading; }
  return data;
}

/**
 * The exact bytes both extensions write: fixed key order, two-space indent, `reading` omitted until set.
 * @returns the JSON text of the sidecar.
 */
export function serializePaperData(data: PaperData): string {
  const payload: PaperData = { annotations: data.annotations, theme: data.theme };
  if (data.reading) { payload.reading = data.reading; }
  return JSON.stringify(payload, null, 2);
}

/**
 * The order the reader lists annotations in: by page, then by creation time.
 * @returns a negative number when `a` comes first, positive when `b` does, 0 when they tie.
 */
export function byPageThenCreated(a: Annotation, b: Annotation): number {
  return a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt);
}
