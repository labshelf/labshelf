/**
 * Turns a paper already in the library into a capture draft, so the library
 * page's "Find PDF" can run the same resolver chain a fresh capture does — no
 * tab involved. Identifiers come from the stored record (its DOI, arXiv id or
 * PubMed URL) and its stored title, authors and year, which decide whether a
 * copy an aggregator suggests is the same paper. Its landing page is read once
 * for citation_pdf_url and download anchors, exactly as a Scholar result's page is.
 */
import { idsFromRecord, metadataFromRecord } from "@labshelf/core";
import type { PaperRecord } from "@labshelf/core";
import type { CaptureDraft } from "./captureService";
import { landingFacts } from "./landingFacts";

/**
 * Builds the PDF-search draft for a saved paper. The record's own identifiers
 * win over whatever the landing page states.
 */
export async function draftFromRecord(r: PaperRecord): Promise<CaptureDraft> {
  const landing = r.url ? await landingFacts(r.url) : undefined;
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
