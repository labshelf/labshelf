// Turns a paper already in the library into a capture draft, so "Find PDF" runs the resolver chain without a tab.
// Identifiers and title, authors and year come from the stored record; the landing page is read once.
import { extractPaperIdentifiers, deriveResolvedMetadata } from "@labshelf/core";
import type { ILogger, PaperRecord } from "@labshelf/core";
import type { CaptureDraft } from "./captureService";
import { fetchLandingFacts } from "./fetchLandingFacts";

/**
 * Builds the PDF-search draft for a saved paper. The record's own identifiers
 * win over whatever the landing page states.
 */
export async function createDraftFromPaper(log: ILogger, r: PaperRecord): Promise<CaptureDraft> {
  const landing = r.url ? await fetchLandingFacts(log, r.url) : undefined;
  return {
    pageUrl: r.url ?? "",
    ids: { ...(landing?.ids ?? {}), ...extractPaperIdentifiers(r) },
    metadata: deriveResolvedMetadata(r),
    origin: "none",
    isPaper: true,
    pdfCandidates: landing?.pdfCandidates ?? [],
    fetchOpts: {},
    pdfAttempts: [],
    existing: r,
  };
}
