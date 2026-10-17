// Merges a sidecar with its conflict copy so that no annotation from either device is lost.
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

/**
 * Union of annotations by id; an id in both files, the theme and the reading position come from the newer file
 * (`mine` on a tie). A deleted annotation may come back; none is lost.
 * @returns the merged sidecar text, or null when either file is not a JSON object.
 */
export function mergeSidecars(mine: SidecarVersion, other: SidecarVersion): string | null {
  const mineData = parseSidecar(mine.text);
  const otherData = parseSidecar(other.text);
  if (!mineData || !otherData) { return null; }
  const [older, newer] = other.mtimeMs > mine.mtimeMs ? [mineData, otherData] : [otherData, mineData];
  const byId = new Map<string, Annotation>();
  for (const annotation of [...older.annotations, ...newer.annotations]) { byId.set(annotation.id, annotation); }
  return serializePaperData({ ...newer, annotations: [...byId.values()].sort(byPageThenCreated) });
}
