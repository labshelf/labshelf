// Merges a sidecar with its conflict copy per annotation, honouring deletion markers.
import type { Annotation } from "../../model/index.js";
import { byPageThenCreated, normalizePaperData, serializePaperData, type PaperData } from "../../reader/sidecar/index.js";

export interface SidecarVersion {
  text: string;
  mtimeMs: number;
}

/** @returns the sidecar in `text`, or null when it is not a JSON object. */
export function parseSidecar(text: string): PaperData | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? normalizePaperData(parsed) : null;
  } catch {
    return null;
  }
}

// TRAP: reading is defensive, so a hand-edited annotation may lack `updatedAt`; it then counts as the oldest stamp.
function stamp(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Items are ordered older file first, so on equal stamps the newer file's item wins. */
function newest<T>(items: T[], idOf: (item: T) => string, stampOf: (item: T) => string): Map<string, T> {
  const byId = new Map<string, T>();
  for (const item of items) {
    const current = byId.get(idOf(item));
    if (!current || stampOf(item) >= stampOf(current)) { byId.set(idOf(item), item); }
  }
  return byId;
}

/**
 * Per id, the annotation with the larger `updatedAt` wins and the marker with the larger `deletedAt` wins; a marker
 * removes an annotation unless the annotation was edited after it. Theme and reading position come from the newer
 * file by mtime (`mine` on a tie), because they have no per-field time.
 * @returns the merged sidecar text, or null when either file is not a JSON object.
 */
export function mergeSidecars(mine: SidecarVersion, other: SidecarVersion): string | null {
  const mineData = parseSidecar(mine.text);
  const otherData = parseSidecar(other.text);
  if (!mineData || !otherData) { return null; }
  const [older, newer] = other.mtimeMs > mine.mtimeMs ? [mineData, otherData] : [otherData, mineData];
  const markers = newest([...(older.deleted ?? []), ...(newer.deleted ?? [])], (m) => m.id, (m) => m.deletedAt);
  const annotations = newest([...older.annotations, ...newer.annotations], (a) => a.id, (a) => stamp(a.updatedAt));
  const kept: Annotation[] = [];
  for (const annotation of annotations.values()) {
    const marker = markers.get(annotation.id);
    if (marker && marker.deletedAt >= stamp(annotation.updatedAt)) { continue; }
    kept.push(annotation);
    markers.delete(annotation.id);
  }
  return serializePaperData({ ...newer, annotations: kept.sort(byPageThenCreated), deleted: [...markers.values()] });
}
