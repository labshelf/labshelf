/** Turns a paper's sidecar into the shapes the library UI protocol carries: the row stats and the detail pane data. */
import type { Annotation } from "../../model/index.js";
import type { PaperDetails, PaperStats } from "../protocol/index.js";

/** The part of a sidecar the library UI reads. */
export interface SidecarSummarySource {
  annotations: Annotation[];
  reading?: { page: number; updatedAt: string };
}

export function paperStatsOf(data: SidecarSummarySource): PaperStats {
  const { annotations, reading } = data;
  const lastHighlight = lastHighlightOf(annotations);
  return {
    annotations: annotations.length,
    ...(reading ? { lastPage: reading.page, lastRead: reading.updatedAt } : {}),
    ...(lastHighlight ? { lastHighlight } : {}),
  };
}

// INVARIANT: updatedAt is an ISO timestamp, so string order is time order; `>=` lets the later one win a tie.
function lastHighlightOf(annotations: Annotation[]): PaperStats["lastHighlight"] {
  let latest: Annotation | undefined;
  for (const a of annotations) if (a.type === "highlight" && (!latest || a.updatedAt >= latest.updatedAt)) latest = a;
  return latest && { page: latest.pageNumber, text: latest.content };
}

export function paperDetailsOf(data: SidecarSummarySource, pdf: PaperDetails["pdf"]): PaperDetails {
  const { annotations, reading } = data;
  return { annotations, reading: reading ? { page: reading.page, updatedAt: reading.updatedAt } : null, pdf };
}
