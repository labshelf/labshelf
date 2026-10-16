// Builds a capture draft from a DOI alone, so a paper known only by its DOI is saved through the normal capture flow.
import type { ILogger } from "@labshelf/core";
import { draftFromFacts, type CaptureDraft } from "./captureService";

/** Resolves the DOI's metadata from the registries and checks the library; the PDF search starts on first request. */
export function draftFromDoi(log: ILogger, doi: string): Promise<CaptureDraft> {
  return draftFromFacts(log, {
    pageUrl: `https://doi.org/${doi}`,
    ids: { doi },
    metadata: {},
    structured: false,
    pdfCandidates: [],
    isPaper: true,
  }, {});
}
