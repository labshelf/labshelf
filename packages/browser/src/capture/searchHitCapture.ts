// Turns one Google Scholar or Google search result into a capture draft: ids in its links, else landing page, else title search.
// A title match must agree with the year and authors the result printed; Scholar's "[PDF]" link is the first candidate.
import type { ILogger, MetadataSource, PageFacts, PdfCandidate, ResolvedMetadata } from "@labshelf/core";
import { extractIdentifiersFromHit } from "../content";
import { createDraftFromFacts } from "./captureService";
import type { CaptureDraft } from "./captureService";
import { fetchLandingFacts } from "./fetchLandingFacts";
import type { SearchHit } from "../platform";

// The result's own line is abbreviated ("OH Ibarra", "Proceedings of the …"), so
// it only fills what nothing better states.
const HIT_TRUST = 20;

/**
 * What the result itself printed, as a low-trust metadata source.
 */
export function deriveMetadataFromHit(hit: SearchHit): ResolvedMetadata {
  const meta: ResolvedMetadata = { title: hit.title };
  if (hit.authors.length) meta.authors = hit.authors;
  if (hit.year) meta.year = hit.year;
  if (hit.venue && !hit.venue.includes("…")) meta.journal = hit.venue;
  if (hit.url) meta.url = hit.url;
  return meta;
}

/**
 * Builds the draft for a search result.
 */
export async function createDraftFromSearchHit(log: ILogger, hit: SearchHit): Promise<CaptureDraft> {
  const ids = extractIdentifiersFromHit(hit);
  const landing = !ids.doi && !ids.arxivId && hit.url ? await fetchLandingFacts(log, hit.url) : undefined;

  const scholarPdf: PdfCandidate[] = hit.pdfUrl ? [{ url: hit.pdfUrl, source: "scholar" }] : [];
  const facts: PageFacts = landing
    ? { ...landing, ids: { ...ids, ...landing.ids }, isPaper: true, pdfCandidates: [...scholarPdf, ...landing.pdfCandidates] }
    : { pageUrl: hit.url ?? hit.pdfUrl ?? "", ids, metadata: {}, structured: false, pdfCandidates: scholarPdf, isPaper: true };

  const hitSource: MetadataSource = { name: "search result", trust: HIT_TRUST, metadata: deriveMetadataFromHit(hit) };
  return createDraftFromFacts(log, facts, {}, [hitSource]);
}
