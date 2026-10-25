// Turns a paper already in the library into a capture draft, so "Find PDF" runs the resolver chain without a tab.
// Identifiers and title, authors and year come from the stored record; the landing page is read once.
import { idsFromRecord, metadataFromRecord } from "@labshelf/core";
import type { ILogger, PaperRecord } from "@labshelf/core";
import type { CaptureDraft } from "./captureService";
import { landingFacts } from "./landingFacts";

/**
 * Builds the PDF-search draft for a saved paper. The record's own identifiers
 * win over whatever the landing page states.
 */
export async function draftFromRecord(log: ILogger, r: PaperRecord): Promise<CaptureDraft> {
  const landing = r.url ? await landingFacts(log, r.url) : undefined;
  return {
    pageUrl: r.url ?? "",
    ids: { ...(landing?.ids ?? {}), ...idsFromRecord(r) },
    metadata: metadataFromRecord(r),
    origin: "none",
    isPaper: true,
    pdfCandidates: landing?.pdfCandidates ?? [],
    fetchOpts: {},
    pdfAttempts: [],
    existing: r,
  };
}
