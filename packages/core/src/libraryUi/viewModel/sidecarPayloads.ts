/** Turns a paper's sidecar into the shapes the library UI protocol carries: the row stats and the detail pane data. */
import type { Annotation } from "../../model/index.js";
import type { PaperDetails, PaperStats } from "../protocol/index.js";

/** The part of a sidecar the library UI reads. */
export interface SidecarView {
  annotations: Annotation[];
  reading?: { page: number; updatedAt: string };
}

export function derivePaperStats(data: SidecarView): PaperStats {
  const { annotations, reading } = data;
  return {
    annotations: annotations.length,
    ...(reading ? { lastPage: reading.page, lastRead: reading.updatedAt } : {}),
  };
}

export function derivePaperDetails(data: SidecarView, pdf: PaperDetails["pdf"]): PaperDetails {
  const { annotations, reading } = data;
  return { annotations, reading: reading ? { page: reading.page, updatedAt: reading.updatedAt } : null, pdf };
}
