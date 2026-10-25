// Defines the per-paper sidecar (data.json: annotations, theme, reading position) every app reads and writes.
// INVARIANT: every app reads and writes the same data.json, so the format must not drift.
import { isPdfTheme, type Annotation, type PdfTheme } from "../../model/index.js";
import { normalizeReadingPosition, type ReadingState } from "./readingState.js";

export interface PaperSidecar {
  annotations: Annotation[];
  theme: PdfTheme;
  /** Last reading position; absent until the paper has been opened in the reader. */
  reading?: ReadingState;
  /** Annotations the user removed, so a stale copy of the file cannot bring them back. Absent when there are none. */
  deleted?: DeletionMarker[];
}

export interface DeletionMarker {
  id: string;
  /** ISO time of the deletion, comparable with an annotation's `updatedAt`. */
  deletedAt: string;
}

/** How long a deletion marker is kept; a stale copy older than this is assumed not to exist. */
const DELETION_MARKER_DAYS = 90;

function isDeletionMarker(value: unknown): value is DeletionMarker {
  if (!value || typeof value !== "object") { return false; }
  const marker = value as Record<string, unknown>;
  return typeof marker["id"] === "string" && typeof marker["deletedAt"] === "string"
    && Number.isFinite(Date.parse(marker["deletedAt"]));
}

/**
 * @returns the markers deleted within `DELETION_MARKER_DAYS` before `now`.
 */
export function removeStaleDeletionMarkers(markers: DeletionMarker[], now: string): DeletionMarker[] {
  const cutoff = new Date(Date.parse(now) - DELETION_MARKER_DAYS * 86_400_000).toISOString();
  return markers.filter((m) => m.deletedAt >= cutoff);
}

/**
 * @returns the sidecar of a paper that has never been opened.
 */
export function createEmptyPaperSidecar(): PaperSidecar {
  return { annotations: [], theme: "auto" };
}

/**
 * Defensive normalization so a corrupt or hand-edited sidecar never throws and never half-applies.
 * @returns clean PaperSidecar; unknown or malformed fields fall back to their defaults.
 */
export function normalizePaperSidecar(parsed: unknown): PaperSidecar {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { return createEmptyPaperSidecar(); }
  const obj = parsed as Record<string, unknown>;
  const annotations = Array.isArray(obj["annotations"])
    ? (obj["annotations"].filter(
        (a) => a && typeof a === "object" && typeof (a as Annotation).id === "string",
      ) as Annotation[])
    : [];
  const theme = isPdfTheme(obj["theme"]) ? obj["theme"] : "auto";
  const data: PaperSidecar = { annotations, theme };
  const reading = normalizeReadingPosition(obj["reading"]);
  if (reading) { data.reading = reading; }
  const deleted = Array.isArray(obj["deleted"]) ? obj["deleted"].filter(isDeletionMarker).map(({ id, deletedAt }) => ({ id, deletedAt })) : [];
  if (deleted.length > 0) { data.deleted = deleted; }
  return data;
}

/**
 * The exact bytes both extensions write: fixed key order, two-space indent, `reading` and `deleted` omitted until set,
 * markers sorted by id so two devices holding the same markers write the same bytes.
 * @returns the JSON text of the sidecar.
 */
export function serializePaperSidecar(data: PaperSidecar): string {
  const payload: PaperSidecar = { annotations: data.annotations, theme: data.theme };
  if (data.reading) { payload.reading = data.reading; }
  if (data.deleted && data.deleted.length > 0) { payload.deleted = [...data.deleted].sort((a, b) => a.id.localeCompare(b.id)); }
  return JSON.stringify(payload, null, 2);
}

/**
 * The order the reader lists annotations in: by page, then by creation time.
 * @returns a negative number when `a` comes first, positive when `b` does, 0 when they tie.
 */
export function compareAnnotations(a: Annotation, b: Annotation): number {
  return a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt);
}
